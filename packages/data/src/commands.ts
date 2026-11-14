import {
  defaultCategories, formatCents, formatShortDate, localISODate, type Account, type AccountType, type Cents, type Category, type ID, type ISODate, type ImportBatch,
  type MappingProfile, type OccurrenceException, type Provenance, type RecurringAmount, type RecurringItem, type RecurringKind, type Schedule, type Settings,
  type Split, type Transaction, type TxKind, type TxStatus, type WeekendRule, type WorkspaceData,
} from '@clarity/shared';
import { accountBalance, balanceAsOfDate, inclusionProblem, pendingMatches, pendingPartialMatches, postedBalance, validateTransaction, validateTransferPair, type InclusionProblem, type Occurrence, type ValidationIssue } from '@clarity/engine';
import type { ImportCandidate, ImportSettings, ReconciliationPreview } from '@clarity/import';
import { applyOps as applyLocal, type Op } from './ops';

/**
 * Pure commands: given the current data, return the ops to persist. Every command validates
 * against the engine's rules and throws CommandError with user-facing messages.
 */
export interface Ctx {
  data: WorkspaceData;
  now: number;
  today: ISODate;
  newId: (prefix: string) => string;
}

export class CommandError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super(issues.map((i) => i.message).join(' '));
    this.name = 'CommandError';
  }
}

const fail = (message: string, field = 'form'): never => {
  throw new CommandError([{ field, message }]);
};

function assertValid(tx: Transaction, ctx: Ctx) {
  const issues = validateTransaction(tx, ctx.data.accounts, ctx.data.categories);
  if (issues.length) throw new CommandError(issues);
}

// ───────────────────────── settings & workspace ─────────────────────────

export function defaultSettings(now: number, baseCurrency = 'USD'): Settings {
  return {
    id: 'settings', baseCurrency, minReserveCents: 0, defaultAccountId: null, autoLockMinutes: 15, theme: 'system', lastBackupAt: null,
    txSinceBackup: 0, backupReminderDays: 14, backupReminderTxCount: 50, onboardingComplete: false, createdAt: now, updatedAt: now,
  };
}

export function updateSettings(ctx: Ctx, patch: Partial<Omit<Settings, 'id' | 'createdAt'>>): Op[] {
  if (patch.minReserveCents !== undefined && (!Number.isSafeInteger(patch.minReserveCents) || patch.minReserveCents < 0)) fail('Reserve must be zero or more.', 'minReserveCents');
  if (patch.autoLockMinutes !== undefined && (patch.autoLockMinutes < 1 || patch.autoLockMinutes > 240)) fail('Auto-lock must be between 1 and 240 minutes.', 'autoLockMinutes');
  return [{ t: 'put', table: 'settings', value: { ...ctx.data.settings, ...patch, updatedAt: ctx.now } }];
}

export function seedCategories(ctx: Ctx): Op[] {
  return defaultCategories(ctx.now).map((c) => ({ t: 'put', table: 'categories', value: c }));
}

// ───────────────────────── accounts ─────────────────────────

export interface AccountInput {
  name: string;
  type: AccountType;
  /**
   * Balance today as the user sees it, signed: a negative checking/savings/cash balance is overdrawn.
   * For cards it is the AMOUNT OWED: positive = owed, negative = the card is in credit (Phase 4A.5.8; never abs()).
   */
  currentBalanceCents: Cents;
  spendable?: boolean;
}

