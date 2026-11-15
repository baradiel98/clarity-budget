import { addDays, diffDays, formatCents, formatShortDate, type Account, type Cents, type ID, type ISODate, type Transaction, type TxStatus } from '@clarity/shared';
import { similarity } from '@clarity/engine';

/**
 * Phase 4A.5.12: which existing transactions a statement row could be. One place for the rules, used by the import
 * preview, the review screens (live, against the current data) and the data layer (authoritative, at commit).
 *
 * Date windows, in calendar days relative to the existing transaction's date (row date − transaction date):
 * - pending items: from 3 days BEFORE (the user dated the record a little late) to 10 days AFTER (card holds, hotel
 *   and car-rental authorisations and deposits commonly post within a week; 10 adds weekends and holidays);
 * - posted, unlinked transfer legs: the same window (Phase 4A.5.14; was 7 days). Each leg settles on its own, so a
 *   posted leg without a statement link is one the user marked posted, or entered as posted, before its statement.
 * Phase 4A.5.14: pending items older than the pending window are still listed, as 'stale' candidates; so is an older
 * posted, unlinked transfer leg of exactly the statement amount.
 * The windows bound the search; there is no amount tolerance (see findMatchCandidates).
 */
export const MATCH_WINDOWS = {
  pending: { daysBefore: 3, daysAfter: 10 },
  // Phase 4A.5.14: the same as pending. A posted, unlinked transfer leg is one the user marked posted (or entered as
  // posted) before its statement arrived; the receiving bank can post 8–11 days after the transfer was made.
  transfer: { daysBefore: 3, daysAfter: 10 },
} as const;

export interface MatchCandidate {
  txId: ID;
  /**
   * 'pending': a pending transaction (any type, transfer legs included) inside the normal window;
   * 'transfer': a posted transfer leg inside the transfer window;
   * 'stale' (Phase 4A.5.14): a pending transaction OLDER than the normal window (e.g. a check cashed weeks later),
   * listed separately so it can't stay pending unnoticed while the same money is imported again.
   */
  basis: 'pending' | 'transfer' | 'stale';
  date: ISODate;
  merchant: string;
  kind: Transaction['kind'];
  accountId: ID;
  status: TxStatus;
  /**
   * The amount this transaction (one leg only) takes from or adds to this account. For a transfer leg with a confirmed
   * fee in the same account (Phase 4A.5.14) the fee is included: the bank shows them as one row.
   */
  amountCents: Cents;
  /** Statement amount − amountCents (0 = same amount). */
  differenceCents: Cents;
  /** |row date − transaction date| in days. */
  daysApart: number;
  /** Phase 4A.5.14: row date − transaction date (how old a stale candidate is when the row posted). */
  ageDays: number;
  /** Phase 4A.5.14: the transaction's version when listed (its updatedAt); a commit is refused if it changed since. */
  version: number;
  /** Phase 4A.5.14: part of amountCents that is an existing fee on this transfer leg. */
  feeCents?: Cents;
  /**
   * Phase 4A.5.14: for a transfer leg whose amount differs, the only explanation Clarity can record: a fee the bank
   * charged on the transfer (the amount received is less than the amount sent). Null when the difference can't be
   * a fee: then this leg can't be linked to the row (leave the row out and check the transfer).
   */
  feeOption?: { feeCents: Cents; chargedToAccountId: ID; principalCents: Cents } | null;
}

export interface MatchRow { date: ISODate; amountCents: Cents; rawDescription: string; merchant?: string }

/** Phase 4A.5.14: what a decision records about each candidate it saw, so the data layer can refuse stale decisions. */
export type CandidateSnapshot = Pick<MatchCandidate, 'txId' | 'accountId' | 'amountCents' | 'date' | 'status' | 'version' | 'kind'>;
export const snapshotOf = (m: MatchCandidate): CandidateSnapshot => ({ txId: m.txId, accountId: m.accountId, amountCents: m.amountCents, date: m.date, status: m.status, version: m.version, kind: m.kind });
/** Phase 4A.5.14: has anything material about this candidate changed since the user saw it? */
export const sameSnapshot = (a: CandidateSnapshot, b: CandidateSnapshot) =>
  a.txId === b.txId && a.accountId === b.accountId && a.amountCents === b.amountCents && a.date === b.date && a.status === b.status && a.version === b.version && a.kind === b.kind;

