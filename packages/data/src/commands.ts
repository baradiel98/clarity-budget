import {
  defaultCategories, formatCents, formatShortDate, localISODate, MATCH_AMOUNT_NOTE, MATCH_PARTIAL_RETURN_LABEL, MATCH_PARTIAL_RETURN_NOTE, RETURN_ROW_TEXT, MATCH_RETURN_LABEL, MATCH_RETURN_NOTE, MATCH_FEE_LABEL, MATCH_FEE_NOTE, MATCH_NOT_FEE, MATCH_PENDING_NOTE, MATCH_POSTED_NOTE, MATCH_TRANSFER_NOTE, type Account, type AccountType, type Cents, type Category, type ID, type ISODate, type ImportBatch,
  type MappingProfile, type OccurrenceException, type Provenance, type RecurringAmount, type RecurringItem, type RecurringKind, type Schedule, type Settings,
  type Split, type Transaction, type TxKind, type TxStatus, type WeekendRule, type WorkspaceData,
} from '@clarity/shared';
import { accountBalance, balanceAsOfDate, inclusionProblem, paymentReturnStatus, pendingMatches, pendingPartialMatches, postedBalance, validateTransaction, validateTransferPair, type InclusionProblem, type Occurrence, type ValidationIssue } from '@clarity/engine';
import { candidateLabel, feeOfLeg, findExactDuplicate, findMatchCandidates, findReturnCandidates, sameSnapshot, snapshotOf, type CandidateSnapshot, type ImportCandidate, type ImportSettings, type MatchCandidate, type ReconciliationPreview } from '@clarity/import';
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

/**
 * Phase 4A.5.8: mark a pending transaction posted. Phase 4A.5.14: ONE leg only: a transfer's other leg settles on its
 * own (the receiving bank may not have posted it yet). A transfer fee recorded on this leg's account posts with it
 * (the bank shows them as one row). Ids, amounts and history are unchanged.
 */
export function markTransactionPosted(ctx: Ctx, id: ID): Op[] {
  const t = ctx.data.transactions.find((x) => x.id === id) ?? fail('Transaction not found.');
  if (t.status !== 'pending') return [];
  const fee = feeOfLeg(t, ctx.data.transactions);
  return [t, ...(fee && fee.status === 'pending' ? [fee] : [])].map((l): Op => { const pd = postedDateOnManualPosting(ctx, l.accountId, l.date); return { t: 'put', table: 'transactions', value: { ...l, status: 'confirmed', ...(pd ? { postedDate: pd } : {}), updatedAt: ctx.now } }; });
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
  /**
   * Phase 4A.5.14: for a transfer, the RECEIVING leg's status (each leg settles on its own: "Sent · awaiting deposit"
   * is a posted sending leg with a pending receiving leg). `status` is the sending leg's. Omitted: on a new transfer,
   * the same as `status`; on an edit, the receiving leg keeps its own status unless `status` changed.
   */
  toStatus?: TxStatus;
}

function bumpBackupCounter(ctx: Ctx, n: number): Op[] {
  return [{ t: 'put', table: 'settings', value: { ...ctx.data.settings, txSinceBackup: ctx.data.settings.txSinceBackup + n, updatedAt: ctx.now } }];
}

function signFor(kind: TxInput['kind']): 1 | -1 {
  return kind === 'expense' ? -1 : 1;
}

/**
 * Phase 4A.5.14: one leg's (or transaction's) status and posting date on save. A transaction linked to a statement row
 * can't be made pending here: the statement shows it posted (undo that import instead). An unchanged status keeps
 * its posting date. A posting date is only ever recorded from a statement row (the bank's own date); marked posted
 * by hand, the day it really posted isn't known, so the transaction counts as posted from its own date.
 */
function settled(ctx: Ctx, prev: Transaction | undefined, status: TxStatus, accountId: ID, date: ISODate): Pick<Transaction, 'status' | 'postedDate'> {
  if (prev?.statementMatch && status !== prev.status) {
    fail(`“${prev.merchant || prev.kind}” is linked to a statement row (${formatShortDate(prev.statementMatch.date)}), which shows it posted. To make it pending again, undo that import.`, 'status');
  }
  if (status === 'pending') return { status };
  if (prev && prev.status === status && prev.postedDate) return { status, postedDate: prev.postedDate };
  // Phase 4A.5.17: a pending item dated before the account was added, now posted: it wasn't in the opening balance
  if (prev && prev.status === 'pending') { const pd = postedDateOnManualPosting(ctx, accountId, date); if (pd) return { status, postedDate: pd }; }
  return { status };
}

/**
 * Phase 4A.5.17: the posting date to record when a pending item is marked posted by hand. Usually none (the real day
 * isn't known, so it counts from its own date); but for an item dated before its account was added, today, so it
 * keeps counting (it wasn't in the opening balance, which is the posted balance on the opening date).
 */
function postedDateOnManualPosting(ctx: Ctx, accountId: ID, date: ISODate): ISODate | undefined {
  const a = ctx.data.accounts.find((x) => x.id === accountId);
  return a && date < a.openingDate ? (ctx.today > a.openingDate ? ctx.today : a.openingDate) : undefined;
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
    // Phase 4A.5.14: each leg has its own status. On an edit that doesn't change the sending status, the receiving leg
    // keeps its own (an older caller that doesn't know about legs can't post or un-post the other side by accident).
    const toStatus: TxStatus = input.toStatus ?? (ids.prev && ids.prevPair && ids.prev.status === status ? ids.prevPair.status : status);
    // Phase 4A.5.8: each leg is one account's effect; "already included" is decided per leg against that account's date.
    const legs: Transaction[] = [
      { ...base, ...settled(ctx, ids.prev, status, input.accountId, input.date), ...inclusionFor(ctx, input.accountId, input.date, status, input.includedInBalance, ids.prev), id: ids.id ?? ctx.newId('tx'), accountId: input.accountId, amountCents: -input.amountCents, kind: 'transfer', categoryId: null, transferGroupId: groupId, merchant: base.merchant || 'Transfer' },
      { ...base, ...settled(ctx, ids.prevPair, toStatus, input.toAccountId!, input.date), ...inclusionFor(ctx, input.toAccountId!, input.date, toStatus, input.toIncludedInBalance, ids.prevPair), id: ids.pairId ?? ctx.newId('tx'), accountId: input.toAccountId!, amountCents: input.amountCents, kind: 'transfer', categoryId: null, transferGroupId: groupId, merchant: base.merchant || 'Transfer' },
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
    ...settled(ctx, ids.prev, status, input.accountId, input.date),
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
    if (prev?.statementMatch) t.statementMatch = prev.statementMatch; // Phase 4A.5.10: the link survives edits
  }
  // put after del for the same ids → final state is the put
  return { ops: [...ops.filter((o) => o.t === 'del' && !txs.some((t) => t.id === o.id)), ...txs.map((value): Op => ({ t: 'put', table: 'transactions', value }))], txs };
}