export function createAccount(ctx: Ctx, input: AccountInput): { ops: Op[]; account: Account } {
  const name = input.name.trim();
  if (!name) fail('Give the account a name.', 'name');
  if (!Number.isSafeInteger(input.currentBalanceCents)) fail('Enter a valid balance.', 'balance');
  const isCard = input.type === 'credit_card';
  const account: Account = {
    id: ctx.newId('acct'),
    name,
    type: input.type,
    currency: ctx.data.settings.baseCurrency,
    openingBalanceCents: isCard ? 0 - input.currentBalanceCents : input.currentBalanceCents, // 0 - x: never −0
    openingDate: ctx.today,
    spendable: isCard ? false : (input.spendable ?? input.type !== 'savings'),
    archived: false,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  const ops: Op[] = [{ t: 'put', table: 'accounts', value: account }];
  if (!ctx.data.settings.defaultAccountId && account.spendable) ops.push(...updateSettings(ctx, { defaultAccountId: account.id }));
  return { ops, account };
}

export function updateAccount(ctx: Ctx, id: ID, patch: Partial<Pick<Account, 'name' | 'spendable' | 'archived'>>): Op[] {
  const a = ctx.data.accounts.find((x) => x.id === id) ?? fail('Account not found.');
  if (patch.name !== undefined && !patch.name.trim()) fail('Give the account a name.', 'name');
  const next: Account = { ...a, ...patch, ...(patch.name ? { name: patch.name.trim() } : {}), updatedAt: ctx.now };
  if (next.type === 'credit_card') next.spendable = false;
  const ops: Op[] = [{ t: 'put', table: 'accounts', value: next }];
  if (patch.archived && ctx.data.settings.defaultAccountId === id) ops.push(...updateSettings(ctx, { defaultAccountId: null }));
  return ops;
}

// ───────────────────────── archiving (Phase 4A.4.2) ─────────────────────────

/** What still uses an account: active scheduled items (paid from it or into it) and planned future transactions. */
export interface AccountUsage {
  recurring: { item: RecurringItem; role: 'from' | 'to' }[];
  planned: Transaction[];
}

/** The account's balance today and, when it owes money, what archiving does to that debt (Phase 4A.4.4). */
export function archiveBalanceReview(data: WorkspaceData, accountId: ID, today: ISODate): { balanceCents: Cents; note: string | null } {
  const account = data.accounts.find((a) => a.id === accountId);
  if (!account) return { balanceCents: 0, note: null };
  const balanceCents = accountBalance(account, data.transactions, today);
  return { balanceCents, note: archiveBalanceNote(account, balanceCents, data.settings.baseCurrency) };
}

/** Shown wherever pausing is offered with archiving (Phase 4A.4.4): the existing pause/resume rule. */
export const PAUSE_NOTE =
  'Pausing skips every payment due while it is paused. When you resume it, payments that fell due during the pause are not brought back and won\'t show as overdue.';

/** Plain-language note about an account's debt before it is archived (Phase 4A.4.4). */
export function archiveBalanceNote(account: Account, balanceCents: Cents, baseCurrency: string): string | null {
  const f = (c: Cents) => formatCents(c, account.currency);
  const name = account.name;
  if (account.type === 'credit_card') {
    return balanceCents < 0
      ? `${name} still owes ${f(-balanceCents)}. Archiving doesn't clear it: the card stays in your totals, and the "no payment scheduled" warning stays until it's paid or a payment is scheduled.`
      : null;
  }
  if (balanceCents >= 0) return null;
  if (account.currency !== baseCurrency) {
    return `${name} is at ${f(balanceCents)}. It's in ${account.currency}, so it isn't counted in Safe to Spend (${baseCurrency}), before or after archiving.`;
  }
  // Phase 4A.5.9 (owner decision): a negative balance counts against Safe to Spend whether or not the account is
  // spendable (savings included), before and after archiving.
  return `${name} is overdrawn by ${f(-balanceCents)}. Archiving doesn't clear it: Safe to Spend keeps counting ${f(-balanceCents)} against your spendable accounts until ${name} is back to ${f(0)}.`;
}

export function accountUsage(data: WorkspaceData, accountId: ID, today: ISODate): AccountUsage {
  const recurring: AccountUsage['recurring'] = [];
  for (const r of data.recurring) {
    if (r.paused || (r.endDate && r.endDate < today)) continue;
    // a one-time item already in the past and recorded is done
    if (r.schedule.freq === 'once' && r.schedule.date < today && data.transactions.some((t) => t.occurrenceRef?.recurringId === r.id)) continue;
    if (r.accountId === accountId) recurring.push({ item: r, role: 'from' });
    else if (r.toAccountId === accountId) recurring.push({ item: r, role: 'to' });
  }
  const planned = data.transactions.filter((t) => t.accountId === accountId && t.date > today);
  return { recurring, planned };
}

/** One line describing how a scheduled item uses the account (shared by web and mobile). */
export function describeUsage(use: AccountUsage['recurring'][number], accounts: readonly Account[]): string {
  const name = (id?: ID) => accounts.find((a) => a.id === id)?.name ?? 'another account';
  const r = use.item;
  if (r.kind === 'income') return `${r.name}: income paid into ${name(r.accountId)}`;
  if (r.toAccountId) return `${r.name}: ${r.amount.type === 'card_full_balance' ? 'card payment' : 'transfer'} from ${name(r.accountId)} to ${name(r.toAccountId)}`;
  return `${r.name}: ${r.kind === 'subscription' ? 'subscription' : 'bill'} paid from ${name(r.accountId)}`;
}

/** Active accounts a scheduled item can be moved to instead of the account being archived. */
export function archiveTargets(use: AccountUsage['recurring'][number], accounts: readonly Account[], archivingId: ID): Account[] {
  const r = use.item;
  return accounts.filter((a) =>
    !a.archived && a.id !== archivingId && a.id !== r.accountId && a.id !== r.toAccountId &&
    (use.role !== 'to' || r.amount.type !== 'card_full_balance' || a.type === 'credit_card'));
}

/** The user's explicit choice for each scheduled item before archiving. Items not mentioned stay as they are. */
export interface ArchivePlan {
  /** recurring item id → active account to use instead (on the side that uses the archived account). */
  reassign?: Record<ID, ID>;
  /** recurring item ids to pause (paused items are not counted until resumed). */
  pause?: ID[];
}

/**
 * Archive an account, applying only the changes the user chose for its scheduled items (Phase 4A.4.2).
 * Nothing is reassigned, paused or deleted unless it is in the plan; items left alone stay counted
 * (paid from what the archived account holds; the rest is counted against the spendable accounts).
 */
export function archiveAccount(ctx: Ctx, id: ID, plan: ArchivePlan = {}): Op[] {
  const account = ctx.data.accounts.find((a) => a.id === id) ?? fail('Account not found.');
  if (account.archived) fail('This account is already archived.');
  const usage = accountUsage(ctx.data, id, ctx.today);
  let data = ctx.data;
  const ops: Op[] = [];
  const step = (r: Op[]) => {
    ops.push(...r);
    data = applyLocal(data, r);
  };
  const c = (): Ctx => ({ ...ctx, data });
  for (const [recId, targetId] of Object.entries(plan.reassign ?? {})) {
    const use = usage.recurring.find((u) => u.item.id === recId) ?? fail('That scheduled item no longer uses this account.');
    if (plan.pause?.includes(recId)) fail('Choose either a new account or pause, not both.');
    const target = data.accounts.find((a) => a.id === targetId);
    if (!target || target.archived || target.id === id) fail(`Choose an active account for ${use.item.name}.`, 'accountId');
    const r = use.item;
    step(updateRecurring(c(), r.id, {
      name: r.name, kind: r.kind, categoryId: r.categoryId, schedule: r.schedule, amount: r.amount, weekendRule: r.weekendRule,
      startDate: r.startDate, ...(r.endDate ? { endDate: r.endDate } : {}),
      accountId: use.role === 'from' ? targetId : r.accountId,
      ...(use.role === 'to' ? { toAccountId: targetId } : r.toAccountId ? { toAccountId: r.toAccountId } : {}),
    }));
  }
  for (const recId of plan.pause ?? []) {
    if (!usage.recurring.some((u) => u.item.id === recId)) fail('That scheduled item no longer uses this account.');
    step(setRecurringPaused(c(), recId, true));
  }
  step(updateAccount(c(), id, { archived: true }));
  return ops;
}

/**
 * "Update balance": records an explicit adjustment transaction for the difference between
 * the app's balance and the real balance, with a reason. Never edits history.
 */
/** Phase 4A.5.8: what "Update balance" would do, without doing it. `bankCents` is entered the same way as adjustBalance's. */
export interface BalanceUpdatePreview {
  /** Clarity's posted balance in the account's sign convention (card owed = negative). */
  postedCents: Cents;
  /** The bank's figure in the same convention. */
  bankCents: Cents;
  differenceCents: Cents;
  /** Sets of pending items whose amounts add up exactly to the difference (possibly cleared at the bank). */
  matches: Transaction[][];
  /** Phase 4A.5.9: pending items in the same direction that could explain part of the difference. */
  partial: Transaction[];
}

export function previewBalanceUpdate(data: WorkspaceData, accountId: ID, enteredCents: Cents, date: ISODate): BalanceUpdatePreview {
  const a = data.accounts.find((x) => x.id === accountId) ?? fail('Account not found.');
  // Cards are entered as the amount owed (positive = owed, negative = in credit); stored as the negative of that.
  const bankCents = a.type === 'credit_card' ? 0 - enteredCents : enteredCents;
  const postedCents = postedBalance(a, data.transactions, date);
  const differenceCents = bankCents - postedCents;
  const matches = pendingMatches(a, data.transactions, date, differenceCents);
  return { postedCents, bankCents, differenceCents, matches, partial: pendingPartialMatches(a, data.transactions, date, differenceCents, matches) };
}

/**
 * "Update balance". The figure entered is the bank's POSTED balance (Phase 4A.5.6), signed (Phase 4A.5.8: overdrawn
 * accounts are negative; a card's figure is the amount owed, negative when the card is in credit).
 * - Exact match: no transaction is created; the account's confirmed balance date moves to `date` (Phase 4A.5.8, D8).
 * - A difference that adds up exactly to pending items is refused unless `unrelatedToPending` is set: one of them may
 *   have cleared at the bank, and recording it as an adjustment would count it twice once it is marked posted (D2).
 *   Nothing is marked posted automatically.
 */
export function adjustBalance(
  ctx: Ctx,
  accountId: ID,
  actualBalanceCents: Cents,
  reason: string,
  date: ISODate = ctx.today,
  opts: { unrelatedToPending?: boolean } = {},
): { ops: Op[]; tx: Transaction | null; reconciled: boolean } {
  const a = ctx.data.accounts.find((x) => x.id === accountId) ?? fail('Account not found.');
  if (!Number.isSafeInteger(actualBalanceCents)) fail('Enter a valid balance.', 'balance');
  const p = previewBalanceUpdate(ctx.data, accountId, actualBalanceCents, date);
  const confirmed: Account = { ...a, balanceConfirmedDate: a.balanceConfirmedDate && a.balanceConfirmedDate > date ? a.balanceConfirmedDate : date, updatedAt: ctx.now };
  const confirmOp: Op = { t: 'put', table: 'accounts', value: confirmed };
  if (p.differenceCents === 0) return { ops: [confirmOp], tx: null, reconciled: true };
  const describe = (t: Transaction) => `${t.merchant || t.kind} ${formatCents(t.amountCents, a.currency, { sign: 'always' })} on ${formatShortDate(t.date)}`;
  if (p.matches.length && !opts.unrelatedToPending) {
    const items = [...new Map(p.matches.flat().map((t) => [t.id, t])).values()];
    throw new CommandError([{ field: 'pending_match', message: `The difference (${formatCents(p.differenceCents, a.currency, { sign: 'always' })}) matches pending ${items.length === 1 ? 'item' : 'items'}: ${items.map(describe).join('; ')}. If it has cleared at your bank, mark it posted first; otherwise confirm the difference isn't related.` }]);
  }
  // Phase 4A.5.9: a pending item in the same direction could explain part of the difference
  if (p.partial.length && !opts.unrelatedToPending) {
    throw new CommandError([{ field: 'pending_match', message: `Part of the difference (${formatCents(p.differenceCents, a.currency, { sign: 'always' })}) could be pending ${p.partial.length === 1 ? 'item' : 'items'} that cleared: ${p.partial.map(describe).join('; ')}. If one has cleared, mark it posted first; otherwise confirm the difference isn't related.` }]);
  }
  const unrelated = [...new Map([...p.matches.flat(), ...p.partial].map((t) => [t.id, t])).values()];
  const tx: Transaction = {
    id: ctx.newId('tx'), accountId, date, amountCents: p.differenceCents, kind: 'adjustment', status: 'confirmed', merchant: 'Balance adjustment',
    categoryId: null, notes: unrelated.length ? `Confirmed not related to pending ${unrelated.length === 1 ? 'item' : 'items'} (kept pending): ${unrelated.map(describe).join('; ')}` : '',
    adjustmentReason: reason.trim() || 'Balance updated to match bank', provenance: { source: 'manual' },
    createdAt: ctx.now, updatedAt: ctx.now,
  };
  assertValid(tx, ctx);
  return { ops: [{ t: 'put', table: 'transactions', value: tx }, confirmOp, ...bumpBackupCounter(ctx, 1)], tx, reconciled: true };
}

/** Phase 4A.5.8: mark a pending transaction (both legs of a transfer) posted. Ids, amounts and history are unchanged. */
export function markTransactionPosted(ctx: Ctx, id: ID): Op[] {
  const t = ctx.data.transactions.find((x) => x.id === id) ?? fail('Transaction not found.');
  const legs = t.transferGroupId ? ctx.data.transactions.filter((x) => x.transferGroupId === t.transferGroupId) : [t];
  return legs.map((l): Op => ({ t: 'put', table: 'transactions', value: { ...l, status: 'confirmed', updatedAt: ctx.now } }));
}

const INCLUSION_MESSAGE: Record<InclusionProblem, (name: string, bd: ISODate) => string> = {
  pending: (n) => `A pending transaction can't already be in ${n}'s posted balance. Mark it posted first, or untick “Already included”.`,
  future: (n) => `A future-dated transaction can't already be in ${n}'s balance.`,
  before_opening: (n) => `This is dated before ${n} was added, so it's already history only. Untick “Already included”.`,
  after_balance_date: (n, bd) => `This is dated after ${n}'s confirmed balance (${formatShortDate(bd)}), so it can't already be included in it.`,
};

/**
 * Phase 4A.5.8: "already included" for one account effect (a transaction, or one leg of a transfer), decided against
 * THAT account's confirmed balance date. `requested` true/false is the user's explicit choice (validated, never
 * overridden; allowed from the opening date through the confirmed date). Undefined: on a new transaction, a posted one
 * dated from the opening date to the day BEFORE the confirmed date is history only by default (D6); on an edit, the
 * transaction keeps its current state.
 */
function inclusionFor(ctx: Ctx, accountId: ID, date: ISODate, status: TxStatus, requested: boolean | undefined, prev: Transaction | undefined): Pick<Transaction, 'includedInBalance' | 'includedAsOf'> {
  const acct = ctx.data.accounts.find((a) => a.id === accountId);
  if (!acct) return {};
  const others = prev ? ctx.data.transactions.filter((t) => t.id !== prev.id) : ctx.data.transactions;
  const problem = inclusionProblem(acct, others, date, status, ctx.today);
  const bd = balanceAsOfDate(acct, others);
  // Default (owner decision, Phase 4A.5.8): history only when dated STRICTLY BEFORE the confirmed date; an item dated on
  // that date counts unless the user ticks it (a same-day purchase after reconciling usually isn't in the bank's figure).
  const want = requested ?? (prev ? !!prev.includedInBalance : problem === null && date < bd);
  if (!want) return {};
  if (problem) fail(INCLUSION_MESSAGE[problem](acct.name, bd), 'includedInBalance');
  const asOf = prev?.includedInBalance && prev.includedAsOf && prev.includedAsOf >= date ? prev.includedAsOf : bd;
  return { includedInBalance: true, includedAsOf: asOf };
}

// ───────────────────────── transactions ─────────────────────────

export interface TxInput {
  kind: Exclude<TxKind, 'adjustment'>;
  accountId: ID;
  /** Required for transfers (destination). */
  toAccountId?: ID;
  date: ISODate;
  /** Positive magnitude typed by the user. Direction comes from `kind`. */
  amountCents: Cents;
  merchant: string;
  categoryId: ID | null;
  notes?: string;
  status?: TxStatus;
  /** Positive magnitudes per category; must add up to amountCents. */
  splits?: { categoryId: ID; amountCents: Cents }[];
  refundOfId?: ID;
  occurrenceRef?: { recurringId: ID; originalDate: ISODate };
  /** Where this came from (defaults to manual). Capture keeps the user's words in `rawDescription`. */
  provenance?: Provenance;
  /**
   * Already included in the account's confirmed balance; kept as history only (Phase 4A.5.6). For a transfer this is the
   * SENDING account's effect. true/false = the user's explicit choice; omitted = the default rule (Phase 4A.5.8, D6).
   */
  includedInBalance?: boolean;
  /** Phase 4A.5.8: the same for the RECEIVING account of a transfer, decided against that account's own balance date. */
  toIncludedInBalance?: boolean;
}

function bumpBackupCounter(ctx: Ctx, n: number): Op[] {
  return [{ t: 'put', table: 'settings', value: { ...ctx.data.settings, txSinceBackup: ctx.data.settings.txSinceBackup + n, updatedAt: ctx.now } }];
}

function signFor(kind: TxInput['kind']): 1 | -1 {
  return kind === 'expense' ? -1 : 1;
}

function buildTxs(ctx: Ctx, input: TxInput, ids: { id?: ID; pairId?: ID; groupId?: ID; createdAt?: number; prev?: Transaction; prevPair?: Transaction }): Transaction[] {
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) fail('Enter an amount greater than zero.', 'amount');
  const status: TxStatus = input.status ?? 'confirmed';
  const base = {
    date: input.date,
    status,
    merchant: input.merchant.trim(),
    notes: (input.notes ?? '').trim(),
    provenance: input.provenance ?? { source: 'manual' as const },
    createdAt: ids.createdAt ?? ctx.now,
    updatedAt: ctx.now,
    ...(input.occurrenceRef ? { occurrenceRef: input.occurrenceRef } : {}),
  };
  if (input.kind === 'transfer') {
    if (!input.toAccountId) fail('Choose the account the money goes to.', 'toAccountId');
    const groupId = ids.groupId ?? ctx.newId('tg');
    // Phase 4A.5.8: each leg is one account's effect; "already included" is decided per leg against that account's date.
    const legs: Transaction[] = [
      { ...base, ...inclusionFor(ctx, input.accountId, input.date, status, input.includedInBalance, ids.prev), id: ids.id ?? ctx.newId('tx'), accountId: input.accountId, amountCents: -input.amountCents, kind: 'transfer', categoryId: null, transferGroupId: groupId, merchant: base.merchant || 'Transfer' },
      { ...base, ...inclusionFor(ctx, input.toAccountId!, input.date, status, input.toIncludedInBalance, ids.prevPair), id: ids.pairId ?? ctx.newId('tx'), accountId: input.toAccountId!, amountCents: input.amountCents, kind: 'transfer', categoryId: null, transferGroupId: groupId, merchant: base.merchant || 'Transfer' },
    ];
    const issues = validateTransferPair(legs, ctx.data.accounts);
    if (issues.length) throw new CommandError(issues);
    for (const l of legs) assertValid(l, ctx);
    return legs;
  }
  const sign = signFor(input.kind);
  let splits: Split[] | undefined;
  if (input.splits && input.splits.length > 0) splits = input.splits.map((s) => ({ categoryId: s.categoryId, amountCents: sign * s.amountCents }));
  const tx: Transaction = {
    ...base,
    ...inclusionFor(ctx, input.accountId, input.date, status, input.includedInBalance, ids.prev),
    id: ids.id ?? ctx.newId('tx'),
    accountId: input.accountId,
    amountCents: sign * input.amountCents,
    kind: input.kind,
    categoryId: splits ? null : input.categoryId,
    ...(splits ? { splits } : {}),
    ...(input.refundOfId ? { refundOfId: input.refundOfId } : {}),
  };
  if (!tx.merchant && input.kind !== 'income') fail('Add a merchant or description.', 'merchant');
  assertValid(tx, ctx);
  return [tx];
}