const inWindow = (rowDate: ISODate, txDate: ISODate, w: { daysBefore: number; daysAfter: number }) => {
  const d = diffDays(rowDate, txDate);
  return d >= -w.daysBefore && d <= w.daysAfter;
};

/** Phase 4A.5.14: the fee (if any) recorded on a transfer leg's side (same account as the leg). */
export function feeOfLeg(leg: Transaction, transactions: readonly Transaction[]): Transaction | undefined {
  if (!leg.transferGroupId) return undefined;
  return transactions.find((t) => t.transferFeeOf === leg.transferGroupId && t.accountId === leg.accountId);
}

/**
 * Every existing transaction in `account` that this statement row could plausibly be:
 * - a PENDING transaction in the same direction (money in vs money out) within the pending window, of ANY amount:
 *   a pending item can clear for a different amount (tip, fee, partial deposit), so no tolerance is applied; an item
 *   with a different amount is always shown with the difference and only ever linked if the user picks it;
 * - Phase 4A.5.14: a pending transaction in the same direction OLDER than the pending window ('stale'), of any amount,
 *   listed separately with its age (a check entered Sep 2 and cashed Sep 17);
 * - a POSTED, unlinked transfer leg in the same direction within the transfer window; Phase 4A.5.14: of any amount,
 *   with the difference shown (a transfer fee); older than the window only with exactly the statement amount;
 * - `alsoIds`: transactions that were candidates when the review was built, kept even if they were posted since, so
 *   the review never goes stale silently.
 * Each transfer leg is matched on its own: linking one never posts the other (Phase 4A.5.14).
 * Already-linked transactions (statementMatch), adjustments and transfer fees are never candidates. Order: normal
 * candidates first (same amount first, closest date first; then different amounts, smallest difference first, then
 * closest date), then stale ones (same amount first, then smallest difference, then most recent). Description
 * similarity only breaks ties. Nothing is ever chosen automatically.
 */
export function findMatchCandidates(row: MatchRow, account: Account, transactions: readonly Transaction[], opts: { alsoIds?: readonly ID[] } = {}): MatchCandidate[] {
  const also = new Set(opts.alsoIds ?? []);
  const out: MatchCandidate[] = [];
  for (const t of transactions) {
    if (t.accountId !== account.id || t.statementMatch || t.kind === 'adjustment' || t.transferFeeOf) continue;
    const fee = t.transferGroupId ? feeOfLeg(t, transactions) : undefined;
    const amount = t.amountCents + (fee?.amountCents ?? 0);
    if (Math.sign(amount) !== Math.sign(row.amountCents) || amount === 0) continue;
    const age = diffDays(row.date, t.date);
    const pending = t.status === 'pending' && inWindow(row.date, t.date, MATCH_WINDOWS.pending);
    // a pending item dated before the account was opened isn't in its balance, so it can't be counted twice
    const stale = t.status === 'pending' && age > MATCH_WINDOWS.pending.daysAfter && t.date >= account.openingDate;
    const transfer = t.status !== 'pending' && !!t.transferGroupId && inWindow(row.date, t.date, MATCH_WINDOWS.transfer);
    const staleTransfer = t.status !== 'pending' && !!t.transferGroupId && age > MATCH_WINDOWS.transfer.daysAfter && amount === row.amountCents && t.date >= account.openingDate;
    if (!pending && !stale && !transfer && !staleTransfer && !also.has(t.id)) continue;
    const differenceCents = row.amountCents - amount;
    const c: MatchCandidate = {
      txId: t.id, basis: stale || staleTransfer ? 'stale' : transfer && !pending ? 'transfer' : 'pending', date: t.date, merchant: t.merchant, kind: t.kind, accountId: t.accountId,
      status: t.status, amountCents: amount, differenceCents, daysApart: Math.abs(age), ageDays: age, version: t.updatedAt,
      ...(fee ? { feeCents: fee.amountCents } : {}),
    };
    if (t.transferGroupId && differenceCents !== 0) c.feeOption = transferFeeOption(t, row.amountCents, transactions, !!fee);
    out.push(c);
  }
  const desc = row.merchant || row.rawDescription;
  const sim = new Map(out.map((c) => [c.txId, similarity(transactions.find((t) => t.id === c.txId)!.merchant, desc)]));
  const staleRank = (c: MatchCandidate) => Number(c.basis === 'stale');
  // normal candidates before stale ones; same amount first; closest date first (stale: most recent first);
  // then different amounts by smallest difference; description similarity only breaks ties (it is always shown)
  return out.sort((a, b) =>
    staleRank(a) - staleRank(b) ||
    Number(a.differenceCents !== 0) - Number(b.differenceCents !== 0) ||
    (a.differenceCents === 0 ? a.daysApart - b.daysApart : Math.abs(a.differenceCents) - Math.abs(b.differenceCents) || a.daysApart - b.daysApart) ||
    (sim.get(b.txId)! - sim.get(a.txId)!) ||
    (a.date < b.date ? -1 : a.date > b.date ? 1 : a.txId < b.txId ? -1 : 1));
}

