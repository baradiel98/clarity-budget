import { describe, expect, it } from 'vitest';
import { balanceSummary, budgetSummary, buildDashboard, computeSafeToSpend, periodTotals, spendingByCategory } from '../src';
import { account, input, rec, transfer, tx } from './builders';

/**
 * Phase 1 audit: edge cases not covered elsewhere. Expected values are worked out by hand from the
 * rules in docs/calculation-rules.md; the engine stays the only source of the numbers.
 */
const chk = account({ id: 'chk', openingBalanceCents: 100000, openingDate: '2026-09-01' });
const cash = account({ id: 'cash', type: 'cash', openingBalanceCents: 5000, openingDate: '2026-09-01' });
const sav = account({ id: 'sav', type: 'savings', openingBalanceCents: 0, openingDate: '2026-09-01' });
const card = account({ id: 'card', type: 'credit_card', openingBalanceCents: -30000, openingDate: '2026-09-01' });

describe('transfers', () => {
  it('between two spendable accounts: cash unchanged, never spending or income', () => {
    const txs = transfer('chk', 'cash', '2026-09-02', 2000);
    expect(balanceSummary([chk, cash], txs, '2026-09-03', 'USD').availableCashCents).toBe(105000);
    expect(periodTotals(txs, '2026-09-01', '2026-09-30')).toMatchObject({ spendingCents: 0, incomeCents: 0 });
  });

  it('into a non-spendable savings account reduces available cash, still not spending', () => {
    const txs = transfer('chk', 'sav', '2026-09-02', 20000);
    const b = balanceSummary([chk, sav], txs, '2026-09-03', 'USD');
    expect(b.availableCashCents).toBe(80000);
    expect(b.totalAssetsCents).toBe(100000);
    expect(periodTotals(txs, '2026-09-01', '2026-09-30').spendingCents).toBe(0);
  });
});

describe('credit cards', () => {
  it('a refund on the card lowers what is owed and spending, not cash', () => {
    const txs = [
      tx({ accountId: 'card', date: '2026-09-02', amountCents: -8000, kind: 'expense', categoryId: 'cat_shopping', id: 'buy' }),
      tx({ accountId: 'card', date: '2026-09-03', amountCents: 3000, kind: 'refund', categoryId: 'cat_shopping', refundOfId: 'buy' }),
    ];
    const b = balanceSummary([chk, card], txs, '2026-09-03', 'USD');
    expect(b.availableCashCents).toBe(100000);
    expect(b.cardOwedCents).toBe(30000 + 8000 - 3000);
    expect(spendingByCategory(txs, '2026-09-01', '2026-09-30').get('cat_shopping')).toBe(5000);
  });

  it('a cash advance (card → checking) adds cash and debt, and is not income', () => {
    const txs = transfer('card', 'chk', '2026-09-02', 10000);
    const b = balanceSummary([chk, card], txs, '2026-09-03', 'USD');
    expect(b.availableCashCents).toBe(110000);
    expect(b.cardOwedCents).toBe(40000);
    expect(b.netCents).toBe(100000 - 30000); // net worth unchanged by moving money
    expect(periodTotals(txs, '2026-09-01', '2026-09-30').incomeCents).toBe(0);
  });

  it('paying more than owed: cash drops by the payment, the card shows a credit (negative owed), net worth unchanged', () => {
    const txs = transfer('chk', 'card', '2026-09-02', 40000);
    const b = balanceSummary([chk, card], txs, '2026-09-03', 'USD');
    expect(b.availableCashCents).toBe(60000);
    expect(b.cardOwedCents).toBe(-10000);
    expect(b.netCents).toBe(70000);
  });

  it('a recurring bill charged to the card does not reduce cash unless a card payment is scheduled', () => {
    const netflix = rec({ id: 'netflix', kind: 'bill', accountId: 'card', schedule: { freq: 'monthly', interval: 1, day: 10, anchor: '2026-09-10' }, amount: { type: 'fixed', cents: 1599 } });
    const i = input({ today: '2026-09-03', accounts: [chk, card], recurring: [netflix] });
    expect(computeSafeToSpend(i).lowPoint.cents).toBe(100000);
    const d = buildDashboard(i);
    expect(d.monthEnd.cents).toBe(100000);
    expect(d.warnings.some((w) => /card/i.test(w.title))).toBe(true); // the user is told card spending isn't deducted
    const withPayment = input({ today: '2026-09-03', accounts: [chk, card], recurring: [netflix, rec({ id: 'pay', kind: 'transfer', toAccountId: 'card', schedule: { freq: 'once', date: '2026-09-25' }, amount: { type: 'card_full_balance' } })] });
    // full balance on Sep 25 = 300.00 opening + 15.99 Netflix
    expect(buildDashboard(withPayment).monthEnd.cents).toBe(100000 - 30000 - 1599);
  });
});

