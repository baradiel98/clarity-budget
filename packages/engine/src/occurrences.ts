import {
  addDays,
  maxISO,
  type Cents,
  type ID,
  type ISODate,
  type OccurrenceException,
  type RecurringItem,
  type RecurringKind,
  type Transaction,
} from '@clarity/shared';
import { applyWeekendRule, scheduleDates } from './recurrence';

export type OccurrenceStatus = 'confirmed' | 'expected' | 'estimated' | 'unknown' | 'skipped' | 'overdue';

export type AmountBasis =
  | 'fixed'
  | 'user_estimate'
  | 'history_average'
  | 'unknown'
  | 'card_balance'
  | 'override'
  | 'actual';

export interface Occurrence {
  key: string; // `${recurringId}|${originalDate}`
  recurringId: ID;
  name: string;
  kind: RecurringKind;
  accountId: ID;
  toAccountId?: ID;
  categoryId: ID | null;
  /** Scheduled date before exceptions / weekend rules. Identity of the occurrence. */
  originalDate: ISODate;
  /** Effective date after weekend rule and any "move" exception. */
  date: ISODate;
  /** Positive magnitude. 0 for unknown amounts; card_balance is resolved by the forecast. */
  amountCents: Cents;
  amountBasis: AmountBasis;
  status: OccurrenceStatus;
  matchedTxId?: ID;
}

/** How far back unrecorded occurrences are surfaced as overdue. */
export const OVERDUE_LOOKBACK_DAYS = 62;

export const isInflowKind = (k: RecurringKind): boolean => k === 'income';
export const isTransferKind = (k: RecurringKind): boolean => k === 'transfer' || k === 'savings';

export const occurrenceKey = (recurringId: ID, originalDate: ISODate): string => `${recurringId}|${originalDate}`;

/** Average magnitude of the last 3 transactions settled against this item (integer, half-up). */
export function historyEstimate(itemId: ID, transactions: readonly Transaction[]): Cents | null {
  const matched = transactions
    .filter((t) => t.occurrenceRef?.recurringId === itemId)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  // For transfers, only count the source leg (negative) so each payment is counted once.
  const seen = new Set<string>();
  const amounts: number[] = [];
  for (const t of matched) {
    const k = t.transferGroupId ?? t.id;
    if (seen.has(k)) continue;
    seen.add(k);
    amounts.push(Math.abs(t.amountCents));
    if (amounts.length === 3) break;
  }
  if (amounts.length === 0) return null;
  const total = amounts.reduce((a, b) => a + b, 0);
  return Math.floor((total * 2 + amounts.length) / (amounts.length * 2));
}

export interface ExpandOptions {
  from: ISODate;
  to: ISODate;
  today: ISODate;
}

/**
 * Expand recurring items into dated occurrences, applying (in order):
 * start/end dates → pause → weekend rule → exceptions (skip / move / override) →
 * matching against recorded transactions → status.
 */
export function expandOccurrences(
  items: readonly RecurringItem[],
  exceptions: readonly OccurrenceException[],
  transactions: readonly Transaction[],
  { from, to, today }: ExpandOptions,
): Occurrence[] {
  const exByKey = new Map<string, OccurrenceException>();
  for (const e of exceptions) exByKey.set(occurrenceKey(e.recurringId, e.originalDate), e);

  const matchByKey = new Map<string, Transaction>();
  for (const t of transactions) {
    if (!t.occurrenceRef) continue;
    const k = occurrenceKey(t.occurrenceRef.recurringId, t.occurrenceRef.originalDate);
    const prev = matchByKey.get(k);
    // prefer the source (negative) leg for transfers
    if (!prev || (prev.amountCents > 0 && t.amountCents < 0)) matchByKey.set(k, t);
  }

  const out: Occurrence[] = [];
  for (const item of items) {
    // Search a little wider than [from, to] so weekend shifts / moves across the boundary are found.
    const rawFrom = maxISO(addDays(from, -7), item.startDate);
    const rawTo = item.endDate && item.endDate < addDays(to, 7) ? item.endDate : addDays(to, 7);
    if (rawFrom > rawTo) continue;
    const estimate =
      item.amount.type === 'variable' ? historyEstimate(item.id, transactions) : null;

    for (const originalDate of scheduleDates(item.schedule, rawFrom, rawTo)) {
      if (item.paused && (!item.pausedFrom || originalDate >= item.pausedFrom)) continue;
      const key = occurrenceKey(item.id, originalDate);
      const ex = exByKey.get(key);
      let date = applyWeekendRule(originalDate, item.weekendRule);
      if (ex?.action === 'move' && ex.newDate) date = ex.newDate;
      if (date < from || date > to) continue;

      let amountCents: Cents;
      let amountBasis: AmountBasis;
      switch (item.amount.type) {
        case 'fixed':
          amountCents = item.amount.cents;
          amountBasis = 'fixed';
          break;
        case 'variable':
          amountCents = estimate ?? item.amount.cents;
          amountBasis = estimate !== null ? 'history_average' : 'user_estimate';
          break;
        case 'unknown':
          amountCents = 0;
          amountBasis = 'unknown';
          break;
        case 'card_full_balance':
          amountCents = 0;
          amountBasis = 'card_balance';
          break;
      }
      if (ex?.action === 'override' && ex.amountCents !== undefined) {
        amountCents = ex.amountCents;
        amountBasis = 'override';
      }

      const matched = matchByKey.get(key);
      let status: OccurrenceStatus;
      if (matched) {
        status = 'confirmed';
        amountCents = Math.abs(matched.amountCents);
        amountBasis = 'actual';
      } else if (ex?.action === 'skip') {
        status = 'skipped';
      } else if (date < today) {
        if (date < item.trackFrom || date < addDays(today, -OVERDUE_LOOKBACK_DAYS)) continue;
        status = 'overdue';
      } else if (amountBasis === 'unknown') {
        status = 'unknown';
      } else if (amountBasis === 'fixed' || amountBasis === 'override') {
        status = 'expected';
      } else {
        status = 'estimated';
      }

      out.push({
        key,
        recurringId: item.id,
        name: item.name,
        kind: item.kind,
        accountId: item.accountId,
        ...(item.toAccountId ? { toAccountId: item.toAccountId } : {}),
        categoryId: item.categoryId,
        originalDate,
        date,
        amountCents,
        amountBasis,
        status,
        ...(matched ? { matchedTxId: matched.id } : {}),
      });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  return out;
}
