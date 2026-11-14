import { describe, expect, it } from 'vitest';
import { buildDashboard, buildForecast, computeSafeToSpend, type EngineInput } from '../src';
import { account, input, rec, transfer, tx } from './builders';

/**
 * Phase 4A regression: Safe to Spend must not overlook known obligations just after month-end.
 * Found in the Phase 4 audit: with rent due Dec 1, Safe to Spend reported the whole balance.
 *
 * Rule (docs/calculation-rules.md): the horizon is the later of the end of next month and the first
 * dependable (fixed-amount) paycheck after this month ends. Every scheduled outflow in it counts;
 * only dependable income counts, on the day it arrives.
 *
 * Each recurring item here starts on its first real date (startDate/trackFrom), so nothing is overdue.
 */
const since = (d: string) => ({ startDate: d, trackFrom: d });
const rent = (amount = 140000) => rec({ id: 'rent', kind: 'bill', ...since('2026-12-01'), schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2026-12-01' }, amount: { type: 'fixed', cents: amount } });
const biweeklyPay = (anchor: string, cents: number) => rec({ id: 'pay', kind: 'income', ...since(anchor), schedule: { freq: 'weekly', interval: 2, anchor }, amount: { type: 'fixed', cents } });

/** Spend exactly Safe to Spend today; return the lowest daily cash through the horizon. */
function lowestAfterSpendingAll(i: EngineInput) {
  const s = computeSafeToSpend(i);
  const spend = tx({ accountId: 'chk', date: i.today, amountCents: -s.cents, kind: 'expense', id: 'spend-all' });
  const f = buildForecast({ today: i.today, horizonEnd: s.horizonEnd, accounts: i.accounts, transactions: [...i.transactions, spend], recurring: i.recurring, exceptions: i.exceptions, baseCurrency: i.baseCurrency, includeEstimatedIncome: false });
  return { s, low: Math.min(...f.days.map((d) => d.lowCashCents)) };
}

describe('Safe to Spend: obligations just after month-end (Phase 4A)', () => {
  it('Scenario B: Nov 28, no income, rent $1,400 on Dec 1 → $450.25 (was $1,850.25)', () => {
    const i = input({ today: '2026-11-28', accounts: [account({ id: 'chk', openingBalanceCents: 185025, openingDate: '2026-11-01' })], recurring: [rent()] });
    const s = computeSafeToSpend(i);
    expect(s.cents).toBe(45025);
    expect(s.lowPoint.date).toBe('2026-12-01');
    expect(s.lowPoint.obligations.map((e) => [e.label, e.cashDeltaCents])).toEqual([['rent', -140000]]);
    expect(lowestAfterSpendingAll(i).low).toBe(0); // spending it all leaves exactly the (zero) reserve, never less
  });

  it('Scenario A (as restated): Nov 20, $1,000 paycheck already received, rent Dec 1, next pay Dec 4 → $450.25', () => {
    const chk = account({ id: 'chk', openingBalanceCents: 85025, openingDate: '2026-11-01' });
    const pay = biweeklyPay('2026-11-20', 100000);
    const received = tx({ accountId: 'chk', date: '2026-11-20', amountCents: 100000, kind: 'income', occurrenceRef: { recurringId: 'pay', originalDate: '2026-11-20' } });
    const i = input({ today: '2026-11-20', accounts: [chk], recurring: [pay, rent()], transactions: [received] });
    const s = computeSafeToSpend(i);
    expect(s.availableCashCents).toBe(185025);
    expect(s.cents).toBe(45025);
    expect(s.cents).toBeLessThanOrEqual(45025);
    expect(lowestAfterSpendingAll(i).low).toBeGreaterThanOrEqual(0);
  });

  it('Scenario A (as audited): Nov 13, dependable $1,000 paycheck Nov 20 arrives before rent Dec 1 → $1,450.25 (was $1,850.25)', () => {
    const i = input({ today: '2026-11-13', accounts: [account({ id: 'chk', openingBalanceCents: 185025, openingDate: '2026-11-01' })], recurring: [biweeklyPay('2026-11-20', 100000), rent()] });
    const s = computeSafeToSpend(i);
    expect(s.cents).toBe(145025); // 1,850.25 + 1,000.00 (fixed, arrives Nov 20) − 1,400.00 rent
    expect(s.lowPoint.date).toBe('2026-12-01');
    expect(s.lowPoint.incomeBefore.map((e) => e.cashDeltaCents)).toEqual([100000]);
    expect(lowestAfterSpendingAll(i).low).toBe(0);
  });

  it('a bill on the 1st of next month counts even with a paycheck earlier this month (the original root cause)', () => {
    const i = input({ today: '2026-11-13', accounts: [account({ id: 'chk', openingBalanceCents: 200000, openingDate: '2026-11-01' })], recurring: [biweeklyPay('2026-11-20', 50000), rent(140000)] });
    const s = computeSafeToSpend(i);
    expect(s.horizonEnd >= '2026-12-01').toBe(true);
    expect(s.cents).toBe(200000 + 50000 - 140000);
  });

  it('bills after month-end but before the next dependable paycheck are included', () => {
    // pay on the 5th each month: the first paycheck after Nov 30 is Dec 5; rent Dec 1, insurance Dec 3
    const pay = rec({ id: 'pay', kind: 'income', ...since('2026-12-05'), schedule: { freq: 'monthly', interval: 1, day: 5, anchor: '2026-12-05' }, amount: { type: 'fixed', cents: 300000 } });
    const ins = rec({ id: 'ins', kind: 'bill', ...since('2026-12-03'), schedule: { freq: 'once', date: '2026-12-03' }, amount: { type: 'fixed', cents: 20000 } });
    const i = input({ today: '2026-11-20', accounts: [account({ id: 'chk', openingBalanceCents: 200000, openingDate: '2026-11-01' })], recurring: [pay, rent(), ins] });
    const s = computeSafeToSpend(i);
    expect(s.cents).toBe(200000 - 140000 - 20000);
    expect(s.lowPoint.date).toBe('2026-12-03');
  });

  it('a small paycheck just before a large bill next month does not hide the shortfall', () => {
    const pay = rec({ id: 'pay', kind: 'income', ...since('2026-12-04'), schedule: { freq: 'monthly', interval: 1, day: 4, anchor: '2026-12-04' }, amount: { type: 'fixed', cents: 50000 } });
    const bill = rec({ id: 'car', kind: 'bill', ...since('2026-12-05'), schedule: { freq: 'once', date: '2026-12-05' }, amount: { type: 'fixed', cents: 140000 } });
    const i = input({ today: '2026-11-25', accounts: [account({ id: 'chk', openingBalanceCents: 200000, openingDate: '2026-11-01' })], recurring: [pay, bill] });
    expect(computeSafeToSpend(i).cents).toBe(200000 + 50000 - 140000);
    expect(lowestAfterSpendingAll(i).low).toBe(0);
  });

  it('the horizon is the end of next month, or the first dependable paycheck after month-end if that is later', () => {
    const chk = account({ id: 'chk', openingBalanceCents: 100000, openingDate: '2026-11-01' });
    expect(computeSafeToSpend(input({ today: '2026-11-13', accounts: [chk] })).horizonEnd).toBe('2026-12-31');
    expect(computeSafeToSpend(input({ today: '2026-11-13', accounts: [chk] })).horizonReason).toBe('next_month_end');
    // a quarterly paycheck on Jan 15 is later than Dec 31: the horizon runs to it
    const q = rec({ id: 'q', kind: 'income', ...since('2027-01-15'), schedule: { freq: 'monthly', interval: 3, day: 15, anchor: '2027-01-15' }, amount: { type: 'fixed', cents: 500000 } });
    const s = computeSafeToSpend(input({ today: '2026-11-13', accounts: [chk], recurring: [q] }));
    expect([s.horizonEnd, s.horizonReason]).toEqual(['2027-01-15', 'next_income']);
  });

  it('irregular and estimated income is never assumed', () => {
    const chk = account({ id: 'chk', openingBalanceCents: 185025, openingDate: '2026-11-01' });
    const gig = rec({ id: 'gig', kind: 'income', ...since('2026-11-25'), schedule: { freq: 'once', date: '2026-11-25' }, amount: { type: 'variable', cents: 300000 } });
    const unknown = rec({ id: 'tips', kind: 'income', ...since('2026-11-26'), schedule: { freq: 'once', date: '2026-11-26' }, amount: { type: 'unknown' } });
    const s = computeSafeToSpend(input({ today: '2026-11-20', accounts: [chk], recurring: [gig, unknown, rent()] }));
    expect(s.cents).toBe(45025);
    expect(s.excludedIncome.map((e) => e.label).sort()).toEqual(['gig', 'tips']);
  });

  it('transfers are neither income nor spending: to savings lowers spendable cash, between spendable accounts changes nothing', () => {
    const chk = account({ id: 'chk', openingBalanceCents: 300000, openingDate: '2026-11-01' });
    const cash = account({ id: 'cash', type: 'cash', openingBalanceCents: 0, openingDate: '2026-11-01' });
    const sav = account({ id: 'sav', type: 'savings', openingBalanceCents: 0, openingDate: '2026-11-01' });
    const toSavings = rec({ id: 'save', kind: 'savings', toAccountId: 'sav', ...since('2026-12-02'), schedule: { freq: 'once', date: '2026-12-02' }, amount: { type: 'fixed', cents: 50000 } });
    const toCash = rec({ id: 'atm', kind: 'transfer', toAccountId: 'cash', ...since('2026-12-03'), schedule: { freq: 'once', date: '2026-12-03' }, amount: { type: 'fixed', cents: 20000 } });
    const i = input({ today: '2026-11-20', accounts: [chk, cash, sav], recurring: [rent(), toSavings, toCash], transactions: transfer('chk', 'cash', '2026-11-05', 1000) });
    const s = computeSafeToSpend(i);
    expect(s.availableCashCents).toBe(300000); // the earlier checking → cash transfer moved money within spendable cash
    expect(s.cents).toBe(300000 - 140000 - 50000); // savings transfer counts as money leaving spendable cash; ATM move doesn't
    const d = buildDashboard(i);
    expect(d.safeToSpend.cents).toBe(s.cents);
  });

  it('credit cards: purchases are not cash until the scheduled card payment, which is counted once', () => {
    const chk = account({ id: 'chk', openingBalanceCents: 300000, openingDate: '2026-11-01' });
    const card = account({ id: 'card', type: 'credit_card', openingBalanceCents: 0, openingDate: '2026-11-01' });
    const purchases = [tx({ accountId: 'card', date: '2026-11-10', amountCents: -30000, kind: 'expense' }), tx({ accountId: 'card', date: '2026-11-12', amountCents: -10000, kind: 'expense' })];
    const payCard = rec({ id: 'cardpay', kind: 'transfer', toAccountId: 'card', ...since('2026-12-02'), schedule: { freq: 'once', date: '2026-12-02' }, amount: { type: 'card_full_balance' } });
    const i = input({ today: '2026-11-20', accounts: [chk, card], recurring: [payCard], transactions: purchases });
    const s = computeSafeToSpend(i);
    expect(s.availableCashCents).toBe(300000); // card purchases didn't touch cash
    expect(s.cents).toBe(300000 - 40000); // the full-balance payment on Dec 2 (after month-end) is counted, once
    expect(s.lowPoint.obligations.map((e) => e.cashDeltaCents)).toEqual([-40000]);
  });

  it('estimated bills after month-end are counted and stay marked as estimates', () => {
    const chk = account({ id: 'chk', openingBalanceCents: 100000, openingDate: '2026-11-01' });
    const power = rec({ id: 'power', name: 'Electricity', kind: 'bill', ...since('2026-12-02'), schedule: { freq: 'once', date: '2026-12-02' }, amount: { type: 'variable', cents: 9000 } });
    const s = computeSafeToSpend(input({ today: '2026-11-20', accounts: [chk], recurring: [power] }));
    expect(s.cents).toBe(91000);
    expect(s.lowPoint.obligations[0]!.estimated).toBe(true);
    expect(s.explanation.lines.find((l) => l.label === 'Electricity')!.note).toMatch(/estimate/i);
  });

  it('respects the reserve and spendable-account rules', () => {
    const chk = account({ id: 'chk', openingBalanceCents: 185025, openingDate: '2026-11-01' });
    const sav = account({ id: 'sav', type: 'savings', openingBalanceCents: 900000, openingDate: '2026-11-01' });
    const i = input({ today: '2026-11-28', accounts: [chk, sav], recurring: [rent()], minReserveCents: 20000 });
    const { s, low } = lowestAfterSpendingAll(i);
    expect(s.cents).toBe(185025 - 140000 - 20000); // savings is not spendable; the reserve is kept
    expect(low).toBe(20000);
  });

  it('"Why this number?" names the obligation and the horizon', () => {
    const i = input({ today: '2026-11-28', accounts: [account({ id: 'chk', openingBalanceCents: 185025, openingDate: '2026-11-01' })], recurring: [rec({ ...rent(), name: 'Rent' })] });
    const ex = computeSafeToSpend(i).explanation;
    expect(ex.summary).toContain('through the end of next month (Dec 31)');
    expect(ex.summary).toContain('lowest on Dec 1');
    expect(ex.lines.map((l) => [l.label, l.cents])).toEqual(expect.arrayContaining([['Rent', -140000], ['Safe to Spend', 45025]]));
    expect(ex.assumptions.join(' ')).toMatch(/after Dec 31.*not included/);
  });
});

describe('Upcoming shows what Safe to Spend counts (Phase 4A, audit finding H1)', () => {
  // The onboarding case from the audit: $1,850.25, paycheck $2,100 every 2 weeks from Nov 20, rent $1,400 from Dec 1.
  const i = input({
    today: '2026-11-13',
    accounts: [account({ id: 'chk', openingBalanceCents: 185025, openingDate: '2026-11-13' })],
    recurring: [biweeklyPay('2026-11-20', 210000), rec({ ...rent(), name: 'Rent' })],
  });
  const d = buildDashboard(i);

  it('the rent entered during onboarding is listed (after the Upcoming window, before the horizon)', () => {
    expect(d.upcomingUntil).toBe('2026-11-30');
    expect(d.upcoming.map((u) => u.label)).toEqual(['pay']);
    expect(d.upcomingLaterUntil).toBe(d.safeToSpend.horizonEnd);
    expect(d.upcomingLater.map((u) => [u.date, u.label, u.cents])).toEqual([
      ['2026-12-01', 'Rent', -140000],
      ['2026-12-04', 'pay', 210000],
      ['2026-12-18', 'pay', 210000],
    ]);
  });

  it('every cash item Safe to Spend counts is listed in Upcoming or Later', () => {
    const counted = buildForecast({ today: i.today, horizonEnd: d.safeToSpend.horizonEnd, accounts: i.accounts, transactions: i.transactions, recurring: i.recurring, exceptions: i.exceptions, baseCurrency: 'USD', includeEstimatedIncome: false })
      .days.flatMap((x) => x.events).filter((e) => e.cashDeltaCents !== 0).map((e) => e.id);
    const listed = new Set([...d.upcoming, ...d.upcomingLater].map((u) => u.id));
    expect(counted.every((id) => listed.has(id))).toBe(true);
  });

  it('the month chart still covers the Upcoming window, not the longer horizon', () => {
    expect(d.forecast.days.at(-1)!.date).toBe(d.upcomingUntil);
  });
});

