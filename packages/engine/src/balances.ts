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
 * Phase 4A.5.6: a pending credit not yet available to spend: a pending refund, income or other money in
 * (not a transfer between the user's own accounts, whose sending leg is counted the same way).
 */
export function isPendingCredit(tx: Transaction): boolean {
  return tx.status === 'pending' && tx.amountCents > 0 && !tx.transferGroupId && tx.kind !== 'transfer';
}

/** Pending credits (dated on or before `asOf`) included in the recorded balance but not yet spendable. */
export function pendingCreditTotal(account: Account, transactions: readonly Transaction[], asOf: ISODate): Cents {
  const bd = balanceAsOfDate(account, transactions);
  let total = 0;
  for (const t of transactions) if (affectsBalance(account, t, bd) && t.date <= asOf && isPendingCredit(t)) total += t.amountCents;
  return total;
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
 * items (no combination search); the `limit` closest in amount are returned. A combination of more than 3 items that
 * adds up exactly isn't detected as exact, but each of its items still appears here, so nothing passes silently.
 */
export function pendingPartialMatches(account: Account, transactions: readonly Transaction[], asOf: ISODate, differenceCents: Cents, exact: readonly Transaction[][] = [], limit = 5): Transaction[] {
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
    if (affectsBalance(account, t, bd) && t.date <= asOf && t.status === 'pending') total += t.amountCents;
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
      // money, stays in the totals. A positive archived balance does not (it isn't spendable).
      if (bal >= 0) continue;
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
