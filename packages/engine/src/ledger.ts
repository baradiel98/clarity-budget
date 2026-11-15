import {
  formatCents,
  formatShortDate,
  formatWeekdayDate,
  LEDGER_ALL_CASH,
  LEDGER_ALREADY_INCLUDED,
  LEDGER_ANCHOR,
  LEDGER_ANCHOR_NOTE,
  LEDGER_AVAILABLE_TODAY,
  LEDGER_BASIS,
  LEDGER_CARD_NOTE,
  LEDGER_CHANGES_SINCE,
  LEDGER_COVERED,
  LEDGER_CUTOFF_RULE,
  LEDGER_EARLIER_INCLUDED,
  LEDGER_END_OF_DAY,
  LEDGER_ESTIMATED_INCOME,
  LEDGER_LOWEST,
  LEDGER_NOT_POSTED_BY,
  LEDGER_PENDING_HELD,
  LEDGER_RECORDED_AFTER,
  LEDGER_RECORDED_AFTER_ADJUSTMENT,
  LEDGER_CHANGES_NAMED,
  LEDGER_CHANGES_UNNAMED,
  LEDGER_CHANGED_AFTER,
  LEDGER_RECORDED_TODAY,
  LEDGER_START_OF_DAY,
  LEDGER_SUMMARY,
  LEDGER_SUMMARY_ACCOUNT,
  LEDGER_COVER_OVERDRAWN,
  LEDGER_COVER_PAYMENT,
  type Account,
  type Cents,
  type CurrencyCode,
  type ID,
  type ISODate,
  type Transaction,
} from '@clarity/shared';
import { accountBalance, affectsBalance, balanceAsOfDate, effectiveAmount, historyStatus, isUnpostedAsOf, pendingCreditTotal } from './balances';
import { buildForecast, type Forecast, type ForecastEvent } from './forecast';
import type { Occurrence } from './occurrences';
import { ASSUMPTIONS_BASE, excludedLine, planningWindowEnd, startLines, type EngineInput, type ExplainLine, type Explanation } from './plan';

/**
 * Phase 5A: the daily ledger. A read-only view of the existing forecast (`buildForecast`), per account or for the
 * combined spendable cash: each day's start, every item with the running balance after it (in the order the forecast
 * applies it), the day's low and its end. Nothing here calculates a balance of its own: every amount is the forecast's
 * (`ForecastEvent.applied`, `cashDeltaCents`, `ForecastDay.accountStartCents/accountEndCents`), so the ledger always
 * agrees with Safe to Spend, Planning and Home. Tests check that each day's items add up to the forecast's own figures.
 *
 * Phase 5A.1 (D1): one account is shown with its OWN balance. Where a non-spendable account (savings) can't pay what is
 * due from it, or is overdrawn, the forecast counts the missing part against the spendable accounts as a whole
 * (`coverCents`), and its working balance for that account assumes the money is moved in. The account view takes that
 * part back out (and adds back what `repaidCents` gave to the spendable accounts), so it shows what the account itself
 * would hold if nothing is moved in: savings −$100 stays −$100; $50 paying $120 shows −$70. The combined view is
 * unchanged. Identity (tested): account view balance = forecast working balance − (covered − repaid) so far.
 */
export type LedgerScope = { kind: 'cash' } | { kind: 'account'; accountId: ID };
export type LedgerBasis = 'planned' | 'scheduled' | 'estimated' | 'overdue' | 'hypothetical' | 'overdrawn';

export interface LedgerEntry {
  eventId: string;
  date: ISODate;
  label: string;
  basis: LedgerBasis;
  /** The effect on the scope: one account's projected balance, or the combined spendable cash. */
  deltaCents: Cents;
  balanceAfterCents: Cents;
  /** Every account the item changed (a transfer: both), in the order the forecast applied them. */
  accountIds: ID[];
  /** Why the amount differs from the scheduled one (a capped transfer, a payment covered from spendable accounts). */
  notes: string[];
  /**
   * Phase 5A.1 (account view only): the part of this account's payment (or overdrawn balance) it can't cover, counted
   * against the spendable accounts as a whole. It is still in this account's balance; Clarity doesn't choose which
   * spendable account covers it.
   */
  coveredCents?: Cents;
  occurrence?: Occurrence;
  txId?: ID;
}