/**
 * Phase 4A.5.14: can the difference between a statement row and a transfer leg be a fee the bank charged on the
 * transfer? Only when less money arrived than was sent:
 * - the row is the SENDING account's and shows more leaving than the transfer: the fee is charged to this account,
 *   the transfer amount stays;
 * - the row is the RECEIVING account's and shows less arriving: the transfer amount becomes what arrived (both
 *   sides), and the fee is charged to the sending account, so the sending total is unchanged.
 * Not when a fee is already recorded on this transfer, or for any other difference (more arriving than sent).
 */
function transferFeeOption(leg: Transaction, rowCents: Cents, transactions: readonly Transaction[], hasFee: boolean): MatchCandidate['feeOption'] {
  if (hasFee || transactions.some((t) => t.transferFeeOf === leg.transferGroupId)) return null;
  const partner = transactions.find((t) => t.transferGroupId === leg.transferGroupId && t.id !== leg.id);
  if (!partner) return null;
  if (leg.amountCents < 0 && rowCents < leg.amountCents) return { feeCents: leg.amountCents - rowCents, chargedToAccountId: leg.accountId, principalCents: -leg.amountCents };
  if (leg.amountCents > 0 && rowCents > 0 && rowCents < leg.amountCents) return { feeCents: leg.amountCents - rowCents, chargedToAccountId: partner.accountId, principalCents: rowCents };
  return null;
}

/** For tests and docs: the latest date a pending item dated `d` can still be matched by a statement row. */
export const pendingWindowEnd = (d: ISODate) => addDays(d, MATCH_WINDOWS.pending.daysAfter);

/** Phase 4A.5.12: one line that identifies a candidate exactly (date, description, amount, account, status, difference). */
export function candidateLabel(m: MatchCandidate, accountName: string, currency: string): string {
  const parts = [formatShortDate(m.date), m.merchant || m.kind, formatCents(m.amountCents, currency, { sign: 'always' }), accountName, m.status === 'pending' ? 'pending' : 'posted'];
  if (m.kind === 'transfer') parts.push('transfer');
  if (m.feeCents) parts.push(`includes ${formatCents(-m.feeCents, currency)} fee`);
  if (m.basis === 'stale') parts.push(`entered ${m.ageDays} days before this row, outside the normal ${MATCH_WINDOWS.pending.daysAfter}-day matching window`);
  if (m.differenceCents !== 0) parts.push(`statement differs by ${formatCents(m.differenceCents, currency, { sign: 'always' })}`);
  return parts.join(' · ');
}
