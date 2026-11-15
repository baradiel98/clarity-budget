import type { Account, Cents, CurrencyCode, ID, ISODate, Transaction } from '@clarity/shared';

/**
 * Phase 4A.5.8: a transaction kept as history only because it is already included in a balance the user confirmed.
 * The flag is valid only on a posted transaction dated on or before the account's confirmed balance date; on anything
 * else (pending, or dated after that balance) it is ignored, so invalid data is still counted, never silently dropped.
 */
export function isHistoryOnly(tx: Transaction, balanceDate: ISODate): boolean {
  return !!tx.includedInBalance && tx.status !== 'pending' && tx.date <= balanceDate;
}

/** A transaction changes an account's balance only if dated on/after the opening date and not history only. */
export function affectsBalance(account: Account, tx: Transaction, balanceDate: ISODate = balanceDateFromAccount(account)): boolean {
  return tx.accountId === account.id && tx.date >= account.openingDate && !isHistoryOnly(tx, balanceDate);
}

/**
 * Phase 4A.5.6: a pending credit not yet available to spend: a pending refund, income or other money in.
 * Phase 4A.5.14 (owner decision): this includes the RECEIVING leg of a transfer between the user's own accounts.
 * Each leg settles on its own; money in transit is not spendable until the receiving bank posts it, while the
 * sending leg (a debit) counts as soon as it is recorded. Transfer neutrality therefore holds once both legs posted.
 */
export function isPendingCredit(tx: Transaction): boolean {
  return tx.status === 'pending' && tx.amountCents > 0;
}

/**
 * Phase 4A.5.14: not yet posted at the bank as of `asOf`: still pending, or posted on a later day (its own
 * postedDate; each transfer leg has one), like the bank's posted balance on that day.
 */
export function isUnpostedAsOf(tx: Transaction, asOf: ISODate): boolean {
  return tx.status === 'pending' || (!!tx.postedDate && tx.postedDate > asOf);
}

/**
 * Phase 4A.5.15 (owner decision): the card side of a card PAYMENT already initiated from another account and not yet
 * posted by the card issuer. Its sending leg is recorded (pending or posted) and is already counted against the
 * account it comes from, so the card debt it pays is not reserved a second time. A pending refund or other credit on
 * the card (not a transfer) is not a payment: it is still held back until it posts (Phase 4A.5.4). Only a recorded
 * transfer counts; a scheduled (recurring) payment that hasn't been initiated follows the scheduled-payment rules.
 */
export function isCardPaymentInTransit(account: Account | undefined, tx: Transaction, transactions: readonly Transaction[]): boolean {
  return !!account && account.type === 'credit_card' && tx.accountId === account.id && tx.status === 'pending' && tx.amountCents > 0 && !!tx.transferGroupId &&
    transactions.some((x) => x.transferGroupId === tx.transferGroupId && x.id !== tx.id && x.amountCents < 0);
}

/**
 * Pending credits (dated on or before `asOf`) included in the recorded balance but not yet spendable.
 * Phase 4A.5.15: on a card, a payment in transit (see isCardPaymentInTransit) is not one: it stays in the card's recorded
 * balance and lowers what is owed, because the money is already counted where it came from (counted exactly once).
 */
export function pendingCreditTotal(account: Account, transactions: readonly Transaction[], asOf: ISODate): Cents {
  const bd = balanceAsOfDate(account, transactions);
  let total = 0;
  for (const t of transactions) if (affectsBalance(account, t, bd) && t.date <= asOf && isPendingCredit(t) && !isCardPaymentInTransit(account, t, transactions)) total += t.amountCents;
  return total;
}

/** Phase 4A.5.15: card payments in transit (dated on or before `asOf`), for explanations. */
export function cardPaymentsInTransit(accounts: readonly Account[], transactions: readonly Transaction[], asOf: ISODate): { cardId: ID; fromAccountId: ID | null; cents: Cents; txId: ID }[] {
  const out: { cardId: ID; fromAccountId: ID | null; cents: Cents; txId: ID }[] = [];
  for (const a of accounts) {
    if (a.type !== 'credit_card') continue;
    const bd = balanceAsOfDate(a, transactions);
    for (const t of transactions) {
      if (!affectsBalance(a, t, bd) || t.date > asOf || !isCardPaymentInTransit(a, t, transactions)) continue;
      const from = transactions.find((x) => x.transferGroupId === t.transferGroupId && x.id !== t.id);
      out.push({ cardId: a.id, fromAccountId: from?.accountId ?? null, cents: t.amountCents, txId: t.id });
    }
  }
  return out;
}