export function addTransaction(ctx: Ctx, input: TxInput): { ops: Op[]; txs: Transaction[]; warnings: string[] } {
  const txs = buildTxs(ctx, input, {});
  const warnings: string[] = [];
  if (input.refundOfId) {
    const orig = ctx.data.transactions.find((t) => t.id === input.refundOfId);
    if (orig && input.amountCents > Math.abs(orig.amountCents)) warnings.push('This refund is larger than the original purchase.');
  }
  return { ops: [...txs.map((value): Op => ({ t: 'put', table: 'transactions', value })), ...bumpBackupCounter(ctx, txs.length)], txs, warnings };
}

/**
 * Several transactions in one atomic change (Clarity Capture "Approve all"): every input is validated
 * with the same rules as a single add; if any one fails, nothing is saved.
 */
export function addTransactions(ctx: Ctx, inputs: readonly TxInput[]): { ops: Op[]; txs: Transaction[] } {
  if (inputs.length === 0) fail('Nothing to save.');
  let data = ctx.data;
  const ops: Op[] = [];
  const txs: Transaction[] = [];
  inputs.forEach((input, i) => {
    let r: ReturnType<typeof addTransaction>;
    try {
      r = addTransaction({ ...ctx, data }, input);
    } catch (e) {
      if (e instanceof CommandError) throw new CommandError(e.issues.map((x) => ({ ...x, message: `Item ${i + 1}: ${x.message}` })));
      throw e;
    }
    ops.push(...r.ops);
    txs.push(...r.txs);
    data = applyLocal(data, r.ops);
  });
  return { ops, txs };
}

