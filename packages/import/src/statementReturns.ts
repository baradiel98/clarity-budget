import { diffDays, type Account, type Cents, type ISODate } from '@clarity/shared';
import { cardPaymentEvidence } from './categorize';
import { MATCH_WINDOWS, RETURN_RE } from './matching';

/**
 * Phase 4A.8 (audit 4A.7.1 N1): a statement can hold both a card payment (money out, "PAYMENT TO VISA −$200") and its
 * return (money in, "RETURNED PAYMENT +$200") when neither is in Clarity yet (a first import, or the user deleted
 * both). The return can't be matched to an existing payment, so without this it would be imported as a refund or
 * income. Here, rows of the SAME statement are paired as proposals only; the user decides, and commitImport records the
 * return after creating the payment.
 *
 * A row is offered as the return of a payment row only when ALL hold (never on amount alone):
 * - the statement is a non-card account's; the return row is money in, the payment row money out;
 * - the return row's description says it is a return (RETURN_RE: RETURNED, REVERSAL, REJECTED, NSF, …);
 * - the payment row looks like a card payment (cardPaymentEvidence: card-payment wording, or "payment" plus a card
 *   name or network), or at least says "payment" (PAYMENT, PMT, …; weaker, still only a proposal);
 * - the return is no more than the payment and dated on or after it, within the returned-payment window (30 days);
 * - neither row is already in Clarity (an exact duplicate). A payment row that could also be an existing transaction
 *   is still offered: if the user links it to that transaction instead of importing it, the return must be recorded
 *   against the existing payment (the normal matching offers it), and commitImport refuses the pairing.
 * Several possibilities are all listed (exact amount first, then closest date); none is ever chosen automatically.
 */
export interface StatementRow { rowNumber: number; date: ISODate; amountCents: Cents; rawDescription: string; merchant?: string; duplicate?: { level: 'exact' | 'likely' } | null; matchCandidates?: readonly unknown[] }

export interface StatementReturnOption {
  /** The payment row of this statement. */
  paymentRow: number;
  date: ISODate;
  /** The payment row's signed amount (negative). */
  amountCents: Cents;
  rawDescription: string;
  /** The return equals the whole payment. */
  full: boolean;
  /** The payment row has card-payment evidence (wording or a card's name); otherwise it only says "payment". */
  cardEvidence: boolean;
}

const PAYMENT_WORD_RE = /\b(payment|pmt|pymt|pymnt|paymt)\b/i;

export function statementReturnOptions(rows: readonly StatementRow[], account: Pick<Account, 'type'>, accounts: readonly Pick<Account, 'id' | 'name' | 'type' | 'archived'>[]): Map<number, StatementReturnOption[]> {
  const out = new Map<number, StatementReturnOption[]>();
  if (account.type === 'credit_card') return out;
  const fresh = (r: StatementRow) => r.duplicate?.level !== 'exact';
  const payments = rows.filter((r) => r.amountCents < 0 && fresh(r)).map((r) => ({ r, ev: cardPaymentEvidence(r.rawDescription, accounts) })).filter((p) => p.ev.looks || PAYMENT_WORD_RE.test(p.r.rawDescription));
  for (const ret of rows) {
    if (ret.amountCents <= 0 || !fresh(ret) || !(RETURN_RE.test(ret.rawDescription) || RETURN_RE.test(ret.merchant ?? ''))) continue;
    const opts = payments
      .filter(({ r }) => r.rowNumber !== ret.rowNumber && ret.amountCents <= -r.amountCents && ret.date >= r.date && diffDays(ret.date, r.date) <= MATCH_WINDOWS.returned.daysAfter)
      .map(({ r, ev }): StatementReturnOption => ({ paymentRow: r.rowNumber, date: r.date, amountCents: r.amountCents, rawDescription: r.rawDescription, full: ret.amountCents === -r.amountCents, cardEvidence: ev.looks }))
      .sort((a, b) => Number(b.full) - Number(a.full) || Number(b.cardEvidence) - Number(a.cardEvidence) || diffDays(ret.date, a.date) - diffDays(ret.date, b.date) || a.paymentRow - b.paymentRow);
    if (opts.length) out.set(ret.rowNumber, opts);
  }
  return out;
}