describe('income estimates', () => {
  const variablePay = (history: number[]) => {
    const item = rec({ id: 'gig', kind: 'income', schedule: { freq: 'monthly', interval: 1, day: 20, anchor: '2026-09-20' }, amount: { type: 'variable', cents: 50000 } });
    const txs = history.map((c, k) => tx({ accountId: 'chk', date: `2026-0${6 + k}-20`, amountCents: c, kind: 'income', occurrenceRef: { recurringId: 'gig', originalDate: `2026-0${6 + k}-20` } }));
    const acct = account({ id: 'chk', openingBalanceCents: 100000, openingDate: '2026-06-01' });
    return input({ today: '2026-09-03', accounts: [acct], recurring: [item], transactions: txs });
  };

  it('variable income uses the user estimate until there is history, then the average of the last 3 (whole cents)', () => {
    expect(buildDashboard(variablePay([])).monthEnd.cents).toBe(100000 + 50000);
    // 400 + 500 + 601 = 1,501.00 / 3 = 500.333… → the engine must produce whole cents
    const d = buildDashboard(variablePay([40000, 50000, 60100]));
    const opening = 100000 + 40000 + 50000 + 60100;
    expect(Number.isInteger(d.monthEnd.cents)).toBe(true);
    expect(d.monthEnd.cents - opening).toBeGreaterThanOrEqual(50033);
    expect(d.monthEnd.cents - opening).toBeLessThanOrEqual(50034);
  });

  it('estimated income counts in the month-end projection but never in Safe to Spend', () => {
    const i = variablePay([]);
    expect(computeSafeToSpend(i).cents).toBe(100000);
  });
});

describe('month-end, lowest balance and Safe to Spend edges', () => {
  it('on the last day of the month, month-end equals the end of today', () => {
    const bill = rec({ id: 'b', kind: 'bill', schedule: { freq: 'once', date: '2026-09-30' }, amount: { type: 'fixed', cents: 2500 } });
    const d = buildDashboard(input({ today: '2026-09-30', accounts: [chk], recurring: [bill] }));
    expect(d.monthEnd.cents).toBe(97500);
    expect(d.endOfDay.cents).toBe(97500);
    expect(d.monthEnd.date).toBe('2026-09-30');
  });

  it('with nothing ahead, the lowest balance is today’s cash, dated today', () => {
    const d = buildDashboard(input({ today: '2026-09-03', accounts: [chk] }));
    expect(d.lowestThroughMonthEnd).toMatchObject({ cents: 100000, date: '2026-09-03' });
    expect(d.safeToSpend.cents).toBe(100000);
  });

  it('bill and paycheck both today: the low point is after the bill, before the paycheck', () => {
    const i = input({
      today: '2026-09-03', accounts: [chk], minReserveCents: 10000,
      recurring: [
        rec({ id: 'rent', kind: 'bill', schedule: { freq: 'once', date: '2026-09-03' }, amount: { type: 'fixed', cents: 120000 } }),
        rec({ id: 'pay', kind: 'income', schedule: { freq: 'once', date: '2026-09-03' }, amount: { type: 'fixed', cents: 180000 } }),
      ],
    });
    const s = computeSafeToSpend(i);
    expect(s.lowPoint.cents).toBe(-20000);
    expect(s.cents).toBe(-30000); // shown as "Short by", never clamped to zero
  });

  it('February month-end in a leap year is the 29th', () => {
    const acct = account({ id: 'chk', openingBalanceCents: 100000, openingDate: '2028-02-01' });
    const d = buildDashboard(input({ today: '2028-02-10', accounts: [acct], recurring: [rec({ id: 'b', kind: 'bill', startDate: '2028-01-01', trackFrom: '2028-02-01', schedule: { freq: 'once', date: '2028-02-29' }, amount: { type: 'fixed', cents: 1000 } })] }));
    expect(d.monthEnd).toMatchObject({ date: '2028-02-29', cents: 99000 });
  });
});

describe('splits and refunds in budgets', () => {
  it('a split purchase counts once in total spending and per part in categories', () => {
    const txs = [tx({ accountId: 'chk', date: '2026-09-04', amountCents: -12000, kind: 'expense', splits: [{ categoryId: 'cat_groceries', amountCents: -7000 }, { categoryId: 'cat_shopping', amountCents: -3000 }, { categoryId: 'cat_personal', amountCents: -2000 }] })];
    expect(periodTotals(txs, '2026-09-01', '2026-09-30').spendingCents).toBe(12000);
    const m = spendingByCategory(txs, '2026-09-01', '2026-09-30');
    expect([m.get('cat_groceries'), m.get('cat_shopping'), m.get('cat_personal')]).toEqual([7000, 3000, 2000]);
  });

  it('a refund larger than the month’s spending in a category gives negative spending (money back), not hidden', () => {
    const cats = [{ id: 'cat_shopping', name: 'Shopping', group: 'Lifestyle', icon: 'x', kind: 'expense' as const, archived: false, createdAt: 0, updatedAt: 0, budgetCents: 10000 }];
    const txs = [
      tx({ accountId: 'chk', date: '2026-09-04', amountCents: -2000, kind: 'expense', categoryId: 'cat_shopping' }),
      tx({ accountId: 'chk', date: '2026-09-06', amountCents: 5000, kind: 'refund', categoryId: 'cat_shopping' }), // refund of an August purchase
    ];
    const b = budgetSummary(cats, txs, '2026-09-01', '2026-09-30');
    const row = b.rows.find((r) => r.categoryId === 'cat_shopping')!;
    expect(row.spentCents).toBe(-3000);
    expect(row.remainingCents).toBe(13000);
  });
});