export interface LedgerDay {
  date: ISODate;
  startCents: Cents;
  /** Lowest running balance during the day (the forecast's own low for the combined cash). */
  lowCents: Cents;
  endCents: Cents;
  entries: LedgerEntry[];
  /** Listed by the forecast but not counted (unknown amount, a pending credit, estimated income in conservative mode). */
  notCounted: ForecastEvent[];
}

export interface DailyLedger {
  scope: LedgerScope;
  /** The scope's currency: the account's own, or the base currency for the combined cash. */
  currency: CurrencyCode;
  isCard: boolean;
  from: ISODate;
  to: ISODate;
  /** At least one entry is estimated income (only possible because the ledger counts estimated income, as Planning does). */
  includesEstimatedIncome: boolean;
  days: LedgerDay[];
}

function basisOf(e: ForecastEvent): LedgerBasis {
  if (e.source === 'archived_balance') return 'overdrawn';
  if (e.source === 'overdue') return 'overdue';
  if (e.source === 'hypothetical') return 'hypothetical';
  if (e.source === 'scheduled_tx') return 'planned';
  return e.estimated ? 'estimated' : 'scheduled';
}

function accountOfExcluded(e: ForecastEvent, transactions: readonly Transaction[]): ID | undefined {
  return e.occurrence?.accountId ?? (e.txId ? transactions.find((t) => t.id === e.txId)?.accountId : undefined);
}

function notesFor(e: ForecastEvent, scope: LedgerScope, cur: CurrencyCode, name: (id: ID) => string): string[] {
  const out: string[] = [];
  if (e.unfundedCents) out.push(`${formatCents(e.unfundedCents, cur)} of it can't be moved: the account it comes from doesn't hold enough, so that part isn't counted`);
  if (e.coverCents && e.coverAccountId) {
    const who = name(e.coverAccountId);
    const own = scope.kind === 'account' && scope.accountId === e.coverAccountId;
    if (e.source === 'archived_balance') out.push(LEDGER_COVER_OVERDRAWN(who, formatCents(e.coverCents, cur), own));
    else {
      // Phase 5A.2: what the account itself pays is what the forecast applied to it (a card payment's legs are rewritten,
      // so the scheduled leg can't be used); the full payment is that plus the shortfall
      const funded = -(e.applied?.find((l) => l.accountId === e.coverAccountId)?.deltaCents ?? 0);
      out.push(LEDGER_COVER_PAYMENT(who, formatCents(funded, cur), formatCents(funded + e.coverCents, cur), formatCents(e.coverCents, cur), own));
    }
  } else if (e.source === 'archived_balance') out.push(LEDGER_COVERED);
  if (e.repaidCents) out.push(`${formatCents(e.repaidCents, cur)} of it repays an overdrawn balance already counted against your spendable accounts, so it isn't counted again there`);
  return out;
}

/**
 * Phase 5A: the forecast Planning shows (estimated income counted and marked, through the Planning window), as a
 * daily ledger for one scope. Pass `forecast` to reuse one already built with the same input.
 */