/** Transfer legs are always edited together. */
export function updateTransaction(ctx: Ctx, id: ID, input: TxInput): { ops: Op[]; txs: Transaction[] } {
  const existing = ctx.data.transactions.find((t) => t.id === id) ?? fail('Transaction not found.');
  // Phase 4A.5.8: an adjustment is a reconciliation record; editing it as an expense or income would flip its sign.
  if (existing.kind === 'adjustment') fail('Balance adjustments can’t be edited. Delete it, or use Update balance again.');
  const legs = existing.transferGroupId ? ctx.data.transactions.filter((t) => t.transferGroupId === existing.transferGroupId) : [existing];
  const source = legs.find((l) => l.amountCents < 0) ?? legs[0]!;
  const pair = legs.find((l) => l.id !== source.id);
  const ops: Op[] = legs.map((l): Op => ({ t: 'del', table: 'transactions', id: l.id }));
  const txs = buildTxs(ctx, { ...input, ...(existing.occurrenceRef && !input.occurrenceRef ? { occurrenceRef: existing.occurrenceRef } : {}) }, {
    id: source.id,
    ...(pair ? { pairId: pair.id } : {}),
    ...(existing.transferGroupId ? { groupId: existing.transferGroupId } : {}),
    createdAt: existing.createdAt,
    prev: source,
    ...(pair ? { prevPair: pair } : {}),
  });
  for (const t of txs) {
    const prev = legs.find((l) => l.id === t.id);
    if (prev?.provenance) t.provenance = prev.provenance;
  }
  // put after del for the same ids → final state is the put
  return { ops: [...ops.filter((o) => o.t === 'del' && !txs.some((t) => t.id === o.id)), ...txs.map((value): Op => ({ t: 'put', table: 'transactions', value }))], txs };
}

