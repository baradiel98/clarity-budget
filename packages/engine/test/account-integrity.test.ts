import { describe, expect, it } from 'vitest';
import { buildDashboard, buildForecast, computeSafeToSpend, type EngineInput } from '../src';
import { account, input, rec, transfer, tx } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.2: money can't come from an account that doesn't have it (D1), and a bill assigned to one
 * spendable account is checked against that account, not only the combined total (R2).
 *
 * Expected values are worked out by hand (arithmetic in the comments), not taken from the engine.
 * Model: each day, money going out of every account is applied first (bills, then transfers out),
 * then money coming in. A transfer out of a NON-spendable asset account (savings) moves at most what that
 * account holds at that moment; the rest is "unfunded" and never reaches the destination.
 */
const since = (d: string) => ({ startDate: d, trackFrom: d });
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const move = (id: string, from: string, to: string, date: string, cents: number) =>
  once(id, to === 'sav' ? 'savings' : 'transfer', date, cents, { accountId: from, toAccountId: to });
const chk = (bal: number) => account({ id: 'chk', name: 'Checking', openingBalanceCents: bal, openingDate: '2026-11-01' });
const sav = (bal: number) => account({ id: 'sav', name: 'Savings', type: 'savings', openingBalanceCents: bal, openingDate: '2026-11-01' });
const cashAcct = (bal: number) => account({ id: 'cash', name: 'Cash', type: 'cash', openingBalanceCents: bal, openingDate: '2026-11-01' });
const card = account({ id: 'card', name: 'Visa', type: 'credit_card', openingBalanceCents: 0, openingDate: '2026-11-01' });
const TODAY = '2026-11-13';
const endBalance = (i: EngineInput, id: string) =>
  buildForecast({ today: i.today, horizonEnd: '2026-12-31', accounts: i.accounts, transactions: i.transactions, recurring: i.recurring, exceptions: i.exceptions, baseCurrency: 'USD', includeEstimatedIncome: false }).endBalances[id];
const forecastOf = (i: EngineInput) =>
  buildForecast({ today: i.today, horizonEnd: '2026-12-31', accounts: i.accounts, transactions: i.transactions, recurring: i.recurring, exceptions: i.exceptions, baseCurrency: 'USD', includeEstimatedIncome: false });

