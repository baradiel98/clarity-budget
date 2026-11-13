import { addDays, endOfMonth, maxISO, type Account, type Category, type Cents, type CurrencyCode, type ID, type ISODate, type Transaction } from '@clarity/shared';
import { accountBalance, isCashAccount } from './balances';

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

export interface MonthPoint {
  /** 'YYYY-MM' */
  month: string;
  incomeCents: Cents;
  spendingCents: Cents;
  netCents: Cents;
  count: number;
}

/** The `count` months ending with the month of `end`, oldest first. */
export function monthsEnding(end: ISODate, count: number): string[] {
  let y = Number(end.slice(0, 4));
  let m = Number(end.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.unshift(`${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

/** Income, spending and net per month. Same rules as periodTotals (transfers and adjustments excluded). */
export function monthlySeries(transactions: readonly Transaction[], months: readonly string[], upTo?: ISODate): MonthPoint[] {
  return months.map((month) => {
    const from = `${month}-01`;
    const last = endOfMonth(from);
    const t = periodTotals(transactions, from, upTo && upTo < last ? upTo : last);
    return { month, incomeCents: t.incomeCents, spendingCents: t.spendingCents, netCents: t.netCents, count: t.count };
  });
}

export interface BudgetRow {
  categoryId: ID;
  name: string;
  group: string;
  icon: string;
  budgetCents: Cents | null;
  /** Expenses minus refunds in this category for the period (can be negative if refunds exceed spending). */
  spentCents: Cents;
  /** budget − spent; null when no budget is set. */
  remainingCents: Cents | null;
  over: boolean;
}

export interface BudgetSummary {
  rows: BudgetRow[];
  budgetedCents: Cents;
  /** Spending in categories that have a budget. */
  spentBudgetedCents: Cents;
  /** Spending in categories without a budget, plus uncategorized spending. */
  spentUnbudgetedCents: Cents;
  uncategorizedCents: Cents;
  remainingCents: Cents;
  overCount: number;
}

/**
 * Monthly budget vs actual spending per expense category. Spending uses spendingByCategory,
 * so splits and refunds are respected and transfers / card payments are never counted.
 */
export function budgetSummary(categories: readonly Category[], transactions: readonly Transaction[], from: ISODate, to: ISODate): BudgetSummary {
  const spent = spendingByCategory(transactions, from, to);
  const rows: BudgetRow[] = [];
  let budgeted = 0;
  let spentBudgeted = 0;
  let spentUnbudgeted = 0;
  let overCount = 0;
  const known = new Set<ID>();
  for (const c of categories) {
    if (c.kind !== 'expense') continue;
    known.add(c.id);
    const s = spent.get(c.id) ?? 0;
    const budget = c.budgetCents ?? null;
    if (c.archived && s === 0 && budget === null) continue;
    const remaining = budget === null ? null : budget - s;
    const over = remaining !== null && remaining < 0;
    if (budget !== null) {
      budgeted += budget;
      spentBudgeted += s;
      if (over) overCount++;
    } else spentUnbudgeted += s;
    rows.push({ categoryId: c.id, name: c.name, group: c.group, icon: c.icon, budgetCents: budget, spentCents: s, remainingCents: remaining, over });
  }
  let uncategorized = 0;
  for (const [id, v] of spent) if (id === null || !known.has(id)) uncategorized += v;
  spentUnbudgeted += uncategorized;
  return { rows, budgetedCents: budgeted, spentBudgetedCents: spentBudgeted, spentUnbudgetedCents: spentUnbudgeted, uncategorizedCents: uncategorized, remainingCents: budgeted - spentBudgeted, overCount };
}

/**
 * Recorded available cash at the end of each day in [from, to]. Starts no earlier than the latest
 * opening date among cash accounts, because balances before an account was added are not known.
 */
export function cashHistory(accounts: readonly Account[], transactions: readonly Transaction[], from: ISODate, to: ISODate, baseCurrency: CurrencyCode): { date: ISODate; cents: Cents }[] {
  const cash = accounts.filter((a) => isCashAccount(a, baseCurrency));
  if (cash.length === 0) return [];
  let start = from;
  for (const a of cash) start = maxISO(start, a.openingDate);
  const out: { date: ISODate; cents: Cents }[] = [];
  for (let d = start; d <= to; d = addDays(d, 1)) {
    let total = 0;
    for (const a of cash) total += accountBalance(a, transactions, d);
    out.push({ date: d, cents: total });
  }
  return out;
}