export function deleteTransaction(ctx: Ctx, id: ID): Op[] {
  const t = ctx.data.transactions.find((x) => x.id === id) ?? fail('Transaction not found.');
  const legs = t.transferGroupId ? ctx.data.transactions.filter((x) => x.transferGroupId === t.transferGroupId) : [t];
  return legs.map((l) => ({ t: 'del', table: 'transactions', id: l.id }));
}

// ───────────────────────── recurring ─────────────────────────

export interface RecurringInput {
  name: string;
  kind: RecurringKind;
  accountId: ID;
  toAccountId?: ID;
  categoryId: ID | null;
  schedule: Schedule;
  amount: RecurringAmount;
  weekendRule?: WeekendRule;
  startDate?: ISODate;
  endDate?: ISODate;
}

function validateRecurring(ctx: Ctx, input: RecurringInput) {
  if (!input.name.trim()) fail('Give it a name.', 'name');
  if (!ctx.data.accounts.some((a) => a.id === input.accountId)) fail('Choose an account.', 'accountId');
  if ((input.kind === 'transfer' || input.kind === 'savings') && !input.toAccountId) fail('Choose the destination account.', 'toAccountId');
  if (input.toAccountId && input.toAccountId === input.accountId) fail('Choose two different accounts.', 'toAccountId');
  if (input.amount.type === 'card_full_balance') {
    const to = ctx.data.accounts.find((a) => a.id === input.toAccountId);
    if (to?.type !== 'credit_card') fail('Full-balance payments must go to a credit card.', 'toAccountId');
  }
  if ((input.amount.type === 'fixed' || input.amount.type === 'variable') && (!Number.isSafeInteger(input.amount.cents) || input.amount.cents <= 0)) {
    fail('Enter an amount greater than zero, or choose “It varies”.', 'amount');
  }
  if (input.amount.type === 'unknown' && input.kind !== 'income') fail('Bills need an amount. Use an estimate if it varies.', 'amount');
}