describe('D1: transfers can only move money the sending account has', () => {
  it('the audited case: $0 savings → $1,000 to checking; rent $1,200 → short by $900 (was +$100)', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), sav(0)], recurring: [move('move', 'sav', 'chk', '2026-11-25', 100000), once('rent', 'bill', '2026-12-01', 120000)] });
    // 300 + 0 (nothing to move) − 1,200 = −900
    expect(computeSafeToSpend(i).cents).toBe(-90000);
    const f = forecastOf(i);
    expect(f.unfundedTransfers.map((u) => [u.date, u.fromAccountId, u.requestedCents, u.fundedCents])).toEqual([['2026-11-25', 'sav', 100000, 0]]);
    expect(f.endBalances.sav).toBe(0); // savings never goes negative to "create" the money
    expect(buildDashboard(i).warnings.some((w) => w.id === 'unfunded:occ:move|2026-11-25')).toBe(true);
  });

  it('the same case with rent $1,400 (as restated in the brief) → short by $1,100 (was −$100)', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), sav(0)], recurring: [move('move', 'sav', 'chk', '2026-11-25', 100000), once('rent', 'bill', '2026-12-01', 140000)] });
    expect(computeSafeToSpend(i).cents).toBe(30000 - 140000);
  });

  it('enough in savings: the full transfer counts, once', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), sav(200000)], recurring: [move('move', 'sav', 'chk', '2026-11-25', 100000), once('rent', 'bill', '2026-12-01', 120000)] });
    expect(computeSafeToSpend(i).cents).toBe(30000 + 100000 - 120000); // 100
    expect(forecastOf(i).unfundedTransfers).toEqual([]);
    expect(endBalance(i, 'sav')).toBe(100000);
    expect(endBalance(i, 'chk')).toBe(30000 + 100000 - 120000);
  });

  it('partly funded: $400 in savings, $1,000 requested → $400 moves, $600 is flagged', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), sav(40000)], recurring: [move('move', 'sav', 'chk', '2026-11-25', 100000), once('rent', 'bill', '2026-12-01', 120000)] });
    expect(computeSafeToSpend(i).cents).toBe(30000 + 40000 - 120000); // −500
    expect(forecastOf(i).unfundedTransfers.map((u) => [u.requestedCents, u.fundedCents])).toEqual([[100000, 40000]]);
    expect(endBalance(i, 'sav')).toBe(0);
  });

  it('several transfers from the same account draw it down in date order', () => {
    // savings 1,500: Nov 20 moves 1,000 (left 500); Nov 25 asks 1,000, only 500 moves.
    // Checking: 300 today → 1,300 → 1,800 → Dec 1 rent 1,200 → 600. Lowest day is today (300), so Safe to Spend = 300.
    const i = input({ today: TODAY, accounts: [chk(30000), sav(150000)], recurring: [move('m1', 'sav', 'chk', '2026-11-20', 100000), move('m2', 'sav', 'chk', '2026-11-25', 100000), once('rent', 'bill', '2026-12-01', 120000)] });
    expect(computeSafeToSpend(i).cents).toBe(30000);
    expect(endBalance(i, 'chk')).toBe(60000);
    expect(endBalance(i, 'sav')).toBe(0);
    expect(forecastOf(i).unfundedTransfers.map((u) => [u.date, u.requestedCents, u.fundedCents])).toEqual([['2026-11-25', 100000, 50000]]);
  });

  it("the sending account's own bills come first (its other scheduled activity counts)", () => {
    // savings 1,000 − its own 700 bill on Nov 22 = 300 → only 300 can move on Nov 25
    const i = input({ today: TODAY, accounts: [chk(30000), sav(100000)], recurring: [once('ins', 'bill', '2026-11-22', 70000, { accountId: 'sav' }), move('move', 'sav', 'chk', '2026-11-25', 100000), once('rent', 'bill', '2026-12-01', 120000)] });
    expect(computeSafeToSpend(i).cents).toBe(30000 + 30000 - 120000); // −600
  });

  it('same day: a bill out of savings is applied before a transfer out of it; money in arrives after money out', () => {
    // Nov 25: savings pays 400 first (1,000 → 600), then 600 of the 1,000 transfer moves.
    // Checking that day: 300 − rent 800 = −500 (outflows first), then +600 → 100.
    const i = input({ today: TODAY, accounts: [chk(30000), sav(100000)], recurring: [once('ins', 'bill', '2026-11-25', 40000, { accountId: 'sav' }), move('move', 'sav', 'chk', '2026-11-25', 100000), once('rent', 'bill', '2026-11-25', 80000)] });
    const s = computeSafeToSpend(i);
    expect(s.cents).toBe(-50000);
    expect(s.lowPoint.date).toBe('2026-11-25');
    expect(forecastOf(i).unfundedTransfers.map((u) => u.fundedCents)).toEqual([60000]);
  });

  it('a transfer recorded ahead of time (two future-dated legs) is checked the same way', () => {
    const legs = transfer('sav', 'chk', '2026-11-25', 100000);
    const i = input({ today: TODAY, accounts: [chk(30000), sav(0)], transactions: legs, recurring: [once('rent', 'bill', '2026-12-01', 120000)] });
    expect(computeSafeToSpend(i).cents).toBe(-90000);
    expect(forecastOf(i).unfundedTransfers).toHaveLength(1);
  });

  it('between spendable accounts the total is unchanged (no double counting) and nothing is invented', () => {
    const i = input({ today: TODAY, accounts: [chk(50000), cashAcct(0)], recurring: [move('atm', 'chk', 'cash', '2026-11-20', 20000)] });
    const s = computeSafeToSpend(i);
    expect(s.cents).toBe(50000);
    expect(endBalance(i, 'chk')! + endBalance(i, 'cash')!).toBe(50000);
    expect(forecastOf(i).unfundedTransfers).toEqual([]);
  });

  it('money moved INTO savings is never counted as spendable, and the total across accounts is conserved', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(0)], recurring: [move('save', 'chk', 'sav', '2026-11-20', 30000)] });
    expect(computeSafeToSpend(i).cents).toBe(70000);
    expect(endBalance(i, 'chk')! + endBalance(i, 'sav')!).toBe(100000);
  });

  it('a credit card is not treated as an asset that can run out (cash advances are borrowing; limits are not tracked)', () => {
    const i = input({ today: TODAY, accounts: [chk(10000), card], recurring: [move('adv', 'card', 'chk', '2026-11-20', 50000)] });
    expect(computeSafeToSpend(i).cents).toBe(10000);
    expect(forecastOf(i).unfundedTransfers).toEqual([]);
    expect(endBalance(i, 'card')).toBe(-50000);
  });

  it('transfers are never income: Reports-style income is untouched by scheduled transfers', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), sav(200000)], recurring: [move('move', 'sav', 'chk', '2026-11-25', 100000)] });
    const ev = forecastOf(i).days.flatMap((d) => d.events).find((e) => e.label === 'move')!;
    expect(ev.occurrence?.kind).toBe('transfer');
  });
});