/** Posted balance: the recorded balance without any pending items (what "Update balance" compares with the bank). */
export function postedBalance(account: Account, transactions: readonly Transaction[], asOf: ISODate): Cents {
  return accountBalance(account, transactions, asOf) - pendingTotal(account, transactions, asOf);
}

function balanceDateFromAccount(account: Account): ISODate {
  return account.balanceConfirmedDate && account.balanceConfirmedDate > account.openingDate ? account.balanceConfirmedDate : account.openingDate;
}

/**
 * The latest date the user confirmed this account's balance: the opening date, the latest "Update balance"
 * (Phase 4A.5.8: also one that matched exactly, stored on the account) or the latest adjustment.
 */
export function balanceAsOfDate(account: Account, transactions: readonly Transaction[]): ISODate {
  let d = balanceDateFromAccount(account);
  for (const t of transactions) if (t.accountId === account.id && t.kind === 'adjustment' && t.date > d) d = t.date;
  return d;
}

export type InclusionProblem = 'pending' | 'future' | 'before_opening' | 'after_balance_date';

/**
 * Phase 4A.5.8: can a transaction on `account` dated `date` be "already included" in the confirmed balance?
 * Only a posted transaction dated from the opening date through the confirmed balance date (and not in the future).
 */
export function inclusionProblem(account: Account, transactions: readonly Transaction[], date: ISODate, status: Transaction['status'], today: ISODate): InclusionProblem | null {
  if (status === 'pending') return 'pending';
  if (date > today) return 'future';
  if (date < account.openingDate) return 'before_opening';
  if (date > balanceAsOfDate(account, transactions)) return 'after_balance_date';
  return null;
}

/**
 * Phase 4A.5.8 (D7): why a transaction is kept as history only, for labels. Null when it changes the balance normally.
 * - 'included': already included in the balance confirmed as of `asOf`;
 * - 'before_opening': dated before the account was added, so already in its opening balance.
 */
export function historyStatus(account: Account | undefined, tx: Transaction, balanceDate: ISODate): { kind: 'included'; asOf: ISODate } | { kind: 'before_opening'; asOf: ISODate } | null {
  if (!account || tx.accountId !== account.id) return null;
  if (tx.date < account.openingDate) return { kind: 'before_opening', asOf: account.openingDate };
  if (isHistoryOnly(tx, balanceDate)) return { kind: 'included', asOf: tx.includedAsOf ?? balanceDate };
  return null;
}

/** Pending items in the account (dated on or before `asOf`), as Update balance lists them. */
export function pendingItems(account: Account, transactions: readonly Transaction[], asOf: ISODate): Transaction[] {
  const bd = balanceAsOfDate(account, transactions);
  return transactions.filter((t) => affectsBalance(account, t, bd) && t.date <= asOf && t.status === 'pending');
}

/**
 * Phase 4A.5.8: sets of pending items whose amounts add up exactly to an Update balance difference. If the bank's
 * posted balance moved by exactly that much, one of these may have cleared at the bank while still pending in
 * Clarity. Several sets can match (same amounts, or coincidences): every one is returned, none is assumed.
 * Searches sets of up to `maxSize` items; at most `limit` sets.
 */
export function pendingMatches(account: Account, transactions: readonly Transaction[], asOf: ISODate, differenceCents: Cents, maxSize = 3, limit = 20): Transaction[][] {
  if (differenceCents === 0) return [];
  const items = pendingItems(account, transactions, asOf).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
  const out: Transaction[][] = [];
  const walk = (from: number, chosen: Transaction[], sum: number) => {
    if (out.length >= limit) return;
    if (chosen.length > 0 && sum === differenceCents) out.push([...chosen]);
    if (chosen.length >= maxSize) return;
    for (let i = from; i < items.length; i++) {
      chosen.push(items[i]!);
      walk(i + 1, chosen, sum + items[i]!.amountCents);
      chosen.pop();
    }
  };
  walk(0, [], 0);
  return out.sort((a, b) => a.length - b.length);
}

/**
 * Phase 4A.5.9: pending items that could explain PART of a difference: same direction as the difference (a deposit
 * for a positive one, a purchase for a negative one) but not part of an exact match. Linear in the number of pending
 * items (no combination search); all of them are returned, closest in amount first (Phase 4A.5.10: no cap). Any
 * combination of pending items, of ANY size, that adds up to a positive difference contains at least one deposit
 * (and to a negative one, at least one purchase), and every such item not in an exact set is listed here: so a
 * combination too large for the exact search (more than 3 items) can never pass as "nothing could explain it".
 */
