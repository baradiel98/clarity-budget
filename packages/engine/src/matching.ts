import { diffDays, type Cents, type ID, type ISODate, type Transaction } from '@clarity/shared';
import type { Occurrence } from './occurrences';
import { normalizeDescription, similarity } from './text';

export interface TxLike {
  accountId: ID;
  date: ISODate;
  amountCents: Cents;
  merchant: string;
}

/**
 * Manual-entry duplicate warning: same account, same amount, same date, same merchant.
 * Only a warning; the user can still save.
 */
export function findPossibleDuplicates(candidate: TxLike, transactions: readonly Transaction[], ignoreId?: ID): Transaction[] {
  const m = normalizeDescription(candidate.merchant);
  return transactions.filter(
    (t) =>
      t.id !== ignoreId &&
      t.accountId === candidate.accountId &&
      t.amountCents === candidate.amountCents &&
      t.date === candidate.date &&
      normalizeDescription(t.merchant) === m,
  );
}

/**
 * Suggest which unpaid occurrence a new transaction settles (e.g. an imported rent payment).
 * Rules: same account, same direction, date within ±7 days (overdue: any), amount exact for
 * fixed amounts or within 25% for estimated/variable ones. Returns the closest by date.
 */
export function suggestOccurrenceMatch(tx: TxLike, occurrences: readonly Occurrence[]): Occurrence | null {
  let best: { o: Occurrence; score: number } | null = null;
  for (const o of occurrences) {
    if (o.status === 'confirmed' || o.status === 'skipped') continue;
    if (o.accountId !== tx.accountId) continue;
    const isIn = o.kind === 'income';
    if (isIn !== tx.amountCents > 0) continue;
    const dist = Math.abs(diffDays(tx.date, o.date));
    if (o.status !== 'overdue' && dist > 7) continue;
    if (o.status === 'overdue' && (dist > 20 || tx.date < o.date)) continue;
    const amt = Math.abs(tx.amountCents);
    if (o.amountBasis === 'fixed' || o.amountBasis === 'override') {
      if (amt !== o.amountCents) continue;
    } else if (o.amountBasis === 'unknown' || o.amountBasis === 'card_balance') {
      if (similarity(tx.merchant, o.name) < 0.3) continue;
    } else {
      const tol = Math.max(100, Math.floor(o.amountCents / 4));
      if (Math.abs(amt - o.amountCents) > tol) continue;
    }
    const score = dist - similarity(tx.merchant, o.name) * 3;
    if (!best || score < best.score) best = { o, score };
  }
  return best?.o ?? null;
}