describe('R2: a bill is checked against the account it is paid from', () => {
  const base = (extra: RecurringItem[] = []) => input({ today: TODAY, accounts: [chk(50000), cashAcct(30000)], recurring: [once('bill', 'bill', '2026-11-20', 60000, { accountId: 'cash' }), ...extra] });

  it('$800 combined, but the $600 bill is paid from Cash ($300): Safe to Spend stays $200 and the account shortfall is flagged', () => {
    const i = base();
    expect(computeSafeToSpend(i).cents).toBe(20000); // combined: 500 + 300 − 600
    const f = forecastOf(i);
    expect(f.accountShortfalls.map((a) => [a.accountId, a.date, a.lowCents])).toEqual([['cash', '2026-11-20', -30000]]);
    const w = buildDashboard(i).warnings.find((x) => x.id === 'account-short:cash')!;
    expect(w.title).toBe('Cash would go to −$300.00 on Nov 20');
    expect(w.detail).toContain('Move $300.00 into Cash before Nov 20');
    expect(computeSafeToSpend(i).explanation.assumptions.join(' ')).toMatch(/combines your spendable accounts/i);
  });

  it('a transfer the user schedules (Checking → Cash, $300 on Nov 19) resolves it; nothing is moved automatically', () => {
    const i = base([move('topup', 'chk', 'cash', '2026-11-19', 30000)]);
    expect(computeSafeToSpend(i).cents).toBe(20000);
    expect(forecastOf(i).accountShortfalls).toEqual([]);
    expect(buildDashboard(i).warnings.some((w) => w.id.startsWith('account-short:'))).toBe(false);
    expect(base().recurring).toHaveLength(1); // the engine never adds a transfer of its own
  });

  it('a single account going below zero is the overall shortfall, already warned about once (no duplicate warning)', () => {
    const i = input({ today: TODAY, accounts: [chk(50000)], recurring: [once('bill', 'bill', '2026-11-20', 60000)] });
    const d = buildDashboard(i);
    expect(d.safeToSpend.cents).toBe(-10000);
    expect(forecastOf(i).accountShortfalls.map((a) => a.accountId)).toEqual(['chk']);
    expect(d.warnings.some((w) => w.id.startsWith('account-short:'))).toBe(false);
    expect(d.warnings.some((w) => w.id === 'shortfall')).toBe(true);
  });
});

