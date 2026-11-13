import { describe, expect, it } from 'vitest';
import { buildDashboard, buildForecast, budgetSummary, canIAfford, cashHistory, computeSafeToSpend, monthlySeries, monthsEnding, periodTotals, spendingByCategory, balanceSummary, type EngineInput } from '../src';
import { account, input, rec, transfer, tx } from './builders';

const chk = account({ id: 'chk', openingBalanceCents: 120000, openingDate: '2026-09-03' });
const pay = rec({ id: 'pay', name: 'Paycheck', kind: 'income', schedule: { freq: 'weekly', interval: 2, anchor: '2026-09-12' }, amount: { type: 'fixed', cents: 180000 } });
const phone = rec({ id: 'phone', name: 'Phone', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 12, anchor: '2026-01-12' }, amount: { type: 'fixed', cents: 6000 } });
const power = rec({ id: 'power', name: 'Electricity', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 10, anchor: '2026-01-10' }, amount: { type: 'variable', cents: 9000 } });

/** Scenario A — hand-calculated in docs/calculation-rules.md (Worked example). */
const scenarioA: EngineInput = input({ today: '2026-09-03', accounts: [chk], recurring: [pay, phone, power], minReserveCents: 10000 });

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object') {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

describe('Scenario A: normal month', () => {
  const d = buildDashboard(scenarioA);
  it('projected month-end = 1,200 − 90 − 60 + 1,800 + 1,800', () => {
    expect(d.monthEnd.cents).toBe(465000);
  });
  it('lowest point is the payday morning, after the phone bill and before the paycheck', () => {
    expect(d.lowestThroughMonthEnd.cents).toBe(105000);
    expect(d.lowestThroughMonthEnd.date).toBe('2026-09-12');
    expect(d.lowestBeforeNextIncome?.cents).toBe(105000);
    expect(d.nextIncome?.date).toBe('2026-09-12');
  });
  it('Safe to Spend = lowest − reserve', () => {
    expect(d.safeToSpend.cents).toBe(95000);
    expect(d.safeToSpend.horizonReason).toBe('month_end');
  });
  it('end of today has nothing scheduled', () => {
    expect(d.endOfDay.cents).toBe(120000);
  });
  it('breakdown lines add up to the low point (no hidden deductions)', () => {
    const lp = d.safeToSpend.lowPoint;
    const sum = d.safeToSpend.availableCashCents + [...lp.incomeBefore, ...lp.obligations].reduce((s, e) => s + e.cashDeltaCents, 0);
    expect(sum).toBe(lp.cents);
  });
});

describe('Scenario B: bill before paycheck → shortfall, not hidden behind zero', () => {
  const i = input({
    today: '2026-09-03',
    accounts: [account({ id: 'chk', openingBalanceCents: 50000, openingDate: '2026-09-03' })],
    recurring: [
      rec({ id: 'rent', name: 'Rent', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 5, anchor: '2026-01-05' }, amount: { type: 'fixed', cents: 100000 } }),
      rec({ id: 'pay', kind: 'income', schedule: { freq: 'monthly', interval: 1, day: 15, anchor: '2026-01-15' }, amount: { type: 'fixed', cents: 150000 } }),
    ],
  });
  it('reports a negative Safe to Spend and warnings', () => {
    const d = buildDashboard(i);
    expect(d.safeToSpend.cents).toBe(-50000);
    expect(d.safeToSpend.shortfallCents).toBe(50000);
    expect(d.lowestThroughMonthEnd.date).toBe('2026-09-05');
    expect(d.monthEnd.cents).toBe(100000);
    expect(d.warnings.map((w) => w.id)).toEqual(expect.arrayContaining(['shortfall', 'below-zero']));
  });
});

