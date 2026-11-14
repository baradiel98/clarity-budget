import { describe, expect, it } from 'vitest';
import { accountBalance, buildDashboard, buildForecast, canIAfford, computeSafeToSpend, type EngineInput, type Forecast } from '../src';
import { account, input, rec } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.4.2 regression tests (audit 4A.4.1): archived accounts, cross-currency transfers, complete warning
 * lists and competing-transfer explanations. Expected values are worked out by hand in the comments.
 * Today is Fri, Nov 13, 2026; no paycheck after November, so Safe to Spend runs through Dec 31.
 */
const TODAY = '2026-11-13';
const since = (d: string) => ({ startDate: d, trackFrom: d });
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const move = (id: string, from: string, to: string, date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  once(id, 'transfer', date, cents, { accountId: from, toAccountId: to, ...extra });
const A = (id: string, name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', bal: number, extra: Record<string, unknown> = {}) =>
  account({ id, name, type, openingBalanceCents: bal, openingDate: '2026-11-01', ...extra });
const chk = (b: number) => A('chk', 'Checking', 'checking', b);
const old = (b: number) => A('old', 'Old checking', 'checking', b, { archived: true });

const forecastOf = (i: EngineInput): Forecast =>
  buildForecast({ today: i.today, horizonEnd: computeSafeToSpend(i).horizonEnd, accounts: i.accounts, transactions: i.transactions, recurring: i.recurring, exceptions: i.exceptions, baseCurrency: 'USD', includeEstimatedIncome: false });
const end = (i: EngineInput) => forecastOf(i).endBalances;
const warns = (i: EngineInput) => buildDashboard(i).warnings;
const warning = (i: EngineInput, prefix: string) => warns(i).find((w) => w.id.startsWith(prefix));

/** Same reconciliation as financial-integrity.test.ts; cross-currency transfers only debit the sender. */
function reconcile(i: EngineInput) {
  const f = forecastOf(i);
  const startTotal = i.accounts.reduce((s, a) => s + accountBalance(a, i.transactions, i.today), 0);
  const nonTransfer = f.days.flatMap((d) => d.events).filter((e) => e.legs.length !== 2).reduce((s, e) => s + e.legs.reduce((a, l) => a + l.deltaCents, 0), 0);
  const covered = f.coveredPayments.reduce((s, c) => s + c.coveredCents, 0);
  expect(Object.values(f.endBalances).reduce((s, b) => s + b, 0)).toBe(startTotal + nonTransfer + covered);
  expect(f.days.at(-1)!.endCashCents).toBe(f.cashAccountIds.reduce((s, id) => s + (f.endBalances[id] ?? 0), 0) - covered);
}

describe('Archived accounts never silently remove scheduled obligations', () => {
  const rent = (extra: Partial<RecurringItem> = {}) => once('rent', 'bill', '2026-12-01', 80000, { accountId: 'old', name: 'Rent', ...extra });

  it('audit example: $800 rent from an archived account holding $0 → Safe to Spend $200 (was $1,000, no warning)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), old(0)], recurring: [rent()] });
    // the archived account pays nothing; the $800 has to come from Checking: 1,000 − 800 = 200
    expect(computeSafeToSpend(i).cents).toBe(20000);
    expect(end(i)).toEqual({ chk: 100000, old: 0 });
    expect(warning(i, 'covered:')!.title).toBe("Rent: Old checking can't cover it");
    const w = warning(i, 'archived:old')!;
    expect(w.title).toBe('1 scheduled item still uses Old checking, which is archived');
    expect(w.detail).toContain('Rent (Dec 1)');
    expect(w.items).toEqual([{ date: '2026-12-01', label: 'Rent', cents: -80000 }]);
    reconcile(i);
  });

  it('enough in the archived account ($2,000): it pays the rent itself; its balance is still not spendable', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), old(200000)], recurring: [rent()] });
    expect(computeSafeToSpend(i).cents).toBe(100000); // the $2,000 is not added to Safe to Spend
    expect(end(i)).toEqual({ chk: 100000, old: 120000 });
    expect(warning(i, 'covered:')).toBeUndefined();
    expect(warning(i, 'archived:old')).toBeDefined(); // still listed so the user knows it's there
    reconcile(i);
  });

  it('several bills: archived $500 pays the $100 phone (Nov 20), then $400 of the $800 rent; $400 is counted', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), old(50000)], recurring: [rent(), once('phone', 'bill', '2026-11-20', 10000, { accountId: 'old', name: 'Phone' })] });
    expect(computeSafeToSpend(i).cents).toBe(100000 - 40000); // 600
    expect(forecastOf(i).coveredPayments.map((c) => [c.label, c.fundedCents, c.coveredCents])).toEqual([['Rent', 40000, 40000]]);
    expect(warning(i, 'archived:old')!.title).toBe('2 scheduled items still use Old checking, which is archived');
    reconcile(i);
  });

  it('income into an archived account is not counted as spendable, and is listed', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), old(0)], recurring: [once('pay', 'income', '2026-11-20', 200000, { accountId: 'old', name: 'Paycheck' })] });
    expect(computeSafeToSpend(i).cents).toBe(100000);
    expect(end(i)).toEqual({ chk: 100000, old: 200000 });
    expect(warning(i, 'archived:old')!.items).toEqual([{ date: '2026-11-20', label: 'Paycheck', cents: 200000 }]);
    reconcile(i);
  });

  it('transfers: into the archived account is money leaving; out of it moves only what it holds', () => {
    const into = input({ today: TODAY, accounts: [chk(100000), old(0)], recurring: [move('m', 'chk', 'old', '2026-11-20', 30000)] });
    expect(computeSafeToSpend(into).cents).toBe(70000); // 1,000 − 300
    expect(end(into)).toEqual({ chk: 70000, old: 30000 });
    reconcile(into);
    const outOk = input({ today: TODAY, accounts: [chk(100000), old(30000)], recurring: [move('m', 'old', 'chk', '2026-11-20', 30000)] });
    expect(end(outOk)).toEqual({ chk: 130000, old: 0 });
    const outEmpty = input({ today: TODAY, accounts: [chk(100000), old(0)], recurring: [move('m', 'old', 'chk', '2026-11-20', 30000, { name: 'Close out' })] });
    expect(end(outEmpty)).toEqual({ chk: 100000, old: 0 });
    expect(warning(outEmpty, 'unfunded:')!.title).toBe("Close out: Old checking won't have the money");
    reconcile(outEmpty);
  });

  it('"Can I afford this?" from an archived account with $0 counts the purchase against spendable cash', () => {
    const r = canIAfford(input({ today: TODAY, accounts: [chk(100000), old(0)] }), { amountCents: 50000, accountId: 'old', date: TODAY });
    expect([r.verdict, r.after.cents]).toEqual(['move_first', 50000]);
  });
});