export function pendingPartialMatches(account: Account, transactions: readonly Transaction[], asOf: ISODate, differenceCents: Cents, exact: readonly Transaction[][] = [], limit = Infinity): Transaction[] {
  if (differenceCents === 0) return [];
  const inExact = new Set(exact.flat().map((t) => t.id));
  return pendingItems(account, transactions, asOf)
    .filter((t) => !inExact.has(t.id) && Math.sign(t.amountCents) === Math.sign(differenceCents))
    .sort((a, b) => Math.abs(a.amountCents - differenceCents) - Math.abs(b.amountCents - differenceCents) || (a.date < b.date ? -1 : 1))
    .slice(0, limit);
}

/**
 * Recorded balance of one account at the end of `asOf` (inclusive).
 * Pending transactions are included (they are labelled separately in the UI).
 */
export function accountBalance(account: Account, transactions: readonly Transaction[], asOf: ISODate): Cents {
  const bd = balanceAsOfDate(account, transactions);
  let total = account.openingBalanceCents;
  for (const t of transactions) {
    if (affectsBalance(account, t, bd) && t.date <= asOf) total += t.amountCents;
  }
  return total;
}

export function pendingTotal(account: Account, transactions: readonly Transaction[], asOf: ISODate): Cents {
  const bd = balanceAsOfDate(account, transactions);
  let total = 0;
  for (const t of transactions) {
    if (affectsBalance(account, t, bd) && t.date <= asOf && isUnpostedAsOf(t, asOf)) total += t.amountCents;
  }
  return total;
}

/** Spendable cash account: an asset account marked spendable, active, in the base currency. */
export function isCashAccount(a: Account, baseCurrency: CurrencyCode): boolean {
  return a.spendable && a.type !== 'credit_card' && !a.archived && a.currency === baseCurrency;
}

export interface AccountBalanceLine {
  accountId: ID;
  name: string;
  type: Account['type'];
  balanceCents: Cents;
  pendingCents: Cents;
  /** Phase 4A.5.6: pending credits in the balance, not available to spend until they clear. */
  pendingCreditCents?: Cents;
  countsAsCash: boolean;
  /** Archived account still listed because it owes money (Phase 4A.4.4). */
  archived?: boolean;
}

export interface BalanceSummary {
  asOf: ISODate;
  /** Sum of spendable asset accounts. */
  availableCashCents: Cents;
  /** Sum of all asset accounts in base currency (spendable or not). */
  totalAssetsCents: Cents;
  /** Positive number: total owed on credit cards in base currency. */
  cardOwedCents: Cents;
  /** totalAssets - cardOwed */
  netCents: Cents;
  lines: AccountBalanceLine[];
  /** Accounts left out of totals because their currency differs from the base currency. */
  excludedCurrencyAccountIds: ID[];
}

export function balanceSummary(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  asOf: ISODate,
  baseCurrency: CurrencyCode,
): BalanceSummary {
  let cash = 0;
  let assets = 0;
  let owed = 0;
  const lines: AccountBalanceLine[] = [];
  const excluded: ID[] = [];
  for (const a of accounts) {
    // Currency first, so archived accounts in another currency are named in the currency notice too (Phase 4A.4.4).
    if (a.currency !== baseCurrency) {
      excluded.push(a.id);
      continue;
    }
    const bal = accountBalance(a, transactions, asOf);
    if (a.archived) {
      // Archiving never hides debt (Phase 4A.4.4): an archived account that is overdrawn, or a card that still owes
      // money, stays in the totals. A positive archived balance does not (it isn't spendable). Phase 4A.5.14: a
      // pending credit (e.g. a transfer still on its way in) doesn't clear the debt until it posts.
      if (bal - (a.type === 'credit_card' ? 0 : pendingCreditTotal(a, transactions, asOf)) >= 0) continue;
      if (a.type === 'credit_card') owed += -bal;
      else assets += bal;
      lines.push({ accountId: a.id, name: a.name, type: a.type, balanceCents: bal, pendingCents: pendingTotal(a, transactions, asOf), countsAsCash: false, archived: true });
      continue;
    }
    const isCash = isCashAccount(a, baseCurrency);
    if (a.type === 'credit_card') owed += -bal;
    else assets += bal;
    if (isCash) cash += bal;
    lines.push({
      accountId: a.id,
      name: a.name,
      type: a.type,
      balanceCents: bal,
      pendingCents: pendingTotal(a, transactions, asOf),
      pendingCreditCents: pendingCreditTotal(a, transactions, asOf),
      countsAsCash: isCash,
    });
  }
  return {
    asOf,
    availableCashCents: cash,
    totalAssetsCents: assets,
    cardOwedCents: owed,
    netCents: assets - owed,
    lines,
    excludedCurrencyAccountIds: excluded,
  };
}