describe('Bill and paycheck on the same day', () => {
  it('outflows are applied before inflows', () => {
    const i = input({
      today: '2026-09-03',
      accounts: [account({ id: 'chk', openingBalanceCents: 10000, openingDate: '2026-09-03' })],
      recurring: [
        rec({ id: 'rent', kind: 'bill', schedule: { freq: 'once', date: '2026-09-10' }, amount: { type: 'fixed', cents: 30000 } }),
        rec({ id: 'pay', kind: 'income', schedule: { freq: 'once', date: '2026-09-10' }, amount: { type: 'fixed', cents: 50000 } }),
      ],
    });
    const s = computeSafeToSpend(i);
    expect(s.lowPoint.cents).toBe(-20000);
    expect(s.cents).toBe(-20000);
  });
});

describe('Horizon extends to next known paycheck when it is after month-end', () => {
  it('includes the rent due on the 1st before a paycheck on the 2nd', () => {
    const i = input({
      today: '2026-09-25',
      accounts: [account({ id: 'chk', openingBalanceCents: 200000, openingDate: '2026-09-25' })],
      recurring: [
        rec({ id: 'rent', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2026-01-01' }, amount: { type: 'fixed', cents: 150000 }, trackFrom: '2026-09-25' }),
        rec({ id: 'pay', kind: 'income', schedule: { freq: 'monthly', interval: 1, day: 2, anchor: '2026-01-02' }, amount: { type: 'fixed', cents: 300000 }, trackFrom: '2026-09-25' }),
      ],
    });
    const s = computeSafeToSpend(i);
    expect(s.horizonEnd).toBe('2026-10-02');
    expect(s.horizonReason).toBe('next_income');
    expect(s.cents).toBe(50000);
  });
});

describe('Uncertain income', () => {
  const base = { today: '2026-09-03', accounts: [account({ id: 'chk', openingBalanceCents: 10000, openingDate: '2026-09-03' })] };
  const bill = rec({ id: 'bill', kind: 'bill', schedule: { freq: 'once', date: '2026-09-20' }, amount: { type: 'fixed', cents: 5000 } });

  it('"It varies" income with no amount counts as $0 and is flagged', () => {
    const i = input({ ...base, recurring: [bill, rec({ id: 'pay', name: 'Paycheck', kind: 'income', schedule: { freq: 'once', date: '2026-09-15' }, amount: { type: 'unknown' } })] });
    const d = buildDashboard(i);
    expect(d.monthEnd.cents).toBe(5000);
    expect(d.safeToSpend.cents).toBe(5000);
    expect(d.nextIncome).toBeNull();
    expect(d.warnings.some((w) => w.id.startsWith('unknown:'))).toBe(true);
  });

  it('estimated income is included in projections but not in Safe to Spend', () => {
    const i = input({ ...base, recurring: [bill, rec({ id: 'pay', kind: 'income', schedule: { freq: 'once', date: '2026-09-15' }, amount: { type: 'variable', cents: 70000 } })] });
    const d = buildDashboard(i);
    expect(d.monthEnd.cents).toBe(75000);
    expect(d.safeToSpend.cents).toBe(5000);
    expect(d.safeToSpend.excludedIncome.map((e) => e.excluded)).toEqual(['estimated_income']);
  });

  it('multiple income sources are all counted', () => {
    const i = input({
      ...base,
      recurring: [
        rec({ id: 'job1', kind: 'income', schedule: { freq: 'once', date: '2026-09-10' }, amount: { type: 'fixed', cents: 100000 } }),
        rec({ id: 'job2', kind: 'income', schedule: { freq: 'once', date: '2026-09-17' }, amount: { type: 'fixed', cents: 40000 } }),
      ],
    });
    expect(buildDashboard(i).monthEnd.cents).toBe(150000);
  });
});

describe('Overdue', () => {
  const rent = rec({ id: 'rent', name: 'Rent', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2026-01-01' }, amount: { type: 'fixed', cents: 100000 }, trackFrom: '2026-08-20' });
  const acct = account({ id: 'chk', openingBalanceCents: 300000, openingDate: '2026-08-20' });

  it('unpaid past bills are counted today', () => {
    const d = buildDashboard(input({ today: '2026-09-03', accounts: [acct], recurring: [rent] }));
    expect(d.endOfDay.cents).toBe(200000);
    expect(d.warnings.some((w) => w.id === 'overdue:rent|2026-09-01')).toBe(true);
  });

  it('recording the payment settles it (counted once)', () => {
    const paid = tx({ accountId: 'chk', date: '2026-09-02', amountCents: -100000, occurrenceRef: { recurringId: 'rent', originalDate: '2026-09-01' } });
    const d = buildDashboard(input({ today: '2026-09-03', accounts: [acct], recurring: [rent], transactions: [paid] }));
    expect(d.endOfDay.cents).toBe(200000);
    expect(d.monthEnd.cents).toBe(200000);
    expect(d.warnings.some((w) => w.id.startsWith('overdue'))).toBe(false);
  });

  it('a missed paycheck is NOT counted', () => {
    const pay = rec({ id: 'pay', kind: 'income', schedule: { freq: 'once', date: '2026-09-01' }, amount: { type: 'fixed', cents: 100000 }, trackFrom: '2026-08-20' });
    const d = buildDashboard(input({ today: '2026-09-03', accounts: [acct], recurring: [pay] }));
    expect(d.monthEnd.cents).toBe(300000);
  });
});

describe('Transfers, savings and credit cards are never double counted', () => {
  const sav = account({ id: 'sav', type: 'savings', openingBalanceCents: 0, openingDate: '2026-09-01' });
  const card = account({ id: 'card', type: 'credit_card', openingBalanceCents: 0, openingDate: '2026-09-01' });
  const chk2 = account({ id: 'chk', openingBalanceCents: 100000, openingDate: '2026-09-01' });

  it('a savings transfer reduces cash once and is not spending', () => {
    const savings = rec({ id: 'save', name: 'Savings', kind: 'savings', toAccountId: 'sav', schedule: { freq: 'once', date: '2026-09-20' }, amount: { type: 'fixed', cents: 20000 } });
    const s = computeSafeToSpend(input({ today: '2026-09-03', accounts: [chk2, sav], recurring: [savings], minReserveCents: 5000 }));
    expect(s.lowPoint.cents).toBe(80000);
    expect(s.cents).toBe(75000);
  });

  it('card purchase is spending; card payment is a transfer', () => {
    const txs = [
      tx({ accountId: 'card', date: '2026-09-02', amountCents: -5000, kind: 'expense', categoryId: 'cat_dining' }),
      ...transfer('chk', 'card', '2026-09-03', 5000),
    ];
    const t = periodTotals(txs, '2026-09-01', '2026-09-30');
    expect(t.spendingCents).toBe(5000);
    expect(t.incomeCents).toBe(0);
    const b = balanceSummary([chk2, card], txs, '2026-09-03', 'USD');
    expect(b.availableCashCents).toBe(95000);
    expect(b.cardOwedCents).toBe(0);
    expect(spendingByCategory(txs, '2026-09-01', '2026-09-30').get('cat_dining')).toBe(5000);
  });

  it('full-balance card payment uses the projected card balance, and afford-on-card flows through it', () => {
    const owed = tx({ accountId: 'card', date: '2026-09-02', amountCents: -30000, kind: 'expense' });
    const payCard = rec({ id: 'paycard', name: 'Card payment', kind: 'transfer', toAccountId: 'card', schedule: { freq: 'once', date: '2026-09-25' }, amount: { type: 'card_full_balance' } });
    const i = input({ today: '2026-09-03', accounts: [chk2, card], transactions: [owed], recurring: [payCard] });
    const s = computeSafeToSpend(i);
    expect(s.lowPoint.cents).toBe(70000);
    const a = canIAfford(i, { amountCents: 10000, accountId: 'card', date: '2026-09-10' });
    expect(a.after.lowPoint.cents).toBe(60000);
    expect(a.notes[0]).toMatch(/scheduled full-balance card payment/);
  });

  it('refunds reduce spending', () => {
    const txs = [
      tx({ accountId: 'chk', date: '2026-09-04', amountCents: -8000, kind: 'expense', categoryId: 'cat_shopping', id: 'buy' }),
      tx({ accountId: 'chk', date: '2026-09-06', amountCents: 3000, kind: 'refund', categoryId: 'cat_shopping', refundOfId: 'buy' }),
    ];
    expect(periodTotals(txs, '2026-09-01', '2026-09-30')).toMatchObject({ spendingCents: 5000, incomeCents: 0 });
    expect(spendingByCategory(txs, '2026-09-01', '2026-09-30').get('cat_shopping')).toBe(5000);
  });

  it('splits are respected in category totals', () => {
    const txs = [tx({ accountId: 'chk', date: '2026-09-04', amountCents: -10000, kind: 'expense', splits: [{ categoryId: 'cat_groceries', amountCents: -7000 }, { categoryId: 'cat_personal', amountCents: -3000 }] })];
    const m = spendingByCategory(txs, '2026-09-01', '2026-09-30');
    expect(m.get('cat_groceries')).toBe(7000);
    expect(m.get('cat_personal')).toBe(3000);
  });
});

describe('Can I afford this?', () => {
  it('returns yes / tight / no and never mutates input', () => {
    const frozen = deepFreeze(JSON.parse(JSON.stringify(scenarioA)) as EngineInput);
    expect(canIAfford(frozen, { amountCents: 50000, accountId: 'chk', date: '2026-09-03' }).verdict).toBe('yes');
    const tight = canIAfford(frozen, { amountCents: 100000, accountId: 'chk', date: '2026-09-03' });
    expect(tight.verdict).toBe('tight');
    expect(tight.after.cents).toBe(-5000);
    const no = canIAfford(frozen, { amountCents: 200000, accountId: 'chk', date: '2026-09-03' });
    expect(no.verdict).toBe('no');
    expect(no.shortfallCents).toBe(105000);
    expect(buildDashboard(frozen).safeToSpend.cents).toBe(95000);
  });

  it('a purchase after the low point can be fine even if larger than today’s Safe to Spend', () => {
    const r = canIAfford(scenarioA, { amountCents: 150000, accountId: 'chk', date: '2026-09-20' });
    expect(r.after.lowPoint.cents).toBe(105000);
    expect(r.verdict).toBe('yes');
  });
});

describe('Accounts and currency', () => {
  it('future-dated transactions are planned, not recorded', () => {
    const t = tx({ accountId: 'chk', date: '2026-09-15', amountCents: -2000 });
    const d = buildDashboard(input({ today: '2026-09-03', accounts: [chk], transactions: [t] }));
    expect(d.balances.availableCashCents).toBe(120000);
    expect(d.monthEnd.cents).toBe(118000);
    expect(d.upcoming.some((u) => u.txId === t.id)).toBe(true);
  });

  it('transactions before the opening date are history only', () => {
    const t = tx({ accountId: 'chk', date: '2026-08-15', amountCents: -2000 });
    expect(balanceSummary([chk], [t], '2026-09-03', 'USD').availableCashCents).toBe(120000);
  });

  it('accounts in another currency are excluded from totals, never added', () => {
    const eur = account({ id: 'eur', currency: 'EUR', openingBalanceCents: 99999 });
    const d = buildDashboard(input({ today: '2026-09-03', accounts: [chk, eur] }));
    expect(d.balances.availableCashCents).toBe(120000);
    expect(d.warnings.some((w) => w.id === 'currency')).toBe(true);
  });

  it('forecast rejects horizons in the past', () => {
    expect(() => buildForecast({ ...scenarioA, horizonEnd: '2026-09-01', includeEstimatedIncome: true })).toThrow();
  });
});

describe('Budget, monthly series and cash history', () => {
  const cat = (id: string, budgetCents?: number | null, kind: 'expense' | 'income' = 'expense') => ({ id, name: id, group: 'g', icon: 'tag', kind, archived: false, createdAt: 0, updatedAt: 0, ...(budgetCents !== undefined ? { budgetCents } : {}) });
  const acct = account({ id: 'chk', openingBalanceCents: 100000, openingDate: '2026-08-10' });
  const card2 = account({ id: 'card', type: 'credit_card', openingDate: '2026-08-10' });
  const txs = [
    tx({ accountId: 'chk', date: '2026-09-02', amountCents: -6000, kind: 'expense', categoryId: 'food' }),
    tx({ accountId: 'card', date: '2026-09-05', amountCents: -5000, kind: 'expense', categoryId: 'food' }),
    tx({ accountId: 'chk', date: '2026-09-06', amountCents: 1000, kind: 'refund', categoryId: 'food' }),
    tx({ accountId: 'chk', date: '2026-09-07', amountCents: -3000, kind: 'expense', categoryId: 'fun' }),
    tx({ accountId: 'chk', date: '2026-09-08', amountCents: -700, kind: 'expense' }),
    tx({ accountId: 'chk', date: '2026-09-09', amountCents: -4000, kind: 'expense', splits: [{ categoryId: 'food', amountCents: -1000 }, { categoryId: 'fun', amountCents: -3000 }] }),
    ...transfer('chk', 'card', '2026-09-10', 5000),
    tx({ accountId: 'chk', date: '2026-09-12', amountCents: 200000, kind: 'income', categoryId: 'pay' }),
    tx({ accountId: 'chk', date: '2026-08-20', amountCents: -2500, kind: 'expense', categoryId: 'food' }),
  ];
  const cats = [cat('food', 10000), cat('fun', 5000), cat('none'), cat('zero', 0), cat('pay', undefined, 'income')];

  it('budget vs actual respects splits, refunds and never counts card payments', () => {
    const b = budgetSummary(cats, txs, '2026-09-01', '2026-09-30');
    const row = (id: string) => b.rows.find((r) => r.categoryId === id)!;
    // food: 60 + 50 − 10 + 10 (split) = 110 → over by 10
    expect(row('food')).toMatchObject({ spentCents: 11000, remainingCents: -1000, over: true });
    // fun: 30 + 30 (split) = 60 → over by 10
    expect(row('fun')).toMatchObject({ spentCents: 6000, remainingCents: -1000, over: true });
    expect(row('none')).toMatchObject({ budgetCents: null, remainingCents: null, over: false });
    expect(row('zero')).toMatchObject({ budgetCents: 0, remainingCents: 0, over: false });
    expect(b.rows.some((r) => r.categoryId === 'pay')).toBe(false);
    expect(b).toMatchObject({ budgetedCents: 15000, spentBudgetedCents: 17000, uncategorizedCents: 700, spentUnbudgetedCents: 700, remainingCents: -2000, overCount: 2 });
    // identity: budgeted + unbudgeted spending = total spending for the period
    expect(b.spentBudgetedCents + b.spentUnbudgetedCents).toBe(periodTotals(txs, '2026-09-01', '2026-09-30').spendingCents);
  });

  it('monthly series matches period totals and crosses years', () => {
    expect(monthsEnding('2026-02-15', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    const s = monthlySeries(txs, ['2026-08', '2026-09']);
    expect(s).toEqual([
      { month: '2026-08', incomeCents: 0, spendingCents: 2500, netCents: -2500, count: 1 },
      { month: '2026-09', incomeCents: 200000, spendingCents: 17700, netCents: 182300, count: 7 },
    ]);
    expect(monthlySeries(txs, ['2026-09'], '2026-09-05')[0]!.spendingCents).toBe(11000);
  });

  it('cash history is recorded cash per day and never starts before accounts were added', () => {
    const h = cashHistory([acct, card2], txs, '2026-08-01', '2026-09-03', 'USD');
    expect(h[0]).toEqual({ date: '2026-08-10', cents: 100000 });
    expect(h.find((x) => x.date === '2026-08-20')!.cents).toBe(97500);
    expect(h[h.length - 1]).toEqual({ date: '2026-09-03', cents: 91500 });
    expect(cashHistory([card2], txs, '2026-08-01', '2026-09-03', 'USD')).toEqual([]);
  });
});