describe('Different currencies are never added together', () => {
  const eurSav = (b: number) => A('eur', 'Euro savings', 'savings', b, { currency: 'EUR' });

  it('EUR savings → USD checking: nothing arrives in USD (was +$500 as if EUR were USD)', () => {
    const i = input({ today: TODAY, accounts: [chk(10000), eurSav(100000)], recurring: [move('fx', 'eur', 'chk', '2026-11-20', 50000, { name: 'Move euros' }), once('rent', 'bill', '2026-12-01', 50000, { name: 'Rent' })] });
    // USD only: 100 − 500 = −400 (before: 100 + 500 − 500 = 100)
    expect(computeSafeToSpend(i).cents).toBe(-40000);
    expect(end(i)).toEqual({ chk: -40000, eur: 50000 }); // €500 leaves the euro account; no dollars arrive
    const w = warning(i, 'currency-transfer:')!;
    expect(w.title).toBe("Move euros: Euro savings (EUR) to Checking (USD) isn't converted");
    expect(w.detail).toContain('nothing is counted as arriving in Checking');
    expect(forecastOf(i).currencyConflicts.map((c) => [c.fromCurrency, c.toCurrency, c.cents, c.counted])).toEqual([['EUR', 'USD', -50000, true]]);
  });

  it('USD checking → EUR savings: the dollars leaving are counted; nothing is added to the euro balance', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), eurSav(100000)], recurring: [move('fx', 'chk', 'eur', '2026-11-20', 30000, { name: 'Send euros' })] });
    expect(computeSafeToSpend(i).cents).toBe(70000); // 1,000 − 300
    expect(end(i)).toEqual({ chk: 70000, eur: 100000 });
    expect(warning(i, 'currency-transfer:')!.title).toBe("Send euros: Checking (USD) to Euro savings (EUR) isn't converted");
  });

  it('a full-balance payment to a card in another currency has no USD amount: not counted, and said so', () => {
    const card = A('card', 'Euro card', 'credit_card', -40000, { currency: 'EUR' });
    const pay = rec({ id: 'p', name: 'Card payment', kind: 'transfer', accountId: 'chk', toAccountId: 'card', ...since('2026-11-25'), schedule: { freq: 'once', date: '2026-11-25' }, amount: { type: 'card_full_balance' } });
    const i = input({ today: TODAY, accounts: [chk(100000), card], recurring: [pay] });
    expect(computeSafeToSpend(i).cents).toBe(100000);
    expect(warning(i, 'currency-transfer:')!.detail).toContain("has no amount in USD and isn't counted");
  });

  it('a bill paid from a EUR account is left out of Safe to Spend and listed in the currency notice', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), eurSav(0)], recurring: [once('fee', 'bill', '2026-11-20', 50000, { accountId: 'eur', name: 'Fee' })] });
    expect(computeSafeToSpend(i).cents).toBe(100000);
    const w = warning(i, 'currency')!;
    expect(w.detail).toBe("Accounts in a currency other than USD are left out of totals. Their scheduled items aren't counted in Safe to Spend either: Fee (Nov 20).");
  });

  it('"Can I afford this?" from a EUR account is not checked (never "Yes"); from USD it is unchanged', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), eurSav(500000)] });
    const r = canIAfford(i, { amountCents: 1000, accountId: 'eur', date: TODAY });
    expect(r.verdict).toBe('unverified');
    expect(r.headline).toBe("Can't check this: Euro savings is in EUR");
    expect(canIAfford(i, { amountCents: 1000, accountId: 'chk', date: TODAY }).headline).toBe('Yes, through Dec 31');
  });
});