export function buildDailyLedger(input: EngineInput, scope: LedgerScope, opts: { forecast?: Forecast } = {}): DailyLedger {
  const f = opts.forecast ?? buildForecast({
    today: input.today, horizonEnd: planningWindowEnd(input), accounts: input.accounts, transactions: input.transactions, recurring: input.recurring,
    exceptions: input.exceptions, baseCurrency: input.baseCurrency, includeEstimatedIncome: true,
  });
  const account = scope.kind === 'account' ? input.accounts.find((a) => a.id === scope.accountId) : undefined;
  if (scope.kind === 'account' && !account) throw new Error('Account not found');
  const cur = account?.currency ?? input.baseCurrency;
  const cashIds = new Set(f.cashAccountIds);
  const name = (id: ID) => input.accounts.find((a) => a.id === id)?.name ?? 'Account';
  let estimatedIncome = false;
  /** Account view: what the forecast's working balance holds beyond the account's own money (covered − repaid so far). */
  let offset = 0;
  const days: LedgerDay[] = f.days.map((d) => {
    const entries: LedgerEntry[] = [];
    let start: Cents;
    let low: Cents;
    if (scope.kind === 'cash') {
      start = d.startCashCents;
      let run = start;
      for (const e of d.events) {
        if (e.cashDeltaCents === 0) continue; // e.g. a move between two spendable accounts: no effect on the total
        run += e.cashDeltaCents;
        entries.push(entryOf(e, e.cashDeltaCents, run));
      }
      low = d.lowCashCents;
    } else {
      const id = scope.accountId;
      start = (d.accountStartCents[id] ?? 0) - offset;
      const mine = d.events
        .map((e) => ({ e, leg: e.applied?.find((l) => l.accountId === id) }))
        .filter((x): x is { e: ForecastEvent; leg: NonNullable<typeof x.leg> } => !!x.leg)
        .sort((a, b) => a.leg.seq - b.leg.seq);
      let run = start;
      low = start;
      for (const { e, leg } of mine) {
        const covered = e.coverAccountId === id ? e.coverCents ?? 0 : 0;
        const repaid = e.repaidAccountId === id ? e.repaidCents ?? 0 : 0;
        const own = covered - repaid;
        const delta = leg.deltaCents - own;
        offset += own;
        if (delta === 0 && own === 0) continue; // nothing happened to this account (e.g. a full-balance payment of $0)
        run += delta;
        if (run < low) low = run;
        entries.push({ ...entryOf(e, delta, run), ...(covered ? { coveredCents: covered } : {}) });
      }
    }
    const end = scope.kind === 'cash' ? d.endCashCents : (d.accountEndCents[scope.accountId] ?? 0) - offset;
    const notCounted = f.excludedEvents.filter((e) => {
      if (e.date !== d.date) return false;
      const acct = accountOfExcluded(e, input.transactions);
      return scope.kind === 'cash' ? !acct || cashIds.has(acct) : acct === scope.accountId;
    });
    return { date: d.date, startCents: start, lowCents: low, endCents: end, entries, notCounted };
  });
  return { scope, currency: cur, isCard: account?.type === 'credit_card', from: f.today, to: f.horizonEnd, includesEstimatedIncome: estimatedIncome, days };

  function entryOf(e: ForecastEvent, delta: Cents, after: Cents): LedgerEntry {
    if (e.estimated && delta > 0 && e.occurrence?.kind === 'income') estimatedIncome = true;
    return {
      eventId: e.id, date: e.date, label: e.label, basis: basisOf(e), deltaCents: delta, balanceAfterCents: after,
      accountIds: [...(e.applied ?? [])].sort((a, b) => a.seq - b.seq).map((l) => l.accountId), notes: notesFor(e, scope, cur, name),
      ...(e.occurrence ? { occurrence: e.occurrence } : {}), ...(e.txId ? { txId: e.txId } : {}),
    };
  }
}

// ───────────────────────── today's starting balance: the trail from the last confirmed balance ─────────────────────────

export type AnchorKind = 'opening' | 'confirmed' | 'confirmed_from_records' | 'posted_in_records';

export interface TrailLine {
  txId: ID;
  date: ISODate;
  label: string;
  /** What the transaction adds to the recorded balance (a card payment the issuer hasn't posted: the part not returned). */
  deltaCents: Cents;
  balanceAfterCents: Cents;
  pending: boolean;
  /** Why it is counted on top of the anchor: dated after it, not yet posted by its date, or recorded after confirming. */
  reason: 'after' | 'not_posted' | 'recorded_after';
}

export interface BalanceTrail {
  accountId: ID;
  currency: CurrencyCode;
  isCard: boolean;
  anchor: { kind: AnchorKind; date: ISODate; cents: Cents };
  lines: TrailLine[];
  /**
   * Only for a confirmation entered from Phase 5A on: what changed afterwards in transactions dated on or before its
   * date (an edit, a deletion, a payment marked posted). Zero otherwise; it makes the trail add up exactly.
   */
  changesSinceCents: Cents;
  /**
   * Phase 5A.1 (D5): with a stored confirmation, transactions on this account dated on or before it, recorded before it
   * and changed after it (their own `updatedAt`). Only listed when `changesSinceCents` isn't zero. They are the only
   * changes Clarity can name; how much each changed, and any deleted transaction, can't be known.
   */
  changedAfter: { txId: ID; date: ISODate; label: string; cents: Cents; counted: boolean }[];
  /** Transactions dated on the anchor date that are part of the anchor balance (history only), listed, never counted. */
  alreadyIncluded: { txId: ID; date: ISODate; label: string; cents: Cents }[];
  earlierIncludedCount: number;
  recordedCents: Cents;
  /** Pending credits in the recorded balance, not yet available (not on cards: a card keeps its recorded balance). */
  pendingCreditCents: Cents;
  /** What the forecast starts from today for this account (= the ledger's first start). */
  availableCents: Cents;
}