export function createRecurring(ctx: Ctx, input: RecurringInput): { ops: Op[]; item: RecurringItem } {
  validateRecurring(ctx, input);
  const item: RecurringItem = {
    id: ctx.newId('rec'),
    name: input.name.trim(),
    kind: input.kind,
    accountId: input.accountId,
    ...(input.toAccountId ? { toAccountId: input.toAccountId } : {}),
    categoryId: input.categoryId,
    schedule: input.schedule,
    amount: input.amount,
    weekendRule: input.weekendRule ?? 'none',
    startDate: input.startDate ?? '2000-01-01',
    ...(input.endDate ? { endDate: input.endDate } : {}),
    trackFrom: ctx.today,
    paused: false,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  return { ops: [{ t: 'put', table: 'recurring', value: item }], item };
}

export function updateRecurring(ctx: Ctx, id: ID, input: RecurringInput): Op[] {
  const prev = ctx.data.recurring.find((r) => r.id === id) ?? fail('Not found.');
  validateRecurring(ctx, input);
  const next: RecurringItem = {
    ...prev,
    name: input.name.trim(),
    kind: input.kind,
    accountId: input.accountId,
    categoryId: input.categoryId,
    schedule: input.schedule,
    amount: input.amount,
    weekendRule: input.weekendRule ?? prev.weekendRule,
    ...(input.startDate ? { startDate: input.startDate } : {}),
    updatedAt: ctx.now,
  };
  if (input.toAccountId) next.toAccountId = input.toAccountId;
  else delete next.toAccountId;
  if (input.endDate) next.endDate = input.endDate;
  else delete next.endDate;
  return [{ t: 'put', table: 'recurring', value: next }];
}

export function setRecurringPaused(ctx: Ctx, id: ID, paused: boolean): Op[] {
  const prev = ctx.data.recurring.find((r) => r.id === id) ?? fail('Not found.');
  const next: RecurringItem = { ...prev, paused, updatedAt: ctx.now };
  if (paused) next.pausedFrom = ctx.today;
  else {
    delete next.pausedFrom;
    next.trackFrom = ctx.today; // do not report the paused period as overdue
  }
  return [{ t: 'put', table: 'recurring', value: next }];
}

export function deleteRecurring(ctx: Ctx, id: ID): Op[] {
  const ops: Op[] = [{ t: 'del', table: 'recurring', id }];
  for (const e of ctx.data.exceptions) if (e.recurringId === id) ops.push({ t: 'del', table: 'exceptions', id: e.id });
  return ops;
}

export function setOccurrenceException(
  ctx: Ctx,
  occ: Pick<Occurrence, 'recurringId' | 'originalDate'>,
  action: OccurrenceException['action'],
  extra: { newDate?: ISODate; amountCents?: Cents } = {},
): Op[] {
  if (action === 'move' && !extra.newDate) fail('Choose the new date.', 'date');
  if (action === 'override' && (!Number.isSafeInteger(extra.amountCents) || (extra.amountCents ?? 0) <= 0)) fail('Enter an amount greater than zero.', 'amount');
  const prev = ctx.data.exceptions.find((e) => e.recurringId === occ.recurringId && e.originalDate === occ.originalDate);
  const value: OccurrenceException = {
    id: prev?.id ?? ctx.newId('exc'),
    recurringId: occ.recurringId,
    originalDate: occ.originalDate,
    action,
    ...(extra.newDate ? { newDate: extra.newDate } : {}),
    ...(extra.amountCents !== undefined ? { amountCents: extra.amountCents } : {}),
    createdAt: prev?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  };
  return [{ t: 'put', table: 'exceptions', value }];
}

export function clearOccurrenceException(ctx: Ctx, occ: Pick<Occurrence, 'recurringId' | 'originalDate'>): Op[] {
  const prev = ctx.data.exceptions.find((e) => e.recurringId === occ.recurringId && e.originalDate === occ.originalDate);
  return prev ? [{ t: 'del', table: 'exceptions', id: prev.id }] : [];
}

/** "Mark paid / received": creates the real transaction linked to the occurrence. */
export function recordOccurrence(ctx: Ctx, occ: Occurrence, input: { date: ISODate; amountCents: Cents; accountId?: ID }): { ops: Op[]; txs: Transaction[] } {
  const item = ctx.data.recurring.find((r) => r.id === occ.recurringId) ?? fail('Not found.');
  const kind: TxInput['kind'] = item.kind === 'income' ? 'income' : item.kind === 'transfer' || item.kind === 'savings' ? 'transfer' : 'expense';
  return addTransaction(ctx, {
    kind,
    accountId: input.accountId ?? item.accountId,
    ...(item.toAccountId ? { toAccountId: item.toAccountId } : {}),
    date: input.date,
    amountCents: input.amountCents,
    merchant: item.name,
    categoryId: kind === 'transfer' ? null : item.categoryId,
    occurrenceRef: { recurringId: occ.recurringId, originalDate: occ.originalDate },
  });
}

// ───────────────────────── categories ─────────────────────────

export function createCategory(ctx: Ctx, input: { name: string; kind: Category['kind']; icon?: string; group?: string }): { ops: Op[]; category: Category } {
  const name = input.name.trim();
  if (!name) fail('Give the category a name.', 'name');
  if (ctx.data.categories.some((c) => !c.archived && c.name.toLowerCase() === name.toLowerCase())) fail('A category with this name already exists.', 'name');
  const category: Category = { id: ctx.newId('cat'), name, kind: input.kind, icon: input.icon ?? 'tag', group: input.group ?? 'Custom', archived: false, createdAt: ctx.now, updatedAt: ctx.now };
  return { ops: [{ t: 'put', table: 'categories', value: category }], category };
}

export function updateCategory(ctx: Ctx, id: ID, patch: Partial<Pick<Category, 'name' | 'archived' | 'icon' | 'budgetCents'>>): Op[] {
  const c = ctx.data.categories.find((x) => x.id === id) ?? fail('Category not found.');
  if (patch.name !== undefined && !patch.name.trim()) fail('Give the category a name.', 'name');
  if (patch.budgetCents !== undefined && patch.budgetCents !== null) {
    if (!Number.isSafeInteger(patch.budgetCents) || patch.budgetCents < 0) fail('Enter a budget of zero or more.', 'budget');
    if (c.kind !== 'expense') fail('Only spending categories can have a budget.', 'budget');
  }
  return [{ t: 'put', table: 'categories', value: { ...c, ...patch, updatedAt: ctx.now } }];
}

// ───────────────────────── import ─────────────────────────

export interface ImportDecision {
  candidate: ImportCandidate;
  /** Edited values from the review screen. */
  kind: 'expense' | 'income' | 'refund' | 'transfer';
  categoryId: ID | null;
  merchant: string;
  /** Required when kind is 'transfer'. */
  otherAccountId?: ID;
  linkOccurrence: boolean;
}

export interface CommitImportInput {
  accountId: ID;
  fileName: string;
  fileHash: string;
  parserId: string;
  headerSignature: string;
  delimiter: string;
  settings: ImportSettings;
  decisions: ImportDecision[];
  totalRows: number;
  excludedCount: number;
  duplicateCount: number;
  errorCount: number;
  reconciliation: ReconciliationPreview | null;
  /** Explicit user choice to record the reconciliation difference as an adjustment. */
  applyAdjustment: boolean;
  /** Phase 4A.5.9: the user confirmed the difference isn't explained by the pending items the reconciliation names. */
  adjustmentUnrelatedToPending?: boolean;
}

/** Writes every approved row, the batch record and the saved column mapping in one atomic batch. */
export function commitImport(ctx: Ctx, input: CommitImportInput): { ops: Op[]; batch: ImportBatch; txs: Transaction[] } {
  const account = ctx.data.accounts.find((a) => a.id === input.accountId) ?? fail('Account not found.');
  const batchId = ctx.newId('imp');
  const ops: Op[] = [];
  const txs: Transaction[] = [];
  for (const d of input.decisions) {
    const c = d.candidate;
    const provenance = {
      source: 'import' as const,
      importBatchId: batchId,
      rowNumber: c.rowNumber,
      rawDescription: c.rawDescription,
      ...(c.externalId ? { externalId: c.externalId } : {}),
    };
    const occurrenceRef = d.linkOccurrence && c.occurrenceMatch ? { occurrenceRef: { recurringId: c.occurrenceMatch.recurringId, originalDate: c.occurrenceMatch.originalDate } } : {};
    if (d.kind === 'transfer') {
      if (!d.otherAccountId) fail(`Row ${c.rowNumber}: choose the other account for this transfer.`);
      const groupId = ctx.newId('tg');
      const legA: Transaction = {
        id: ctx.newId('tx'), accountId: account.id, date: c.date, amountCents: c.amountCents, kind: 'transfer', status: 'confirmed',
        merchant: d.merchant || c.merchant || 'Transfer', categoryId: null, notes: '', transferGroupId: groupId, provenance, createdAt: ctx.now, updatedAt: ctx.now, ...occurrenceRef,
      };
      // Phase 4A.5.8: "already included" is decided per leg against each account's confirmed balance date (D6, D5).
      Object.assign(legA, inclusionFor(ctx, account.id, c.date, 'confirmed', undefined, undefined));
      const legB: Transaction = { ...legA, includedInBalance: undefined, includedAsOf: undefined, ...inclusionFor(ctx, d.otherAccountId!, c.date, 'confirmed', undefined, undefined), id: ctx.newId('tx'), accountId: d.otherAccountId!, amountCents: -c.amountCents, provenance: { source: 'import', importBatchId: batchId } };
      if (!legB.includedInBalance) { delete legB.includedInBalance; delete legB.includedAsOf; }
      const issues = validateTransferPair([legA, legB], ctx.data.accounts);
      if (issues.length) throw new CommandError(issues.map((i) => ({ ...i, message: `Row ${c.rowNumber}: ${i.message}` })));
      txs.push(legA, legB);
      continue;
    }
    const amount = d.kind === 'expense' ? -Math.abs(c.amountCents) : Math.abs(c.amountCents);
    if (Math.sign(amount) !== Math.sign(c.amountCents)) fail(`Row ${c.rowNumber}: “${d.kind}” doesn't match the direction of the amount.`);
    const tx: Transaction = {
      id: ctx.newId('tx'), accountId: account.id, date: c.date, amountCents: amount, kind: d.kind, status: 'confirmed',
      merchant: d.merchant.trim() || c.merchant || c.rawDescription || 'Imported transaction', categoryId: d.categoryId, notes: '', provenance,
      createdAt: ctx.now, updatedAt: ctx.now, ...occurrenceRef,
      // Phase 4A.5.8 (D6): a row dated before the account's confirmed balance date is already in that balance
      ...inclusionFor(ctx, account.id, c.date, 'confirmed', undefined, undefined),
    };
    const issues = validateTransaction(tx, ctx.data.accounts, ctx.data.categories);
    if (issues.length) throw new CommandError(issues.map((i) => ({ ...i, message: `Row ${c.rowNumber}: ${i.message}` })));
    txs.push(tx);
  }
  for (const t of txs) ops.push({ t: 'put', table: 'transactions', value: t });

  let adjustmentId: ID | undefined;
  if (input.applyAdjustment && input.reconciliation && input.reconciliation.differenceCents !== 0 && !input.reconciliation.note) {
    // Phase 4A.5.9: the same safeguard as Update balance: a difference that pending items could explain isn't recorded
    // until the user resolves them (mark posted) or confirms it isn't related; nothing is posted automatically.
    const named = [...(input.reconciliation.pendingMatches ?? []).flat(), ...(input.reconciliation.pendingPartial ?? [])];
    const items = [...new Map(named.map((t) => [t.id, t])).values()];
    const list = items.map((t) => `${t.merchant || t.kind} ${formatCents(t.amountCents, account.currency, { sign: 'always' })} on ${formatShortDate(t.date)}`).join('; ');
    if (items.length && !input.adjustmentUnrelatedToPending) fail(`The statement difference could be pending ${items.length === 1 ? 'item' : 'items'} that cleared: ${list}. Mark it posted first, or confirm the difference isn't related.`, 'pending_match');
    const adj: Transaction = {
      id: ctx.newId('tx'), accountId: account.id, date: input.reconciliation.statementDate, amountCents: input.reconciliation.differenceCents,
      kind: 'adjustment', status: 'confirmed', merchant: 'Balance adjustment', categoryId: null, notes: items.length ? `Confirmed not related to pending ${items.length === 1 ? 'item' : 'items'} (kept pending): ${list}` : '',
      adjustmentReason: `Matched closing balance on imported statement ${input.fileName}`, provenance: { source: 'import', importBatchId: batchId },
      createdAt: ctx.now, updatedAt: ctx.now,
    };
    ops.push({ t: 'put', table: 'transactions', value: adj });
    adjustmentId = adj.id;
  }

  const existingProfile = ctx.data.mappingProfiles.find((p) => p.headerSignature === input.headerSignature);
  const profile: MappingProfile = {
    id: existingProfile?.id ?? ctx.newId('map'),
    headerSignature: input.headerSignature,
    delimiter: input.delimiter,
    hasHeader: input.settings.hasHeader,
    columns: input.settings.columns,
    dateFormat: input.settings.dateFormat,
    decimalSeparator: input.settings.decimalSeparator,
    signConvention: input.settings.signConvention,
    createdAt: existingProfile?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
  };
  if (input.settings.hasHeader) ops.push({ t: 'put', table: 'mappingProfiles', value: profile });

  const batch: ImportBatch = {
    id: batchId,
    fileName: input.fileName,
    fileHash: input.fileHash,
    parserId: input.parserId,
    mappingProfileId: input.settings.hasHeader ? profile.id : null,
    accountId: account.id,
    importedAt: ctx.now,
    counts: { rows: input.totalRows, imported: input.decisions.length, excluded: input.excludedCount, duplicates: input.duplicateCount, errors: input.errorCount },
    reconciliation: input.reconciliation
      ? {
          statementBalanceCents: input.reconciliation.statementBalanceCents,
          statementBalanceDate: input.reconciliation.statementDate,
          appBalanceCents: input.reconciliation.appBalanceCents,
          differenceCents: input.reconciliation.differenceCents,
          runningBalanceConsistent: input.reconciliation.runningBalanceConsistent,
          ...(adjustmentId ? { adjustmentTransactionId: adjustmentId } : {}),
        }
      : null,
    undoneAt: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  ops.push({ t: 'put', table: 'importBatches', value: batch });
  ops.push(...bumpBackupCounter(ctx, txs.length));
  return { ops, batch, txs };
}

/** Remove every transaction created by an import (including transfer legs and adjustment). */
export function undoImportBatch(ctx: Ctx, batchId: ID): Op[] {
  const batch = ctx.data.importBatches.find((b) => b.id === batchId) ?? fail('Import not found.');
  if (batch.undoneAt) fail('This import was already undone.');
  const ops: Op[] = [];
  const groups = new Set<string>();
  for (const t of ctx.data.transactions) {
    if (t.provenance.importBatchId === batchId) {
      ops.push({ t: 'del', table: 'transactions', id: t.id });
      if (t.transferGroupId) groups.add(t.transferGroupId);
    }
  }
  for (const t of ctx.data.transactions) {
    if (t.transferGroupId && groups.has(t.transferGroupId) && t.provenance.importBatchId !== batchId) ops.push({ t: 'del', table: 'transactions', id: t.id });
  }
  ops.push({ t: 'put', table: 'importBatches', value: { ...batch, undoneAt: ctx.now, updatedAt: ctx.now } });
  return ops;
}

// ───────────────────────── onboarding ─────────────────────────

export interface OnboardingInput {
  checkingName?: string;
  checkingBalanceCents: Cents;
  pay?: {
    schedule: Schedule;
    /** null = "It varies" / skipped */
    amountCents: Cents | null;
  };
  /** Several paychecks into the same account (for example a shared account with a partner). Created after `pay`. */
  pays?: { name: string; schedule: Schedule; amountCents: Cents | null }[];
  bill?: { name: string; amountCents: Cents; date: ISODate; monthly: boolean };
  currency?: string;
}

export function onboard(ctx: Ctx, input: OnboardingInput): Op[] {
  let data = ctx.data;
  const ops: Op[] = [];
  const step = (r: Op[]) => {
    ops.push(...r);
    data = applyLocal(data, r);
  };
  const c = () => ({ ...ctx, data });
  if (data.categories.length === 0) step(seedCategories(c()));
  if (input.currency) step(updateSettings(c(), { baseCurrency: input.currency }));
  const { ops: aOps, account } = createAccount(c(), { name: input.checkingName ?? 'Checking', type: 'checking', currentBalanceCents: input.checkingBalanceCents });
  step(aOps);
  if (input.pay) {
    const { ops: pOps } = createRecurring(c(), {
      name: 'Paycheck', kind: 'income', accountId: account.id, categoryId: 'cat_paycheck', schedule: input.pay.schedule,
      amount: input.pay.amountCents === null ? { type: 'unknown' } : { type: 'fixed', cents: input.pay.amountCents },
    });
    step(pOps);
  }
  for (const p of input.pays ?? []) {
    const { ops: pOps } = createRecurring(c(), {
      name: p.name.trim() || 'Paycheck', kind: 'income', accountId: account.id, categoryId: 'cat_paycheck', schedule: p.schedule,
      amount: p.amountCents === null ? { type: 'unknown' } : { type: 'fixed', cents: p.amountCents },
    });
    step(pOps);
  }
  if (input.bill) {
    const { ops: bOps } = createRecurring(c(), {
      name: input.bill.name, kind: 'bill', accountId: account.id, categoryId: null,
      schedule: input.bill.monthly
        ? { freq: 'monthly', interval: 1, day: Number(input.bill.date.slice(8, 10)), anchor: input.bill.date }
        : { freq: 'once', date: input.bill.date },
      amount: { type: 'fixed', cents: input.bill.amountCents },
    });
    step(bOps);
  }
  step(updateSettings(c(), { onboardingComplete: true }));
  return ops;
}


export const todayFrom = (d: Date) => localISODate(d);
