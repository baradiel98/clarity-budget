import { normalizeDescription, similarity } from '@clarity/engine';
import { diffDays, formatCents, formatShortDate, isValidISO, type Cents, type Transaction } from '@clarity/shared';
import type { CaptureContext, CaptureDraft, Issue, IssueCode } from './types';

/**
 * Deterministic review rules. Recomputed after every edit. A draft can be approved only when it has
 * no blocking issue left (fixed, or confirmed where confirming is allowed).
 */
export function reviewDraft(d: CaptureDraft, ctx: CaptureContext): Issue[] {
  const out: Issue[] = [];
  const ack = (c: IssueCode) => d.acknowledged.includes(c);
  const add = (code: IssueCode, field: Issue['field'], message: string, blocking: boolean, confirmable = false) => {
    if (confirmable && ack(code)) return;
    out.push({ code, field, message, blocking, confirmable });
  };
  const cur = (c: Cents) => formatCents(c, ctx.currency);
  const acct = (id: string | null) => ctx.accounts.find((a) => a.id === id && !a.archived) ?? null;

  // Amount and currency
  if (d.amountCents === null || !Number.isSafeInteger(d.amountCents) || d.amountCents <= 0) add('amount_missing', 'amount', 'Enter the amount.', true);
  else if (d.approximate) add('amount_approx', 'amount', `You said about ${cur(d.amountCents)}. Enter the exact amount, or confirm it.`, true, true);
  if (d.currency !== ctx.currency) add('currency_other', 'currency', `This was written in ${d.currency}. Clarity tracks ${ctx.currency} only: enter the amount in ${ctx.currency}.`, true);

  // Date
  if (!d.date || !isValidISO(d.date)) add('date_missing', 'date', d.dateText ? `“${d.dateText}” isn't a specific day. Choose the date.` : 'Choose the date.', true);
  else {
    if (d.dateSource === 'none') add('date_assumed', 'date', 'No date was mentioned, so today is filled in. Confirm or change it.', true, true);
    if (d.dateSource === 'later') add('date_assumed', 'date', `The date comes from later in your sentence (“${d.dateText}”). Confirm or change it.`, true, true);
    if (d.dateAmbiguous) add('date_ambiguous', 'date', `“${d.dateText}” could be read two ways. It is set to ${formatShortDate(d.date)}: confirm or change it.`, true, true);
    if (d.date > ctx.today) add('date_future', 'date', 'This date is in the future, so it will count as planned until then.', false);
  }

  // What it was
  if (d.kindUnclear) add('kind_unclear', 'kind', 'It isn’t clear what this was. Check the type and add what it was for.', true, true);
  if (d.kind !== 'transfer') {
    if (!d.merchant.trim()) add('merchant_missing', 'merchant', d.kind === 'income' ? 'Add who paid you or what it was.' : 'Add the merchant or what it was for.', d.kind !== 'income');
    else if (d.merchantSource === 'description') add('merchant_description', 'merchant', `No merchant was named; “${d.merchant}” is used as the description.`, false);
  }

  // Category
  if (d.kind === 'expense' && d.splits.length === 0 && !d.categoryId) {
    if (d.categoryWords) add('category_unknown_words', 'category', `None of your categories matches “${d.categoryWords}”. Choose one, or leave it uncategorized.`, false);
    else add('category_missing', 'category', 'No category was suggested. Choose one, or leave it uncategorized.', false);
  }

  // Splits
  if (d.splits.length > 0) {
    const sum = d.splits.reduce((a, s) => a + s.amountCents, 0);
    if (d.amountCents !== null && sum !== d.amountCents) add('splits_mismatch', 'splits', `The parts add up to ${cur(sum)}, but the total is ${cur(d.amountCents)}. Fix a part or the total.`, true);
    const missing = d.splits.filter((s) => !s.categoryId);
    if (missing.length) add('split_category_missing', 'splits', `Choose a category for ${missing.map((s) => `“${s.label || cur(s.amountCents)}”`).join(', ')}.`, true);
  }

  // Accounts
  if (d.accountWords && (!d.accountId || d.accountSource !== 'words')) add('account_unknown', 'account', `You mentioned “${d.accountWords}”, but none of your accounts has that name. Choose the account.`, true, true);
  if (!acct(d.accountId)) add('account_missing', 'account', d.kind === 'transfer' ? 'Choose the account the money came from.' : 'Choose the account.', true);
  else {
    // Only worth saying when there is a real choice of account.
    if (d.accountSource === 'default' && !d.accountWords && ctx.accounts.filter((a) => !a.archived).length > 1) add('account_default', 'account', `No account was mentioned, so ${acct(d.accountId)!.name} is used.`, false);
    const a = acct(d.accountId)!;
    if (d.date && d.date < a.openingDate) add('before_tracking', 'date', `This is before ${a.name} was added to Clarity (${formatShortDate(a.openingDate)}). It is kept as history and does not change that account's balance, which already includes it.`, false);
  }
  if (d.kind === 'transfer') {
    if (!acct(d.toAccountId)) {
      const what = d.role === 'card_payment' ? 'the credit card you paid' : d.role === 'savings' ? 'the savings account' : 'the account the money went to';
      add('to_account_missing', 'toAccount', d.toAccountWords ? `You mentioned “${d.toAccountWords}”, but there is no matching account. Choose ${what}, or add that account in Settings first.` : `Choose ${what}.`, true);
    } else if (d.toAccountId === d.accountId) add('same_account', 'toAccount', 'Choose two different accounts.', true);
  }

  // Possible duplicate of a saved transaction
  const dup = d.kind !== 'transfer' ? possibleDuplicate(d, ctx.transactions) : null;
  if (dup) add('duplicate', 'amount', `Looks like “${dup.merchant || 'a transaction'}” for ${cur(Math.abs(dup.amountCents))} on ${formatShortDate(dup.date)}, already saved. Keep this only if it is a separate purchase.`, true, true);

  return out;
}

const signed = (d: CaptureDraft): Cents | null => (d.amountCents === null ? null : d.kind === 'expense' ? -d.amountCents : d.amountCents);

/** Same account, same signed amount, within a day, and the same or a very similar merchant. */
export function possibleDuplicate(d: CaptureDraft, transactions: readonly Transaction[]): Transaction | null {
  const amt = signed(d);
  if (amt === null || !d.date || !d.accountId) return null;
  const m = normalizeDescription(d.merchant);
  return (
    transactions.find(
      (t) => t.accountId === d.accountId && t.amountCents === amt && Math.abs(diffDays(t.date, d.date!)) <= 1 && (normalizeDescription(t.merchant) === m || (m.length > 2 && similarity(normalizeDescription(t.merchant), m) >= 0.7)),
    ) ?? null
  );
}

export const isReady = (d: CaptureDraft, ctx: CaptureContext): boolean => !reviewDraft(d, ctx).some((i) => i.blocking);

/** Totals for the review bar: money out, money in, and transfers (never counted as either). */
export function captureTotals(drafts: readonly CaptureDraft[]): { out: Cents; in: Cents; moved: Cents } {
  let out = 0;
  let inn = 0;
  let moved = 0;
  for (const d of drafts) {
    const a = d.amountCents ?? 0;
    if (d.kind === 'expense') out += a;
    else if (d.kind === 'transfer') moved += a;
    else inn += a;
  }
  return { out, in: inn, moved };
}