const txLabel = (t: Transaction) => t.merchant || (t.kind === 'adjustment' ? 'Balance adjustment' : t.kind.charAt(0).toUpperCase() + t.kind.slice(1));
const order = (a: Transaction, b: Transaction) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/**
 * Phase 5A: how an account's balance today follows from its last confirmed balance. The anchor is the latest date the
 * balance was confirmed (`balanceAsOfDate`: the opening date, the latest Update balance or adjustment). Cutoff
 * (the existing rules, docs/calculation-rules.md "Daily ledger"):
 * - the anchor is a POSTED balance: a transaction still pending then (or posted only after that date) isn't in it and
 *   is counted on top, whatever its date;
 * - a transaction dated on or before the anchor date and marked "Already included" (or, for the opening balance, dated
 *   before the opening date and posted by then) is part of it and never counted again;
 * - a transaction dated after the anchor date is counted;
 * - a posted transaction dated on or before the anchor date is part of a confirmed balance only if it was recorded
 *   before the confirmation; one recorded afterwards (not marked "Already included") is counted on top.
 * The lines are exactly the transactions the recorded balance counts beyond the anchor, so anchor + lines (+ any
 * later change) = the recorded balance today, always.
 */
export function balanceTrail(input: EngineInput, accountId: ID): BalanceTrail {
  const account = input.accounts.find((a) => a.id === accountId);
  if (!account) throw new Error('Account not found');
  const txs = input.transactions;
  const D = balanceAsOfDate(account, txs);
  const counted = txs.filter((t) => affectsBalance(account, t, D, txs) && t.date <= input.today);
  const amt = (t: Transaction) => effectiveAmount(account, t, txs);
  const postedBy = (t: Transaction) => t.date <= D && !isUnpostedAsOf(t, D);
  const conf = account.balanceConfirmation && account.balanceConfirmation.date === D ? account.balanceConfirmation : undefined;
  const adj = conf ? undefined : txs.filter((t) => t.accountId === accountId && t.kind === 'adjustment' && t.date === D).sort((a, b) => b.createdAt - a.createdAt)[0];
  let kind: AnchorKind;
  let inside: (t: Transaction) => boolean;
  // recorded strictly before the confirmation; the adjustment that confirmation created carries its exact time
  if (conf) { kind = 'confirmed'; inside = (t) => postedBy(t) && (t.createdAt < conf.at || (t.createdAt === conf.at && t.kind === 'adjustment')); }
  // an import that applied an adjustment created it with its own rows (same time): those rows are in the figure
  else if (adj) { kind = 'confirmed_from_records'; inside = (t) => postedBy(t) && t.createdAt <= adj.createdAt; }
  else if (D > account.openingDate) { kind = 'posted_in_records'; inside = postedBy; }
  else { kind = 'opening'; inside = () => false; }
  const anchorCents = conf ? conf.postedCents : account.openingBalanceCents + counted.filter(inside).reduce((s, t) => s + amt(t), 0);
  const recorded = accountBalance(account, txs, input.today);
  let run = anchorCents;
  const lines: TrailLine[] = counted.filter((t) => !inside(t)).sort(order).map((t) => {
    run += amt(t);
    const reason: TrailLine['reason'] = kind === 'opening' ? (t.date >= D ? 'after' : 'not_posted') : t.date > D ? 'after' : isUnpostedAsOf(t, D) ? 'not_posted' : 'recorded_after';
    return { txId: t.id, date: t.date, label: txLabel(t), deltaCents: amt(t), balanceAfterCents: run, pending: t.status === 'pending', reason };
  });
  const history = txs.filter((t) => historyStatus(account, t, D) !== null);
  const pendingCredit = account.type === 'credit_card' ? 0 : pendingCreditTotal(account, txs, input.today);
  return {
    accountId, currency: account.currency, isCard: account.type === 'credit_card',
    anchor: { kind, date: kind === 'opening' ? account.openingDate : D, cents: anchorCents },
    lines,
    changesSinceCents: recorded - run,
    changedAfter: conf && recorded !== run
      ? txs.filter((t) => t.accountId === accountId && t.date <= D && t.createdAt < conf.at && t.updatedAt > conf.at).sort(order)
        .map((t) => ({ txId: t.id, date: t.date, label: txLabel(t), cents: amt(t), counted: counted.includes(t) }))
      : [],
    alreadyIncluded: history.filter((t) => t.date === D).sort(order).map((t) => ({ txId: t.id, date: t.date, label: txLabel(t), cents: t.amountCents })),
    earlierIncludedCount: history.filter((t) => t.date < D).length,
    recordedCents: recorded,
    pendingCreditCents: pendingCredit,
    availableCents: recorded - pendingCredit,
  };
}