describe('Possible duplicates are flagged, never merged', () => {
  const rent = once('rent', 'bill', '2026-12-01', 140000, { name: 'Rent' });
  const planned = (date: string, cents: number, accountId = 'chk') => tx({ accountId, date, amountCents: -cents, kind: 'expense', merchant: 'Rent', id: `p-${date}-${cents}-${accountId}` });

  it('a planned transaction matching a scheduled bill (same account and amount, within 3 days) is flagged; both still count', () => {
    const i = input({ today: TODAY, accounts: [chk(200000), cashAcct(0)], recurring: [rent], transactions: [planned('2026-12-02', 140000)] });
    const d = buildDashboard(i);
    expect(d.safeToSpend.cents).toBe(200000 - 280000); // conservative: both are counted until the user resolves it
    const w = d.warnings.find((x) => x.id.startsWith('duplicate:'))!;
    expect(w.title).toBe('Possible duplicate: Rent on Dec 1');
    expect(w.detail).toMatch(/both are counted/i);
  });

  it('not flagged when the amount, account or timing differ', () => {
    for (const t of [planned('2026-12-01', 139999), planned('2026-12-01', 140000, 'cash'), planned('2026-12-08', 140000)]) {
      const d = buildDashboard(input({ today: TODAY, accounts: [chk(200000), cashAcct(200000)], recurring: [rent], transactions: [t] }));
      expect(d.warnings.some((w) => w.id.startsWith('duplicate:'))).toBe(false);
    }
  });
});

describe('Forecast disclosure (Phase 4A.2)', () => {
  // The audit's customer case: $2,000, no income, rent $1,400 monthly from Dec 1. Safe to Spend $600 covers Dec 1 only.
  const rentMonthly = rec({ id: 'rent', name: 'Rent', kind: 'bill', ...since('2026-12-01'), schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2026-12-01' }, amount: { type: 'fixed', cents: 140000 } });
  const noIncome = input({ today: TODAY, accounts: [chk(200000)], recurring: [rentMonthly] });

  it('no dependable income: the card says so, and names the next bill after the end date', () => {
    const s = computeSafeToSpend(noIncome);
    expect(s.cents).toBe(60000);
    expect(s.dependableIncome).toBe(false);
    expect(s.caption).toBe('No regular income is scheduled, so this only covers bills through Dec 31.');
    expect(s.nextAfterHorizon).toMatchObject({ label: 'Rent', date: '2027-01-01', cents: -140000 });
    expect(s.nextAfterNote).toBe('Next after Dec 31: Rent $1,400.00 on Jan 1 — not included.');
  });

  it('with a fixed paycheck, the caption states the paycheck assumption', () => {
    const pay = rec({ id: 'pay', kind: 'income', ...since('2026-11-20'), schedule: { freq: 'weekly', interval: 2, anchor: '2026-11-20' }, amount: { type: 'fixed', cents: 210000 } });
    const s = computeSafeToSpend(input({ today: TODAY, accounts: [chk(200000)], recurring: [pay, rentMonthly] }));
    expect(s.dependableIncome).toBe(true);
    expect(s.caption).toBe("Covers what's scheduled through Dec 31, if your paychecks arrive as scheduled.");
  });

  it('an estimated (variable) paycheck is not "dependable income"', () => {
    const gig = rec({ id: 'gig', kind: 'income', ...since('2026-11-20'), schedule: { freq: 'once', date: '2026-11-20' }, amount: { type: 'variable', cents: 210000 } });
    expect(computeSafeToSpend(input({ today: TODAY, accounts: [chk(200000)], recurring: [gig, rentMonthly] })).dependableIncome).toBe(false);
  });

  it('"Can I afford this?" never says an unqualified yes', async () => {
    const { canIAfford } = await import('../src');
    const r = canIAfford(noIncome, { amountCents: 60000, date: TODAY, accountId: 'chk' });
    expect(r.verdict).toBe('yes');
    expect(r.headline).toBe('Yes, through Dec 31');
    expect(r.scope).toBe('Checked against everything scheduled through Dec 31. No regular income is scheduled, so nothing after that is covered. Next after Dec 31: Rent $1,400.00 on Jan 1 — not included.');
  });

  it('"Lowest balance this month" names what the figure covers', async () => {
    const { TERMS } = await import('@clarity/shared');
    expect(TERMS.lowestBalance).toBe('Lowest balance this month');
    expect(buildDashboard(noIncome).lowestThroughMonthEnd.explanation.title).toBe('Lowest balance this month');
  });
});