export function deleteTransaction(ctx: Ctx, id: ID): Op[] {
  const t = ctx.data.transactions.find((x) => x.id === id) ?? fail('Transaction not found.');
  // Phase 4A.5.14: a transfer's confirmed fee belongs to it and goes with it
  // Phase 4A.5.18: and its recorded returns (a return of a payment that never happened can't stand on its own)
  const legs = t.transferGroupId ? ctx.data.transactions.filter((x) => x.transferGroupId === t.transferGroupId || x.transferFeeOf === t.transferGroupId || (!t.returnOf && x.returnOf === t.transferGroupId)) : [t];
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
  /**
   * Phase 4A.5.12: required when the row could be an existing transaction (its live match candidates, recomputed here
   * from the current data). { txId }: the row IS that transaction (pending → posted; a posted transfer leg → linked);
   * nothing new is added. { none, seen }: a different transaction, imported; `seen` must list EVERY current candidate.
   * Phase 4A.5.14: `snapshot` / `seen` carry what the user saw (CandidateSnapshot); a decision about a candidate that
   * changed since (amount, date, status, account, any edit, or linked by another import) is refused. A bare id is
   * checked against the review's own snapshot. `fee`: the user confirmed the difference on a transfer leg is a fee.
   */
  match?: { txId: ID; snapshot?: CandidateSnapshot; fee?: { feeCents: Cents } } | { none: true; seen: (ID | CandidateSnapshot)[] };
  /** Phase 4A.5.10 form, still accepted: same → { txId }; not same → { none, seen: [txId] }. */
  pendingResolution?: { txId: ID; same: boolean };
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
  /**
   * Phase 4A.5.14: ids of existing transactions the review recognised as rows of this statement already in Clarity
   * (exact duplicates, left out). The commit re-checks every other row against the current data and refuses one that
   * is now already in Clarity (added or linked since the review opened, e.g. in another tab).
   */
  knownDuplicateIds?: ID[];
}

const txLabel = (t: Transaction | undefined, currency: string) => (t ? `“${t.merchant || t.kind}” (${formatShortDate(t.date)}, ${formatCents(t.amountCents, currency, { sign: 'always' })})` : 'a transaction that no longer exists');

/** Phase 4A.5.14: the category a confirmed transfer fee is filed under (the default "Fees & interest", if present). */
const feeCategory = (ctx: Ctx): ID | null => ctx.data.categories.find((c) => c.id === 'cat_fees' && !c.archived)?.id ?? null;

/**
 * Writes every approved row, the batch record and the saved column mapping in one atomic batch.
 * Phase 4A.5.14: each statement row affects only ITS account: linking a transfer leg posts that leg alone; a transfer
 * created from a row posts this account's leg and leaves the other account's leg pending (awaiting that bank), unless
 * that account's confirmed balance already includes it. Decisions are checked against the current data and refused
 * if anything they depend on changed since the review was built.
 */
