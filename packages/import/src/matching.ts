import { addDays, diffDays, formatCents, formatShortDate, type Account, type Cents, type ID, type ISODate, type Transaction, type TxStatus } from '@clarity/shared';
import { similarity } from '@clarity/engine';

/**
 * Phase 4A.5.12: which existing transactions a statement row could be. One place for the rules, used by the import
 * preview, the review screens (live, against the current data) and the data layer (authoritative, at commit).
 *
 * Date windows, in calendar days relative to the existing transaction's date (row date − transaction date):
 * - pending items: from 3 days BEFORE (the user dated the record a little late) to 10 days AFTER (card holds, hotel
 *   and car-rental authorisations and deposits commonly post within a week; 10 adds weekends and holidays);
 * - transfer legs (posted or pending): from 3 days before to 7 days after (transfers between institutions settle in
 *   1–3 business days; 7 calendar days covers a weekend plus a holiday).
 * The windows bound the search; there is no amount tolerance (see findMatchCandidates).
 */
export const MATCH_WINDOWS = {
  pending: { daysBefore: 3, daysAfter: 10 },
  transfer: { daysBefore: 3, daysAfter: 7 },
} as const;

export interface MatchCandidate {
  txId: ID;
  /** 'pending': a pending transaction (any type, transfers included); 'transfer': a posted transfer leg. */
  basis: 'pending' | 'transfer';
  date: ISODate;
  merchant: string;
  kind: Transaction['kind'];
  accountId: ID;
  status: TxStatus;
  amountCents: Cents;
  /** Statement amount − this transaction's amount (0 = same amount). */
  differenceCents: Cents;
  /** |row date − transaction date| in days. */
  daysApart: number;
}

export interface MatchRow { date: ISODate; amountCents: Cents; rawDescription: string; merchant?: string }

const inWindow = (rowDate: ISODate, txDate: ISODate, w: { daysBefore: number; daysAfter: number }) => {
  const d = diffDays(rowDate, txDate);
  return d >= -w.daysBefore && d <= w.daysAfter;
};

/**
 * Every existing transaction in `account` that this statement row could plausibly be:
 * - a PENDING transaction in the same direction (money in vs money out) within the pending window, of ANY amount:
 *   a pending item can clear for a different amount (tip, fee, partial deposit), so no tolerance is applied; an item
 *   with a different amount is always shown with the difference and only ever linked if the user picks it;
 * - a POSTED transfer leg with exactly the same amount within the transfer window (the other account's statement
 *   arriving later), unless it is already linked to a statement row;
 * - `alsoIds`: transactions that were candidates when the review was built, kept even if they were posted since, so
 *   the review never goes stale silently.
 * Already-linked transactions (statementMatch) are never candidates. Order: same amount first (closest date first),
 * then different amounts (smallest difference first, then closest date); description similarity only breaks ties.
 * Nothing is ever chosen automatically.
 */
export function findMatchCandidates(row: MatchRow, account: Account, transactions: readonly Transaction[], opts: { alsoIds?: readonly ID[] } = {}): MatchCandidate[] {
  const also = new Set(opts.alsoIds ?? []);
  const out: MatchCandidate[] = [];
  for (const t of transactions) {
    if (t.accountId !== account.id || t.statementMatch || t.kind === 'adjustment') continue;
    if (Math.sign(t.amountCents) !== Math.sign(row.amountCents) || t.amountCents === 0) continue;
    const pending = t.status === 'pending' && inWindow(row.date, t.date, MATCH_WINDOWS.pending);
    const transfer = t.status !== 'pending' && !!t.transferGroupId && t.amountCents === row.amountCents && inWindow(row.date, t.date, MATCH_WINDOWS.transfer);
    if (!pending && !transfer && !also.has(t.id)) continue;
    out.push({
      txId: t.id, basis: transfer && !pending ? 'transfer' : 'pending', date: t.date, merchant: t.merchant, kind: t.kind, accountId: t.accountId,
      status: t.status, amountCents: t.amountCents, differenceCents: row.amountCents - t.amountCents, daysApart: Math.abs(diffDays(row.date, t.date)),
    });
  }
  const desc = row.merchant || row.rawDescription;
  const sim = new Map(out.map((c) => [c.txId, similarity(transactions.find((t) => t.id === c.txId)!.merchant, desc)]));
  // same amount first, closest date first; then different amounts, smallest difference first, then closest date;
  // description similarity only breaks ties (it is always shown to the user)
  return out.sort((a, b) =>
    Number(a.differenceCents !== 0) - Number(b.differenceCents !== 0) ||
    (a.differenceCents === 0 ? a.daysApart - b.daysApart : Math.abs(a.differenceCents) - Math.abs(b.differenceCents) || a.daysApart - b.daysApart) ||
    (sim.get(b.txId)! - sim.get(a.txId)!) ||
    (a.date < b.date ? -1 : a.date > b.date ? 1 : a.txId < b.txId ? -1 : 1));
}

/** For tests and docs: the latest date a pending item dated `d` can still be matched by a statement row. */
export const pendingWindowEnd = (d: ISODate) => addDays(d, MATCH_WINDOWS.pending.daysAfter);

/** Phase 4A.5.12: one line that identifies a candidate exactly (date, description, amount, account, status, difference). */
export function candidateLabel(m: MatchCandidate, accountName: string, currency: string): string {
  const parts = [formatShortDate(m.date), m.merchant || m.kind, formatCents(m.amountCents, currency, { sign: 'always' }), accountName, m.status === 'pending' ? 'pending' : 'posted'];
  if (m.kind === 'transfer') parts.push('transfer');
  if (m.differenceCents !== 0) parts.push(`statement differs by ${formatCents(m.differenceCents, currency, { sign: 'always' })}`);
  return parts.join(' · ');
}
