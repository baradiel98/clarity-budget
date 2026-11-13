import type { Cents, ID, ISODate, Transaction } from '@clarity/shared';

export interface PeriodTotals {
  incomeCents: Cents;
  /** Expenses minus refunds, as a positive number. */
  spendingCents: Cents;
  netCents: Cents;
  count: number;
}

/**
 * Income and spending for [from, to]. Transfers and balance adjustments are never income or spending.
 * Credit-card purchases count as spending when they happen; the card payment is a transfer, so
 * nothing is counted twice.
 */
export function periodTotals(transactions: readonly Transaction[], from: ISODate, to: ISODate, accountIds?: ReadonlySet<ID>): PeriodTotals {
  let income = 0;
  let spending = 0;
  let count = 0;
  for (const t of transactions) {
    if (t.date < from || t.date > to) continue;
    if (accountIds && !accountIds.has(t.accountId)) continue;
    if (t.kind === 'income') income += t.amountCents;
    else if (t.kind === 'expense') spending += -t.amountCents;
    else if (t.kind === 'refund') spending -= t.amountCents;
    else continue;
    count++;
  }
  return { incomeCents: income, spendingCents: spending, netCents: income - spending, count };
}

/** Spending per category (splits respected; refunds reduce their category). */
export function spendingByCategory(transactions: readonly Transaction[], from: ISODate, to: ISODate): Map<ID | null, Cents> {
  const out = new Map<ID | null, Cents>();
  const add = (k: ID | null, v: Cents) => out.set(k, (out.get(k) ?? 0) + v);
  for (const t of transactions) {
    if (t.date < from || t.date > to) continue;
    if (t.kind !== 'expense' && t.kind !== 'refund') continue;
    if (t.splits && t.splits.length) for (const s of t.splits) add(s.categoryId, -s.amountCents);
    else add(t.categoryId, -t.amountCents);
  }
  return out;
}

/** Merchant memory: most recent category used per merchant key. */
export function buildMerchantMemory(transactions: readonly Transaction[], keyOf: (m: string) => string): Map<string, { categoryId: ID | null; accountId: ID }> {
  const sorted = [...transactions].filter((t) => t.kind === 'expense' || t.kind === 'income' || t.kind === 'refund').sort((a, b) => (a.updatedAt - b.updatedAt));
  const mem = new Map<string, { categoryId: ID | null; accountId: ID }>();
  for (const t of sorted) {
    const k = keyOf(t.merchant);
    if (k && t.categoryId) mem.set(k, { categoryId: t.categoryId, accountId: t.accountId });
  }
  return mem;
}