describe('Every warning is returned, most important first, with every date', () => {
  const emptySav = A('sav', 'Savings', 'savings', 0);
  const tops = (n: number) => Array.from({ length: n }, (_, k) => move(`t${k}`, 'sav', 'chk', `2026-11-${String(15 + k).padStart(2, '0')}`, 10000, { name: `Top up ${k + 1}` }));

  it('more than five: 5 unfunded transfers + a Cash shortfall → all 6 returned (4A.4.1 found the 6th hidden)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('cash', 'Cash', 'cash', 30000), emptySav], recurring: [...tops(5), once('rep', 'bill', '2026-11-20', 60000, { accountId: 'cash', name: 'Car repair' })] });
    const w = warns(i);
    expect(w).toHaveLength(6);
    expect(w.map((x) => x.title)).toContain('Cash would go to −$300.00 on Nov 20');
  });

  it('more than ten, including a critical one: critical first; ids unique; nothing dropped', () => {
    const i = input({ today: TODAY, accounts: [chk(10000), emptySav], recurring: [...tops(11), once('rent', 'bill', '2026-12-01', 50000, { name: 'Rent' })] });
    const w = warns(i);
    // 11 unfunded transfers + "Short by $400" (100 − 500). No "below zero this month": the low is Dec 1, after November.
    expect(w.filter((x) => x.id.startsWith('unfunded:'))).toHaveLength(11);
    expect(w[0]!.title).toBe('Short by $400.00');
    expect(w).toHaveLength(12);
    expect(new Set(w.map((x) => x.id)).size).toBe(w.length);
  });

  it('several accounts, each with many shortfall dates: every date, and the lowest, are kept', () => {
    const bills = (acct: string, n: number) => Array.from({ length: n }, (_, k) => {
      const day = 14 + k * 3;
      const date = day <= 30 ? `2026-11-${String(day).padStart(2, '0')}` : `2026-12-${String(day - 30).padStart(2, '0')}`;
      return once(`${acct}${k}`, 'bill', date, k === 8 ? 100000 : 10000, { accountId: acct, name: `${acct} bill ${k + 1}` });
    });
    const i = input({ today: TODAY, accounts: [chk(500000), A('cash', 'Cash', 'cash', 0), A('wal', 'Wallet', 'cash', 0)], recurring: [...bills('cash', 12), ...bills('wal', 7)] });
    const cash = warning(i, 'account-short:cash')!;
    // Cash: −100, −200 … −800 (Dec 5), −1,800 (Dec 8, the $1,000 bill), … −2,100 (Dec 17)
    expect(cash.items).toHaveLength(12);
    expect(cash.items!.at(-1)).toEqual({ date: '2026-12-17', label: 'Cash after cash bill 12', cents: -210000 });
    expect(cash.items![8]).toEqual({ date: '2026-12-08', label: 'Cash after cash bill 9', cents: -180000 });
    expect(cash.detail).toContain('7 more'); // the short text is summarised …
    expect(cash.detail).toContain('Lowest: −$2,100.00 on Dec 17'); // … but never hides the lowest amount and date
    expect(cash.detail).toContain('Move $2,100.00 into Cash before Nov 14');
    const wal = warning(i, 'account-short:wal')!;
    expect(wal.items).toHaveLength(7);
    expect(wal.detail).toContain('Lowest: −$700.00 on Dec 2');
    expect([cash.accountId, wal.accountId]).toEqual(['cash', 'wal']);
  });

  it('a warning goes away only when the projected balances really cover it', () => {
    const base = [once('b1', 'bill', '2026-11-20', 30000, { accountId: 'cash' }), once('b2', 'bill', '2026-12-05', 30000, { accountId: 'cash' })];
    const mk = (extra: RecurringItem[]) => input({ today: TODAY, accounts: [chk(200000), A('cash', 'Cash', 'cash', 0)], recurring: [...base, ...extra] });
    expect(warning(mk([]), 'account-short:cash')!.items!.map((x) => x.cents)).toEqual([-30000, -60000]);
    expect(warning(mk([move('fix', 'chk', 'cash', '2026-11-19', 30000)]), 'account-short:cash')!.items!.map((x) => x.cents)).toEqual([-30000]); // only the first is fixed
    expect(warning(mk([move('fix', 'chk', 'cash', '2026-11-19', 60000)]), 'account-short:cash')).toBeUndefined();
  });
});