export function commitImport(ctx: Ctx, input: CommitImportInput): { ops: Op[]; batch: ImportBatch; txs: Transaction[] } {
  const account = ctx.data.accounts.find((a) => a.id === input.accountId) ?? fail('Account not found.');
  const cur = account.currency;
  const batchId = ctx.newId('imp');
  const ops: Op[] = [];
  const txs: Transaction[] = [];
  const matchedIds = new Set<ID>();
  const returnedInCommit = new Map<ID, Cents>(); // Phase 4A.5.18: amount returned per payment by this commit
  const touched = new Map<ID, Transaction>(); // existing transactions changed by this commit (latest version)
  const get = (id: ID) => touched.get(id) ?? ctx.data.transactions.find((t) => t.id === id);
  const put = (t: Transaction) => touched.set(t.id, t);
  let created = 0, markedPosted = 0, fees = 0, returns = 0;
  const transferGroups = new Set<ID>();
  const acctTx = ctx.data.transactions.filter((t) => t.accountId === account.id);
  const known = new Set(input.knownDuplicateIds ?? []);
  for (const d of input.decisions) {
    const c = d.candidate;
    // Phase 4A.5.14 (D9): a row that wasn't already in Clarity when the review was built must not be now; otherwise
    // something else (another tab, an earlier commit of the same review) added or linked it since.
    if (c.duplicate?.level !== 'exact') {
      const ex = findExactDuplicate(c, acctTx, known);
      if (ex) fail(`Row ${c.rowNumber}: this statement row is already in Clarity as ${txLabel(ex, cur)}; it was added or linked after this review was opened (for example in another tab). Review the statement again.`, 'stale');
    }
    // Phase 4A.5.12: the data layer decides with the CURRENT data, not the review's: which transactions could this row
    // be? (Those listed when the review was built stay included, even if posted since.) Never merged automatically.
    const live = findMatchCandidates(c, account, ctx.data.transactions, { alsoIds: (c.matchCandidates ?? []).map((m) => m.txId), accounts: ctx.data.accounts });
    const legacy: ImportDecision['match'] = d.pendingResolution ? (d.pendingResolution.same ? { txId: d.pendingResolution.txId } : { none: true as const, seen: [d.pendingResolution.txId] }) : undefined;
    const choice = d.match ?? legacy;
    const label = (id: ID) => txLabel(ctx.data.transactions.find((x) => x.id === id), cur);
    const reviewed = (id: ID): CandidateSnapshot | undefined => { const m = (c.matchCandidates ?? []).find((x) => x.txId === id); return m && snapshotOf(m); };
    const changed = (id: ID) => fail(`Row ${c.rowNumber}: ${label(id)} changed after you reviewed this row (its amount, date, status or details, or it was linked to another statement row). Review it again.`, 'stale');
    if (choice && 'txId' in choice) {
      const cand = live.find((m) => m.txId === choice.txId) ?? fail(`Row ${c.rowNumber}: ${label(choice.txId)} is no longer a possible match for this row; review it again.`, 'match');
      const seenSnap = choice.snapshot ?? reviewed(choice.txId);
      if (!seenSnap || !sameSnapshot(seenSnap, snapshotOf(cand))) changed(choice.txId);
      // one link per transaction; one return per payment (Phase 4A.5.17: the same statement can hold a payment's debit
      // AND its return, so a link and a return of the same payment may appear together)
      // (Phase 4A.5.18: several partial returns of one payment may be in a statement; their total is capped below)
      if (cand.basis !== 'return' && matchedIds.has(choice.txId)) fail(`Row ${c.rowNumber}: ${label(choice.txId)} is already chosen for another row of this statement.`, 'match');
      // Phase 4A.5.17: the user confirmed this row is the RETURN of that card payment (rejected, returned or reversed).
      // Recorded as a transfer back (returnOf = the payment): this account's side is the statement row (posted); the
      // other side is pending, awaiting that institution. The payment itself is not changed or posted; it simply no
      // longer counts as paying the card. If the card issuer never posted the payment, the two card-side legs cancel.
      if (cand.basis === 'return') {
        if (choice.fee) fail(`Row ${c.rowNumber}: a returned payment has no transfer fee to confirm.`, 'match');
        const leg = get(cand.txId)!;
        const already = returnedInCommit.get(leg.transferGroupId!) ?? 0;
        const r = buildPaymentReturn(ctx, {
          leg, accountId: account.id, amountCents: Math.abs(c.amountCents), date: c.date, status: 'confirmed', extraReturned: already,
          provenance: { source: 'import', importBatchId: batchId, rowNumber: c.rowNumber, rawDescription: c.rawDescription, rowDate: c.date, rowAmountCents: c.amountCents, ...(c.externalId ? { externalId: c.externalId } : {}) },
          note: `confirmed when importing ${input.fileName} (row ${c.rowNumber})`, where: `Row ${c.rowNumber}: `,
        });
        returnedInCommit.set(leg.transferGroupId!, already + Math.abs(c.amountCents));
        Object.assign(r.here, inclusionFor(ctx, account.id, c.date, 'confirmed', undefined, undefined));
        r.there.provenance = { source: 'import', importBatchId: batchId };
        txs.push(r.here, r.there);
        returns++;
        continue;
      }
      // Phase 4A.5.14: a transfer leg whose amount differs can only be linked with the difference explained as a fee
      // the user confirms; nothing else is recorded silently.
      if (cand.kind === 'transfer' && cand.differenceCents !== 0) {
        if (!cand.feeOption) fail(`Row ${c.rowNumber}: ${label(cand.txId)} is a transfer of ${formatCents(cand.amountCents, cur, { sign: 'always' })}; the statement shows ${formatCents(c.amountCents, cur, { sign: 'always' })}. That difference can't be a transfer fee, so the row can't be linked to it. Leave the row out and check the transfer.`, 'match');
        if (choice.fee?.feeCents !== cand.feeOption!.feeCents) fail(`Row ${c.rowNumber}: the statement shows ${formatCents(c.amountCents, cur, { sign: 'always' })} for the transfer ${label(cand.txId)}. Confirm the ${formatCents(cand.feeOption!.feeCents, cur)} transfer fee, or leave the row out.`, 'match');
      } else if (choice.fee) fail(`Row ${c.rowNumber}: there is no difference to record as a transfer fee.`, 'match');
      const leg = get(choice.txId)!;
      matchedIds.add(leg.id);
      const wasPending = leg.status === 'pending';
      if (wasPending) markedPosted++;
      const sm: NonNullable<Transaction['statementMatch']> = {
        importBatchId: batchId, rowNumber: c.rowNumber, date: c.date, rawDescription: c.rawDescription, ...(c.externalId ? { externalId: c.externalId } : {}),
        previousStatus: leg.status, amountCents: c.amountCents, setStatus: wasPending, ...(leg.postedDate ? { previousPostedDate: leg.postedDate } : {}),
      };
      const postedDate = wasPending ? (c.date > leg.date ? c.date : undefined) : leg.postedDate;
      const updated: Transaction = { ...leg, status: 'confirmed', updatedAt: ctx.now, statementMatch: sm };
      if (postedDate) updated.postedDate = postedDate; else delete updated.postedDate;
      const existingFee = feeOfLeg(leg, ctx.data.transactions);
      if (existingFee && existingFee.status === 'pending') {
        put({ ...existingFee, status: 'confirmed', ...(postedDate ? { postedDate } : {}), updatedAt: ctx.now });
        sm.postedFeeTxId = existingFee.id;
      }
      if (cand.feeOption && choice.fee) {
        const opt = cand.feeOption;
        const partner = get(ctx.data.transactions.find((t) => t.transferGroupId === leg.transferGroupId && t.id !== leg.id)!.id)!;
        const feeTx: Transaction = {
          id: ctx.newId('tx'), accountId: opt.chargedToAccountId, date: leg.date, amountCents: -opt.feeCents, kind: 'expense', status: 'confirmed',
          merchant: 'Transfer fee', categoryId: feeCategory(ctx), notes: `Fee on the transfer “${leg.merchant || 'Transfer'}”, confirmed when importing ${input.fileName} (row ${c.rowNumber}).`,
          transferFeeOf: leg.transferGroupId!, provenance: { source: 'import', importBatchId: batchId }, createdAt: ctx.now, updatedAt: ctx.now,
        };
        if (leg.amountCents > 0) {
          // receiving leg: what arrived is the transfer amount (both sides); the fee is charged to the sending account
          // with the sending leg's own status, so the sending total (and that bank's balance) is unchanged
          sm.fee = { feeTxId: feeTx.id, previousPrincipalCents: leg.amountCents };
          updated.amountCents = c.amountCents;
          put({ ...partner, amountCents: -c.amountCents, updatedAt: ctx.now });
          feeTx.status = partner.status;
          if (partner.postedDate) feeTx.postedDate = partner.postedDate;
        } else {
          // sending leg: more left this account than was transferred; the fee is charged here, the transfer is unchanged
          sm.fee = { feeTxId: feeTx.id, previousPrincipalCents: null };
          if (postedDate) feeTx.postedDate = postedDate;
        }
        assertValid(feeTx, ctx);
        txs.push(feeTx);
        fees++;
      }
      put(updated);
      if (leg.transferGroupId) transferGroups.add(leg.transferGroupId);
      continue;
    }
    // a row that had candidates when the review was built always needs a decision, even if they have been linked
    // since (e.g. the same review committed twice): it is never imported silently
    if (!choice && !live.length && c.matchCandidates?.length) fail(`Row ${c.rowNumber}: this row needed a decision and the transactions it could be have changed; review it again.`, 'match');
    if (live.length && !choice) fail(`Row ${c.rowNumber}: this could be ${live.length === 1 ? label(live[0]!.txId) : `one of ${live.length} transactions already in Clarity (${live.map((m) => label(m.txId)).join('; ')})`}. Choose which one, or confirm it's a different transaction.`, 'match');
    if (choice && 'none' in choice) {
      const seen = choice.seen.map((x) => (typeof x === 'string' ? reviewed(x) ?? ({ txId: x } as CandidateSnapshot) : x));
      const unseen = live.filter((m) => !seen.some((s) => s.txId === m.txId));
      if (unseen.length) fail(`Row ${c.rowNumber}: ${unseen.map((m) => label(m.txId)).join('; ')} could also be this row and wasn't reviewed; review it again.`, 'match');
      // Phase 4A.5.14 (D9): every candidate the user ruled out must be exactly as they saw it, and still a candidate
      // (not edited, posted, deleted, or linked to another statement row since).
      for (const s of seen) { const m = live.find((x) => x.txId === s.txId); if (!m || !sameSnapshot(s, snapshotOf(m))) changed(s.txId); }
    }
    const separateFrom = choice && 'none' in choice ? live.map((m) => m.txId) : [];
    const provenance = {
      source: 'import' as const,
      importBatchId: batchId,
      rowNumber: c.rowNumber,
      rawDescription: c.rawDescription,
      rowDate: c.date,
      rowAmountCents: c.amountCents,
      ...(c.externalId ? { externalId: c.externalId } : {}),
    };
    const occurrenceRef = d.linkOccurrence && c.occurrenceMatch ? { occurrenceRef: { recurringId: c.occurrenceMatch.recurringId, originalDate: c.occurrenceMatch.originalDate } } : {};
    created++;
    if (d.kind === 'transfer') {
      if (!d.otherAccountId) fail(`Row ${c.rowNumber}: choose the other account for this transfer.`);
      const groupId = ctx.newId('tg');
      const legA: Transaction = {
        id: ctx.newId('tx'), accountId: account.id, date: c.date, amountCents: c.amountCents, kind: 'transfer', status: 'confirmed',
        merchant: d.merchant || c.merchant || 'Transfer', categoryId: null, notes: '', transferGroupId: groupId, provenance: { ...provenance, ...(separateFrom.length ? { separateFrom } : {}) }, createdAt: ctx.now, updatedAt: ctx.now, ...occurrenceRef,
      };
      // Phase 4A.5.8: "already included" is decided per leg against each account's confirmed balance date (D6, D5).
      Object.assign(legA, inclusionFor(ctx, account.id, c.date, 'confirmed', undefined, undefined));
      // Phase 4A.5.14: the other account's bank hasn't necessarily posted its side: that leg is pending (awaiting its
      // statement), unless it is dated before that account's confirmed balance, which already includes it.
      const otherInc = inclusionFor(ctx, d.otherAccountId!, c.date, 'confirmed', undefined, undefined);
      const legB: Transaction = { ...legA, includedInBalance: undefined, includedAsOf: undefined, ...otherInc, status: otherInc.includedInBalance ? 'confirmed' : 'pending', id: ctx.newId('tx'), accountId: d.otherAccountId!, amountCents: -c.amountCents, provenance: { source: 'import', importBatchId: batchId } };
      if (!legB.includedInBalance) { delete legB.includedInBalance; delete legB.includedAsOf; }
      delete legB.occurrenceRef;
      const issues = validateTransferPair([legA, legB], ctx.data.accounts);
      if (issues.length) throw new CommandError(issues.map((i) => ({ ...i, message: `Row ${c.rowNumber}: ${i.message}` })));
      txs.push(legA, legB);
      transferGroups.add(groupId);
      continue;
    }
    const amount = d.kind === 'expense' ? -Math.abs(c.amountCents) : Math.abs(c.amountCents);
    if (Math.sign(amount) !== Math.sign(c.amountCents)) fail(`Row ${c.rowNumber}: “${d.kind}” doesn't match the direction of the amount.`);
    const tx: Transaction = {
      id: ctx.newId('tx'), accountId: account.id, date: c.date, amountCents: amount, kind: d.kind, status: 'confirmed',
      merchant: d.merchant.trim() || c.merchant || c.rawDescription || 'Imported transaction', categoryId: d.categoryId, notes: '',
      provenance: { ...provenance, ...(separateFrom.length ? { separateFrom } : {}) },
      createdAt: ctx.now, updatedAt: ctx.now, ...occurrenceRef,
      // Phase 4A.5.8 (D6): a row dated before the account's confirmed balance date is already in that balance
      ...inclusionFor(ctx, account.id, c.date, 'confirmed', undefined, undefined),
    };
    const issues = validateTransaction(tx, ctx.data.accounts, ctx.data.categories);
    if (issues.length) throw new CommandError(issues.map((i) => ({ ...i, message: `Row ${c.rowNumber}: ${i.message}` })));
    txs.push(tx);
  }
  for (const t of touched.values()) ops.push({ t: 'put', table: 'transactions', value: t });
  for (const t of txs) ops.push({ t: 'put', table: 'transactions', value: t });
  // transfers this import touched whose other side is still pending (awaiting the other bank)
  const after = [...ctx.data.transactions.filter((t) => !touched.has(t.id)), ...touched.values(), ...txs];
  // (a payment returned in this same import isn't awaiting anything: Phase 4A.5.17)
  const awaiting = [...transferGroups].filter((g) => after.some((t) => t.transferGroupId === g && t.status === 'pending') && !after.some((t) => t.returnOf === g)).length;
  for (const g of transferGroups) {
    const legs = after.filter((t) => t.transferGroupId === g);
    const issues = validateTransferPair(legs, ctx.data.accounts);
    if (issues.length) throw new CommandError(issues);
  }

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
    counts: {
      rows: input.totalRows, imported: created, ...(matchedIds.size ? { matched: matchedIds.size } : {}), ...(markedPosted ? { markedPosted } : {}), ...(fees ? { fees } : {}),
      ...(awaiting ? { awaiting } : {}), ...(returns ? { returns } : {}), excluded: input.excludedCount, duplicates: input.duplicateCount, errors: input.errorCount,
    },
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

/**
 * Phase 4A.5.14: one option of a row's "Is this row one of these?" choice, as both apps show it: the label, why it
 * can't be chosen (a transfer whose amount differs by something that can't be a fee), and what choosing it does.
 */
export interface MatchOptionView { txId: ID; label: string; disabledReason: string | null; note: string; stale: boolean; fee: { feeCents: Cents } | null; isReturn: boolean }
export function matchOptionView(m: MatchCandidate, rowAmountCents: Cents, data: WorkspaceData, currency: string): MatchOptionView {
  const name = (id: ID) => data.accounts.find((a) => a.id === id)?.name ?? '';
  const fmt = (c: Cents, sign = false) => formatCents(c, currency, sign ? { sign: 'always' } : {});
  const desc = candidateLabel(m, name(m.accountId), currency);
  const isTransfer = m.kind === 'transfer';
  if (m.basis === 'return') {
    const leg = data.transactions.find((t) => t.id === m.txId);
    const partner = leg?.transferGroupId ? data.transactions.find((t) => t.transferGroupId === leg.transferGroupId && t.id !== leg.id) : undefined;
    const card = [m.accountId, partner?.accountId].map((id) => data.accounts.find((a) => a.id === id)).find((a) => a?.type === 'credit_card');
    const paying = [m.accountId, partner?.accountId].map((id) => data.accounts.find((a) => a.id === id)).find((a) => a && a.type !== 'credit_card');
    const ri = m.returnInfo;
    const partial = !!ri && ri.remainingAfterCents > 0;
    const note = MATCH_RETURN_NOTE(paying?.name ?? 'the paying account', card?.name ?? 'the card') + (partial ? ` ${MATCH_PARTIAL_RETURN_NOTE(fmt(ri!.returnCents), fmt(ri!.paymentCents), fmt(ri!.remainingAfterCents), card?.name ?? 'the card')}` : '');
    return { txId: m.txId, label: `${partial ? MATCH_PARTIAL_RETURN_LABEL : MATCH_RETURN_LABEL}: ${desc}`, disabledReason: null, note, stale: false, fee: null, isReturn: true };
  }
  const fee = isTransfer && m.differenceCents !== 0 && m.feeOption ? m.feeOption : null;
  const leg = data.transactions.find((t) => t.id === m.txId);
  const other = leg?.transferGroupId ? data.transactions.find((t) => t.transferGroupId === leg.transferGroupId && t.id !== leg.id) : undefined;
  const notes = [m.status === 'pending' ? MATCH_PENDING_NOTE : MATCH_POSTED_NOTE];
  if (other) notes.push(MATCH_TRANSFER_NOTE(name(other.accountId)));
  if (fee) notes.push(MATCH_FEE_NOTE(fmt(fee.feeCents), fmt(fee.principalCents), name(fee.chargedToAccountId)));
  else if (m.differenceCents !== 0 && !isTransfer) notes.push(MATCH_AMOUNT_NOTE(fmt(m.amountCents, true), fmt(rowAmountCents, true), fmt(m.differenceCents, true)));
  return {
    txId: m.txId,
    label: fee ? `${MATCH_FEE_LABEL(fmt(fee.feeCents), name(fee.chargedToAccountId))}: ${desc}` : `It's this one: ${desc}`,
    disabledReason: isTransfer && m.differenceCents !== 0 && !fee ? MATCH_NOT_FEE(fmt(m.differenceCents, true)) : null,
    note: notes.join(' '),
    stale: m.basis === 'stale',
    fee: fee ? { feeCents: fee.feeCents } : null,
    isReturn: false,
  };
}

/**
 * Phase 4A.5.14: the decision a review screen sends for a row, built from the candidates the user is looking at now
 * (their snapshots), so the data layer can refuse it if anything changed before the commit.
 */
export function matchDecision(choice: string | null, live: readonly MatchCandidate[]): ImportDecision['match'] {
  if (choice === null) return undefined;
  if (choice === 'none') return { none: true, seen: live.map(snapshotOf) };
  const m = live.find((x) => x.txId === choice);
  if (!m) return { txId: choice };
  const fee = m.kind === 'transfer' && m.differenceCents !== 0 && m.feeOption ? { fee: { feeCents: m.feeOption.feeCents } } : {};
  return { txId: choice, snapshot: snapshotOf(m), ...fee };
}

/** Phase 4A.5.18: what a row confirmed as a return records, in words (shown in place of its type and category). */
export function returnRowText(m: MatchCandidate, data: WorkspaceData): string {
  const leg = data.transactions.find((t) => t.id === m.txId);
  const partner = leg?.transferGroupId ? data.transactions.find((t) => t.transferGroupId === leg.transferGroupId && t.id !== leg.id) : undefined;
  const card = [m.accountId, partner?.accountId].map((id) => data.accounts.find((a) => a.id === id)).find((a) => a?.type === 'credit_card');
  const cur = data.settings.baseCurrency;
  const ri = m.returnInfo;
  const amt = ri ? formatCents(ri.returnCents, cur) : formatCents(Math.abs(m.amountCents), cur);
  return RETURN_ROW_TEXT(amt, formatCents(ri?.paymentCents ?? Math.abs(m.amountCents), cur), formatShortDate(m.date), card?.name ?? 'the card');
}

/**
 * Phase 4A.5.17: does this choice LINK the row to an existing transaction (nothing new is added)? A confirmed return
 * is not a link: it adds the returned money (a new transaction), so the balance check counts the row like a new one.
 */
export function isLinkChoice(choice: string | null, live: readonly MatchCandidate[]): boolean {
  return choice !== null && choice !== 'none' && live.find((m) => m.txId === choice)?.basis !== 'return';
}

/** Phase 4A.5.14: what a linked row does to its own account's posted balance (for the review's balance check). */
export function postedByMatchOf(choice: string, live: readonly MatchCandidate[], rowAmountCents: Cents): ID | { txId: ID; effectCents: Cents } {
  const m = live.find((x) => x.txId === choice);
  return m && m.kind === 'transfer' && m.differenceCents !== 0 && m.feeOption ? { txId: choice, effectCents: rowAmountCents } : choice;
}

/**
 * Phase 4A.5.17/4A.5.18: the two legs of a RETURN of card payment `leg` belongs to (full or partial): a transfer back
 * (returnOf = the payment's group) of `amountCents` into `accountId` (the account the money comes back to, or the card
 * the reversal is charged back on), with `status`; the other side is pending, awaiting that institution. The payment
 * itself is never changed. Refused if the returns would exceed the payment, or the payment isn't a card payment.
 */
function buildPaymentReturn(ctx: Ctx, o: { leg: Transaction; accountId: ID; amountCents: Cents; date: ISODate; status: TxStatus; provenance: Provenance; note: string; where?: string; merchant?: string; extraReturned?: Cents }): { here: Transaction; there: Transaction } {
  const w = o.where ?? '';
  const { leg } = o;
  if (!leg.transferGroupId || leg.returnOf || leg.kind !== 'transfer' || leg.accountId !== o.accountId) fail(`${w}that isn't a card payment from this account.`, 'return');
  const partner = ctx.data.transactions.find((t) => t.transferGroupId === leg.transferGroupId && t.id !== leg.id) ?? fail(`${w}the other side of that payment is missing.`, 'return');
  const accts = [leg.accountId, partner.accountId].map((id) => ctx.data.accounts.find((a) => a.id === id));
  if (accts.filter((a) => a?.type === 'credit_card').length !== 1) fail(`${w}only a payment between a card and another account can be returned.`, 'return');
  if (!Number.isSafeInteger(o.amountCents) || o.amountCents <= 0) fail(`${w}enter the amount returned.`, 'amount');
  if (o.date < leg.date) fail(`${w}a return can't be dated before the payment (${formatShortDate(leg.date)}).`, 'date');
  const st = paymentReturnStatus(leg.transferGroupId!, ctx.data.transactions);
  const left = st.remainingCents - (o.extraReturned ?? 0);
  const cur = ctx.data.accounts.find((a) => a.id === o.accountId)?.currency ?? ctx.data.settings.baseCurrency;
  if (o.amountCents > left) fail(`${w}only ${formatCents(Math.max(0, left), cur)} of this ${formatCents(st.paymentCents, cur)} payment is left to return (${formatCents(st.paymentCents - Math.max(0, left), cur)} already returned). Returns can't exceed the payment.`, 'amount');
  const sign = leg.amountCents < 0 ? 1 : -1; // money comes back opposite to the leg
  const groupId = ctx.newId('tg');
  const notes = `${o.amountCents === st.paymentCents ? 'Return' : 'Partial return'} of the card payment “${leg.merchant || 'Transfer'}” of ${formatShortDate(leg.date)} (${formatCents(st.paymentCents, cur)}), ${o.note}.`;
  const base = { date: o.date, kind: 'transfer' as const, categoryId: null, notes, transferGroupId: groupId, returnOf: leg.transferGroupId, createdAt: ctx.now, updatedAt: ctx.now, merchant: o.merchant?.trim() || 'Returned payment' };
  const here: Transaction = { ...base, id: ctx.newId('tx'), accountId: o.accountId, amountCents: sign * o.amountCents, status: o.status, provenance: o.provenance };
  const there: Transaction = { ...base, id: ctx.newId('tx'), accountId: partner.accountId, amountCents: -sign * o.amountCents, status: 'pending', provenance: { source: 'manual' } };
  const issues = validateTransferPair([here, there], ctx.data.accounts);
  if (issues.length) throw new CommandError(issues.map((i) => ({ ...i, message: `${w}${i.message}` })));
  return { here, there };
}

/**
 * Phase 4A.5.18: record that money coming into an account (typed in by hand, or an existing income/refund being
 * corrected) is a return, full or partial, of a card payment. The same accounting as a return confirmed in the import
 * review. `replaceTxId`: an existing transaction that is really this return; it is replaced (its date, status, import
 * provenance and statement link carry over, so re-importing its statement still recognises the row). Undo through the
 * store's undo.
 */
export function recordPaymentReturn(ctx: Ctx, input: { paymentLegId: ID; accountId: ID; amountCents: Cents; date: ISODate; status?: TxStatus; merchant?: string; replaceTxId?: ID }): { ops: Op[]; txs: Transaction[] } {
  const leg = ctx.data.transactions.find((t) => t.id === input.paymentLegId) ?? fail('That card payment no longer exists.', 'return');
  const old = input.replaceTxId ? ctx.data.transactions.find((t) => t.id === input.replaceTxId) ?? fail('Transaction not found.') : undefined;
  if (old) {
    if (old.accountId !== input.accountId || old.transferGroupId || old.kind === 'adjustment' || Math.sign(old.amountCents) !== -Math.sign(leg.amountCents)) fail('Only money coming back into the account the payment was made from can be a return.', 'return');
    if (Math.abs(old.amountCents) !== input.amountCents) fail('The amount must stay the same when you mark this as a returned payment.', 'amount');
  }
  const r = buildPaymentReturn(ctx, {
    leg, accountId: input.accountId, amountCents: input.amountCents, date: old?.date ?? input.date, status: old?.status ?? input.status ?? 'confirmed',
    provenance: old ? { ...old.provenance } : { source: 'manual' }, note: old ? 'confirmed by correcting the transaction' : 'entered by hand', ...(input.merchant ?? old?.merchant ? { merchant: input.merchant ?? old?.merchant } : {}),
  });
  if (old?.statementMatch) r.here.statementMatch = old.statementMatch;
  if (old?.postedDate) r.here.postedDate = old.postedDate;
  if (old) Object.assign(r.here, inclusionFor(ctx, input.accountId, r.here.date, r.here.status, old.includedInBalance, old));
  const ops: Op[] = [...(old ? [{ t: 'del' as const, table: 'transactions' as const, id: old.id }] : []), { t: 'put', table: 'transactions', value: r.here }, { t: 'put', table: 'transactions', value: r.there }, ...bumpBackupCounter(ctx, old ? 1 : 2)];
  return { ops, txs: [r.here, r.there] };
}

/**
 * Phase 4A.5.18: for an amount of money coming in that the user is entering (or editing), the card payments it could
 * be a return of: the same rules as the import review (findReturnCandidates). `all`: every possibility (any age,
 * partial), for the user's own "it's a returned card payment" choice; otherwise only credible suggestions.
 */
export function returnOptionsForEntry(data: WorkspaceData, e: { kind: TxKind; accountId: ID; amountCents: Cents | null; date: ISODate; merchant: string; excludeTxId?: ID }, all = false): MatchCandidate[] {
  if ((e.kind !== 'income' && e.kind !== 'refund') || !e.amountCents || e.amountCents <= 0) return [];
  const account = data.accounts.find((a) => a.id === e.accountId);
  if (!account || account.type === 'credit_card') return [];
  return findReturnCandidates({ date: e.date, amountCents: e.amountCents, rawDescription: e.merchant, merchant: e.merchant }, account, data.transactions, data.accounts, { all });
}

/**
 * Phase 4A.5.18: correct a pending item dated before its account was added that had in fact already posted then
 * (so the balance the user entered already includes it). Marks it posted with no later posting date, so it is history
 * (in the opening balance) and stops counting. The user's own decision; nothing is changed automatically.
 */
export function markPostedBeforeOpening(ctx: Ctx, id: ID): Op[] {
  const t = ctx.data.transactions.find((x) => x.id === id) ?? fail('Transaction not found.');
  const a = ctx.data.accounts.find((x) => x.id === t.accountId) ?? fail('Account not found.');
  if (t.status !== 'pending' || t.date >= a.openingDate) fail(`Only a pending transaction dated before ${a.name} was added (${formatShortDate(a.openingDate)}) can be marked as already in its opening balance.`, 'status');
  const v: Transaction = { ...t, status: 'confirmed', updatedAt: ctx.now };
  delete v.postedDate;
  return [{ t: 'put', table: 'transactions', value: v }];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Phase 4A.5.14: what an import did, in words (the done screen and the import history). New transactions, existing
 * ones linked (and how many of those it marked posted), confirmed transfer fees, and transfers still awaiting the
 * other bank are reported separately: linking is never called importing.
 */
export function describeImportResult(batch: ImportBatch): string {
  const k = batch.counts;
  const parts = [`${plural(k.imported, 'new transaction')} imported`];
  if (k.matched) parts.push(`${plural(k.matched, 'existing transaction')} linked${k.markedPosted ? ` (${k.markedPosted} marked posted)` : ''}`);
  if (k.fees) parts.push(`${plural(k.fees, 'transfer fee')} recorded`);
  if (k.awaiting) parts.push(`${plural(k.awaiting, 'transfer')} awaiting the other bank`);
  if (k.returns) parts.push(`${plural(k.returns, 'returned card payment')} recorded`);
  return parts.join(' · ');
}

/**
 * Phase 4A.5.12: what undoing an import will do, in words, so the screens can say exactly what was reverted.
 * Phase 4A.5.14: per leg; the other side of a transfer is never changed by undo, and that is said.
 */
export function describeImportUndo(data: WorkspaceData, batchId: ID): string {
  const created = data.transactions.filter((t) => t.provenance.importBatchId === batchId);
  const fees = created.filter((t) => t.transferFeeOf);
  const removed = created.filter((t) => !t.transferFeeOf && !(t.transferGroupId && t.amountCents > 0 && created.some((x) => x.transferGroupId === t.transferGroupId && x.id !== t.id))).length;
  const restored = data.transactions.filter((t) => t.statementMatch?.importBatchId === batchId);
  const acct = (id: ID) => data.accounts.find((a) => a.id === id)?.name ?? 'another account';
  const parts = [`Removed ${plural(removed, 'imported transaction')}`];
  // Phase 4A.5.17: a recorded return removed: the card payment counts as on its way (or posted) again
  const returnsRemoved = created.filter((t) => t.returnOf && t.amountCents > 0).length;
  if (returnsRemoved) parts.push(`${returnsRemoved === 1 ? 'the returned card payment is' : `${returnsRemoved} returned card payments are`} no longer recorded, so ${returnsRemoved === 1 ? 'that payment counts' : 'those payments count'} as paying the card again`);
  for (const t of restored) {
    const sm = t.statementMatch!;
    parts.push(`“${t.merchant || t.kind}” in ${acct(t.accountId)} is ${sm.setStatus ?? sm.previousStatus === 'pending' ? 'pending again' : 'still posted'} and no longer linked to the statement`);
    if (sm.fee) {
      const fee = fees.find((f) => f.id === sm.fee!.feeTxId) ?? data.transactions.find((f) => f.id === sm.fee!.feeTxId);
      const cur = data.accounts.find((a) => a.id === t.accountId)?.currency ?? data.settings.baseCurrency;
      parts.push(`the ${fee ? formatCents(-fee.amountCents, cur) : ''} transfer fee is removed${sm.fee.previousPrincipalCents !== null ? ` and the transfer is ${formatCents(sm.fee.previousPrincipalCents, cur)} again` : ''}`.replace('the  transfer', 'the transfer'));
    }
    if (t.transferGroupId) {
      const other = data.transactions.find((x) => x.transferGroupId === t.transferGroupId && x.id !== t.id);
      if (other) parts.push(`the other side in ${acct(other.accountId)} is unchanged (${other.status === 'pending' ? 'pending' : 'posted'})`);
    }
  }
  return `Import undone. ${parts.join('; ')}.`;
}

/**
 * Phase 4A.5.14: why undoing this import would be unsafe now, or null. Undo never reverses something a later import
 * built on (a transaction this import created that a later statement row is linked to), and never restores a transfer
 * amount the user edited after confirming a fee.
 */
export function importUndoProblem(data: WorkspaceData, batchId: ID): string | null {
  const batches = (id: ID) => data.importBatches.find((b) => b.id === id);
  for (const t of data.transactions) {
    if (t.provenance.importBatchId === batchId && t.statementMatch && t.statementMatch.importBatchId !== batchId) {
      const later = batches(t.statementMatch.importBatchId);
      return `“${t.merchant || t.kind}” was added by this import and is now linked to a row of a later import${later ? ` (${later.fileName})` : ''}. Undo that import first.`;
    }
  }
  for (const t of data.transactions) {
    const fee = t.statementMatch?.importBatchId === batchId ? t.statementMatch.fee : undefined;
    if (!fee || fee.previousPrincipalCents === null) continue;
    const legs = data.transactions.filter((x) => x.transferGroupId === t.transferGroupId);
    if (legs.some((l) => Math.abs(l.amountCents) !== Math.abs(t.statementMatch!.amountCents ?? t.amountCents))) {
      return `The transfer “${t.merchant || 'Transfer'}” was edited after this import confirmed its fee, so undo can't restore its original amount safely. Edit the transfer and the fee instead.`;
    }
  }
  return null;
}

/**
 * Remove every transaction created by this import (including transfer legs, fees and the adjustment) and undo its
 * links. Phase 4A.5.14: per leg: a linked leg goes back to the status it had before THIS import (only if this import
 * changed it) and its link is removed; the other leg of a transfer, links made by other imports and later edits are
 * left as they are. Refused (nothing changed) when that would be unsafe; see importUndoProblem.
 */
export function undoImportBatch(ctx: Ctx, batchId: ID): Op[] {
  const batch = ctx.data.importBatches.find((b) => b.id === batchId) ?? fail('Import not found.');
  if (batch.undoneAt) fail('This import was already undone.');
  const problem = importUndoProblem(ctx.data, batchId);
  if (problem) fail(`This import can't be undone: ${problem}`, 'undo');
  const ops: Op[] = [];
  const deleted = new Set<ID>();
  const groups = new Set<string>();
  for (const t of ctx.data.transactions) {
    if (t.provenance.importBatchId === batchId) {
      deleted.add(t.id);
      if (t.transferGroupId) groups.add(t.transferGroupId);
    }
  }
  for (const t of ctx.data.transactions) {
    if (t.transferGroupId && groups.has(t.transferGroupId)) deleted.add(t.id);
    if (t.transferFeeOf && groups.has(t.transferFeeOf)) deleted.add(t.id);
  }
  const puts = new Map<ID, Transaction>();
  const cur = (id: ID) => puts.get(id) ?? ctx.data.transactions.find((x) => x.id === id);
  for (const t of ctx.data.transactions) {
    const sm = t.statementMatch;
    if (sm?.importBatchId !== batchId || deleted.has(t.id)) continue;
    const restored: Transaction = { ...cur(t.id)!, updatedAt: ctx.now };
    delete restored.statementMatch;
    // only what THIS import changed: older links (Phase 4A.5.10/12) have no setStatus, so previousStatus decides
    if (sm.setStatus ?? sm.previousStatus === 'pending') {
      restored.status = 'pending';
      if (sm.previousPostedDate) restored.postedDate = sm.previousPostedDate; else delete restored.postedDate;
    }
    puts.set(t.id, restored);
    if (sm.postedFeeTxId) {
      const f = cur(sm.postedFeeTxId);
      if (f && !deleted.has(f.id)) { const rf: Transaction = { ...f, status: 'pending', updatedAt: ctx.now }; delete rf.postedDate; puts.set(rf.id, rf); }
    }
    if (sm.fee) {
      deleted.add(sm.fee.feeTxId);
      if (sm.fee.previousPrincipalCents !== null) {
        const p = sm.fee.previousPrincipalCents;
        for (const l of ctx.data.transactions.filter((x) => x.transferGroupId === t.transferGroupId)) {
          const base = { ...cur(l.id)!, updatedAt: ctx.now };
          base.amountCents = l.amountCents < 0 ? -p : p;
          puts.set(l.id, base);
        }
      }
    }
  }
  for (const id of deleted) ops.push({ t: 'del', table: 'transactions', id });
  for (const t of puts.values()) if (!deleted.has(t.id)) ops.push({ t: 'put', table: 'transactions', value: t });
  ops.push({ t: 'put', table: 'importBatches', value: { ...batch, undoneAt: ctx.now, updatedAt: ctx.now } });
  return ops;
}

/**
 * Phase 4A.5.14: where a transfer leg is in its settlement, in words, or null when nothing needs saying (both posted,
 * or not a transfer). Each leg settles on its own; one side posting never means the other bank has posted.
 */
export function transferSettlement(tx: Transaction, transactions: readonly Transaction[], accounts: readonly Account[]): string | null {
  if (!tx.transferGroupId) return null;
  const other = transactions.find((t) => t.transferGroupId === tx.transferGroupId && t.id !== tx.id);
  if (!other) return null;
  const [send, recv] = tx.amountCents < 0 ? [tx, other] : [other, tx];
  const name = (id: ID) => accounts.find((a) => a.id === id)?.name ?? 'the other account';
  // Phase 4A.5.17: a returned card payment, and the return itself
  if (tx.returnOf) return 'Returned card payment';
  if (transactions.some((t) => t.returnOf === tx.transferGroupId)) return 'Payment returned';
  if (send.status !== 'pending' && recv.status !== 'pending') return null;
  if (send.status === 'pending' && recv.status === 'pending') return 'Not posted by either bank yet';
  // Phase 4A.5.17: a card isn't deposited into; its issuer posts the payment
  const toCard = accounts.find((a) => a.id === recv.accountId)?.type === 'credit_card';
  if (recv.status === 'pending' && toCard) return tx === send ? `Sent · awaiting posting by ${name(recv.accountId)}` : `Sent from ${name(send.accountId)} · awaiting posting by ${name(recv.accountId)}`;
  if (recv.status === 'pending') return tx === send ? `Sent · awaiting deposit in ${name(recv.accountId)}` : `Sent from ${name(send.accountId)} · awaiting deposit`;
  return tx === recv ? `Received · not yet posted by ${name(send.accountId)}` : `Received in ${name(recv.accountId)} · not yet posted here`;
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