// ───────────────────────── one day's breakdown, as an explanation (both apps render it) ─────────────────────────

/**
 * Phase 5A: one ledger day as an Explanation ("Day details"), rendered by the existing "Why this number?" views.
 * Today also shows how the starting figure was reached: for an account, the trail from its last confirmed balance;
 * for the combined cash, the recorded balance and any pending credits held back (the lines every explanation starts
 * with). Cards are shown as the amount owed (positive = owed), the way the rest of the app shows them.
 */
export function ledgerDayExplanation(input: EngineInput, ledger: DailyLedger, date: ISODate, opts: { forecast?: Forecast } = {}): Explanation | null {
  const day = ledger.days.find((d) => d.date === date);
  if (!day) return null;
  const cur = ledger.currency;
  const k = ledger.isCard ? -1 : 1; // display sign: a card's balance is shown as owed
  const account = ledger.scope.kind === 'account' ? input.accounts.find((a) => a.id === (ledger.scope as { accountId: ID }).accountId)! : undefined;
  const scopeName = account?.name ?? LEDGER_ALL_CASH;
  const name = (id: ID) => input.accounts.find((a) => a.id === id)?.name ?? 'Account';
  const lines: ExplainLine[] = [];
  const assumptions = [...ASSUMPTIONS_BASE];
  const isToday = date === input.today;
  if (isToday && account) {
    const t = balanceTrail(input, account.id);
    const anchorLabel = LEDGER_ANCHOR[t.anchor.kind](formatShortDate(t.anchor.date));
    lines.push({ kind: 'start', label: ledger.isCard ? `${anchorLabel}, owed` : anchorLabel, cents: k * t.anchor.cents, note: LEDGER_ANCHOR_NOTE[t.anchor.kind] });
    for (const a of t.alreadyIncluded) lines.push({ kind: 'info', label: a.label, date: a.date, note: `${formatCents(k * a.cents, cur, { sign: 'always' })} · ${LEDGER_ALREADY_INCLUDED}` });
    if (t.earlierIncludedCount) lines.push({ kind: 'info', label: LEDGER_EARLIER_INCLUDED(t.earlierIncludedCount) });
    for (const l of t.lines) {
      const why = l.reason === 'recorded_after' ? (t.anchor.kind === 'confirmed' ? LEDGER_RECORDED_AFTER : LEDGER_RECORDED_AFTER_ADJUSTMENT) : l.reason === 'not_posted' ? LEDGER_NOT_POSTED_BY(formatShortDate(t.anchor.date)) : undefined;
      lines.push({ kind: k * l.deltaCents < 0 ? 'out' : 'in', label: l.label, cents: k * l.deltaCents, date: l.date, note: [l.pending ? LEDGER_BASIS.pending : LEDGER_BASIS.recorded, why].filter(Boolean).join(' · '), balanceAfterCents: k * l.balanceAfterCents });
    }
    if (t.changesSinceCents) {
      lines.push({ kind: k * t.changesSinceCents < 0 ? 'out' : 'in', label: LEDGER_CHANGES_SINCE(formatShortDate(t.anchor.date)), cents: k * t.changesSinceCents, note: t.changedAfter.length ? LEDGER_CHANGES_NAMED : LEDGER_CHANGES_UNNAMED, balanceAfterCents: k * t.recordedCents });
      for (const c of t.changedAfter) lines.push({ kind: 'info', label: c.label, date: c.date, note: LEDGER_CHANGED_AFTER(formatCents(k * c.cents, cur, { sign: 'always' }), c.counted) });
    }
    lines.push({ kind: 'start', label: ledger.isCard ? `${LEDGER_RECORDED_TODAY}, owed` : LEDGER_RECORDED_TODAY, cents: k * t.recordedCents });
    if (t.pendingCreditCents) {
      lines.push({ kind: 'out', label: LEDGER_PENDING_HELD, cents: -t.pendingCreditCents, note: "pending; it's in your recorded balance but not counted until it clears", balanceAfterCents: t.availableCents });
      lines.push({ kind: 'start', label: LEDGER_AVAILABLE_TODAY, cents: t.availableCents });
    }
    assumptions.push(LEDGER_CUTOFF_RULE);
  } else if (isToday) {
    const f = opts.forecast ?? buildForecast({ today: input.today, horizonEnd: input.today, accounts: input.accounts, transactions: input.transactions, recurring: input.recurring, exceptions: input.exceptions, baseCurrency: input.baseCurrency, includeEstimatedIncome: true });
    const sl = startLines(f, input.accounts, cur);
    lines.push(...sl);
    if (sl.some((l) => l.kind === 'out')) lines.push({ kind: 'start', label: LEDGER_AVAILABLE_TODAY, cents: day.startCents });
  } else {
    lines.push({ kind: 'start', label: ledger.isCard ? `${LEDGER_START_OF_DAY}, owed` : LEDGER_START_OF_DAY, cents: k * day.startCents });
  }
  for (const e of day.entries) {
    const others = account ? e.accountIds.filter((id) => id !== account.id).map(name) : [];
    const where = account ? (others.length ? `${e.deltaCents < 0 ? 'to' : 'from'} ${others.join(', ')}` : '') : e.accountIds.map(name).join(' → ');
    const note = [LEDGER_BASIS[e.basis], where, ...e.notes].filter(Boolean).join(' · ');
    // Phase 5A.1: an item that doesn't change this account's own balance (its overdrawn balance counted elsewhere) is information only
    if (e.deltaCents === 0) lines.push({ kind: 'info', label: e.label, date: e.date, note, balanceAfterCents: k * e.balanceAfterCents });
    else lines.push({ kind: k * e.deltaCents < 0 ? 'out' : 'in', label: e.label, cents: k * e.deltaCents, date: e.date, note, balanceAfterCents: k * e.balanceAfterCents });
  }
  if (day.entries.length && day.lowCents < Math.min(day.startCents, day.endCents) && !ledger.isCard) lines.push({ kind: 'info', label: LEDGER_LOWEST, cents: day.lowCents });
  lines.push({ kind: 'result', label: ledger.isCard ? `${LEDGER_END_OF_DAY}, owed` : LEDGER_END_OF_DAY, cents: k * day.endCents });
  for (const e of day.notCounted) lines.push(excludedLine(e));
  if (day.entries.some((e) => e.basis === 'estimated' && e.deltaCents > 0 && e.occurrence?.kind === 'income')) assumptions.push(LEDGER_ESTIMATED_INCOME);
  if (ledger.isCard || (!account && input.accounts.some((a) => a.type === 'credit_card'))) assumptions.push(LEDGER_CARD_NOTE);
  return {
    title: `${formatWeekdayDate(date)} · ${scopeName}`,
    resultCents: k * day.endCents,
    summary: account ? LEDGER_SUMMARY_ACCOUNT : LEDGER_SUMMARY,
    lines,
    assumptions,
    ...(cur !== input.baseCurrency ? { currency: cur } : {}),
  };
}

/** Phase 5A: the accounts the ledger can be shown for: every active account, and archived ones the forecast still moves. */
export function ledgerAccounts(accounts: readonly Account[], f: Forecast): Account[] {
  const moved = new Set(f.days.flatMap((d) => d.events.flatMap((e) => (e.applied ?? []).map((l) => l.accountId))));
  return accounts.filter((a) => !a.archived || moved.has(a.id) || (f.days[0]?.accountStartCents[a.id] ?? 0) < 0);
}