describe('Competing same-day transfers from savings explain the allocation', () => {
  // Savings $500, Checking $700, rent $1,200 Dec 1; transfers on Nov 30.
  const S = (rs: RecurringItem[], accts: ReturnType<typeof A>[] = []) =>
    input({ today: TODAY, accounts: [chk(70000), A('sav', 'Savings', 'savings', 50000), ...accts], recurring: [once('rent', 'bill', '2026-12-01', 120000, { name: 'Rent' }), ...rs] });
  const topUp = (cents = 50000) => move('tc', 'sav', 'chk', '2026-11-30', cents, { name: 'Rent top-up' });

  it('a move to another savings account is counted first; the explanation names it and the amounts', () => {
    const i = S([move('ts', 'sav', 'hol', '2026-11-30', 50000, { name: 'Holiday fund' }), topUp()], [A('hol', 'Holiday', 'savings', 0)]);
    expect(end(i)).toEqual({ chk: -50000, sav: 0, hol: 50000 }); // 700 − 1,200; the $500 went to Holiday
    expect(computeSafeToSpend(i).cents).toBe(-50000);
    const w = warning(i, 'unfunded:')!;
    expect(w.title).toBe("Rent top-up: Savings won't have the money");
    expect(w.detail).toContain('Requested $500.00; counted $0.00; not counted $500.00.');
    expect(w.detail).toContain('Counted first: Holiday fund ($500.00 of $500.00).');
    expect(w.detail).toContain('That is a cautious assumption, not how your bank will necessarily process them.');
    reconcile(i);
  });

  it('a card payment is counted first', () => {
    const i = S([move('cp', 'sav', 'card', '2026-11-30', 50000, { name: 'Visa payment' }), topUp()], [A('card', 'Visa', 'credit_card', -50000)]);
    expect(end(i)).toEqual({ chk: -50000, sav: 0, card: 0 });
    expect(warning(i, 'unfunded:')!.detail).toContain('Counted first: Visa payment ($500.00 of $500.00).');
  });

  it('several: Holiday $200 first, then $300 shared between two $400 top-ups ($150 each), as explained', () => {
    const i = S([move('ts', 'sav', 'hol', '2026-11-30', 20000, { name: 'Holiday fund' }), topUp(40000), move('tw', 'sav', 'cash', '2026-11-30', 40000, { name: 'Wallet top-up' })], [A('hol', 'Holiday', 'savings', 0), A('cash', 'Cash', 'cash', 0)]);
    expect(end(i)).toEqual({ chk: 70000 + 15000 - 120000, sav: 0, hol: 20000, cash: 15000 });
    const rentW = warns(i).find((w) => w.title.startsWith('Rent top-up'))!;
    expect(rentW.detail).toContain('Requested $400.00; counted $150.00; not counted $250.00.');
    expect(rentW.detail).toContain('Counted first: Holiday fund ($200.00 of $200.00). Shared in proportion with: Wallet top-up ($150.00 of $400.00).');
    reconcile(i);
  });
});
