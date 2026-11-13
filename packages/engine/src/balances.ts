import type { Account, Cents, CurrencyCode, ID, ISODate, Transaction } from '@clarity/shared';

/** A transaction changes an account's balance only if dated on/after the opening date. */
export function affectsBalance(account: Account, tx: Transaction): boolean {
  return tx.accountId === account.id && tx.date >= account.openingDate;
}

/**
 * Recorded balance of one account at the end of `asOf` (inclusive).
 * Pending transactions are included (they are labelled separately in the UI).
 */
export function accountBalance(account: Account, transactions: readonly Transaction[], asOf: ISODate): Cents {
  let total = account.openingBalanceCents;
  for (const t of transactions) {
    if (affectsBalance(account, t) && t.date <= asOf) total += t.amountCents;
  }
  return total;
}

export function pendingTotal(account: Account, transactions: readonly Transaction[], asOf: ISODate): Cents {
  let total = 0;
  for (const t of transactions) {
    if (affectsBalance(account, t) && t.date <= asOf && t.status === 'pending') total += t.amountCents;
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
  countsAsCash: boolean;
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
    if (a.archived) continue;
    if (a.currency !== baseCurrency) {
      excluded.push(a.id);
      continue;
    }
    const bal = accountBalance(a, transactions, asOf);
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
