import { diffDays, type Cents, type ID, type ISODate, type Transaction } from '@clarity/shared';
import type { Occurrence } from './occurrences';
import { merchantKey, normalizeDescription, similarity, tokens } from './text';

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
 * Suggest which unpaid occurrence a new transaction settles (e.g. an imported rent payment): the best eligible one (see
 * suggestOccurrenceLink), strong or not. Kept for callers that only need the candidate.
 */
export function suggestOccurrenceMatch(tx: OccurrenceMatchInput, occurrences: readonly Occurrence[], transactions: readonly Transaction[] = []): Occurrence | null {
  return suggestOccurrenceLink(tx, occurrences, transactions)?.occurrence ?? null;
}

/** Phase 4A.9: what is known about the transaction being matched. `kind`/`toAccountId` when decided (or suggested). */
export interface OccurrenceMatchInput extends TxLike {
  kind?: 'expense' | 'income' | 'refund' | 'transfer';
  toAccountId?: ID | null;
}

/**
 * Phase 4A.9: can this transaction be the payment (or receipt) of this occurrence at all? Unchanged rules: unpaid (not
 * recorded or skipped), same account, same direction, date within ±7 days (an overdue occurrence: up to 20 days after
 * it), amount exact for a fixed or overridden amount, within 25% of an estimate, and for an unknown amount or a card's
 * full balance a description resembling the item's name. New: the kind must fit when it is known: an expense pays a
 * bill or subscription, income is expected income, a transfer is a scheduled transfer or savings move to the same
 * other account; a refund never settles a scheduled item.
 */
export function occurrenceEligible(tx: OccurrenceMatchInput, o: Occurrence): boolean {
  if (o.status === 'confirmed' || o.status === 'skipped') return false;
  if (o.accountId !== tx.accountId) return false;
  const isIn = o.kind === 'income';
  if (isIn !== tx.amountCents > 0) return false;
  if (tx.kind === 'refund') return false;
  if (tx.kind === 'transfer' && (o.kind !== 'transfer' && o.kind !== 'savings')) return false;
  if (tx.kind === 'transfer' && tx.toAccountId && o.toAccountId && o.toAccountId !== tx.toAccountId) return false;
  if (tx.kind === 'expense' && o.kind !== 'bill' && o.kind !== 'subscription') return false;
  if (tx.kind === 'income' && o.kind !== 'income') return false;
  const dist = Math.abs(diffDays(tx.date, o.date));
  if (o.status !== 'overdue' && dist > 7) return false;
  if (o.status === 'overdue' && (dist > 20 || tx.date < o.date)) return false;
  const amt = Math.abs(tx.amountCents);
  if (o.amountBasis === 'fixed' || o.amountBasis === 'override') return amt === o.amountCents;
  if (o.amountBasis === 'unknown' || o.amountBasis === 'card_balance') return similarity(tx.merchant, o.name) >= 0.3;
  return Math.abs(amt - o.amountCents) <= Math.max(100, Math.floor(o.amountCents / 4));
}

/** Words in a scheduled item's name that say nothing about which payee it is. */
const NAME_STOP = new Set(['the', 'and', 'for', 'bill', 'payment', 'pmt', 'monthly', 'weekly', 'auto', 'autopay', 'card', 'account', 'fee', 'my']);

/**
 * Phase 4A.9: evidence, beyond amount and date, that this transaction is that scheduled item's payment:
 * - 'name': the description contains every distinctive word of the item's name ("Rent" in "ACH RENT OAKWOOD", "Netflix"
 *   in "NETFLIX.COM"), or the two are very similar (token similarity ≥ 0.5);
 * - 'history': the user linked a transaction with the same payee (merchant key) to this same item before.
 * Null when there is none: the amount and the date are then the only resemblance.
 */
export function occurrenceEvidence(tx: OccurrenceMatchInput, o: Occurrence, transactions: readonly Transaction[] = []): 'name' | 'history' | null {
  const desc = tokens(tx.merchant);
  const words = [...tokens(o.name)].filter((w) => w.length >= 3 && !NAME_STOP.has(w));
  if ((words.length > 0 && words.every((w) => desc.has(w))) || similarity(tx.merchant, o.name) >= 0.5) return 'name';
  const key = merchantKey(tx.merchant);
  if (key && transactions.some((t) => t.occurrenceRef?.recurringId === o.recurringId && merchantKey(t.merchant) === key)) return 'history';
  return null;
}

/** Phase 4A.9: a suggested link and whether it is strong enough to be selected for the user. */
export interface OccurrenceSuggestion {
  occurrence: Occurrence;
  /** Selected by default only when true: evidence beyond amount and date, and no equally good alternative. */
  strong: boolean;
  evidence: 'name' | 'history' | null;
  /** Another eligible occurrence (another item, or the same item on an equally close date) is as good a match. */
  ambiguous: boolean;
}

/**
 * Phase 4A.9 (owner policy): amount and date alone never link a transaction to a scheduled item. Among the eligible
 * occurrences, the best is the one with evidence (name or history) first, then the closest date, then the closest
 * name. It is STRONG (pre-selected) only when it has evidence and is unambiguous: no other item with evidence, and no
 * other occurrence of the same item equally close. Otherwise it is only a suggestion the user may tick; a transaction
 * with no eligible occurrence gets none.
 */
export function suggestOccurrenceLink(tx: OccurrenceMatchInput, occurrences: readonly Occurrence[], transactions: readonly Transaction[] = []): OccurrenceSuggestion | null {
  const cands = occurrences.filter((o) => occurrenceEligible(tx, o)).map((o) => ({ o, ev: occurrenceEvidence(tx, o, transactions), dist: Math.abs(diffDays(tx.date, o.date)), sim: similarity(tx.merchant, o.name) }));
  if (!cands.length) return null;
  cands.sort((a, b) => Number(!a.ev) - Number(!b.ev) || a.dist - b.dist || b.sim - a.sim || (a.o.key < b.o.key ? -1 : 1));
  const best = cands[0]!;
  const ambiguous = cands.some((c) => c !== best && ((c.o.recurringId !== best.o.recurringId && (!!c.ev || !best.ev)) || (c.o.recurringId === best.o.recurringId && c.dist === best.dist)));
  return { occurrence: best.o, strong: !!best.ev && !ambiguous, evidence: best.ev, ambiguous };
}
