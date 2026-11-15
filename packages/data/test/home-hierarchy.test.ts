import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNobleProvider } from '@clarity/security/noble';
import { applyOps, buildDemoWorkspace, buildHomeView, createRecurring, MemoryAdapter, onboard, WorkspaceStore } from '../src';
import { Book } from './fixtures/settlement-harness';

/**
 * Phase 4B.2: which Home figures are shown. A figure is hidden only when it is the very same amount on the very same
 * date as one already shown (recorded balance, Safe to Spend's low, this month's low). Every amount is the engine's;
 * the expected values below are worked out by hand.
 */
const monthly = (day: number) => ({ freq: 'monthly', interval: 1, day, anchor: '2026-01-01' }) as never;

describe('Home figures shown (Phase 4B.2)', () => {
  it('three different low points are all shown, each with its own span', () => {
    // Checking $1,000 on Sun, Nov 15. Monthly: bill $300 on the 18th, paycheck $500 on the 20th, bill $900 on the 25th.
    // Nov 18: 700 (lowest before the Nov 20 income) · Nov 20: 1,200 · Nov 25: 300 (lowest this month)
    // Dec 18: 0 · Dec 20: 500 · Dec 25: −400 (lowest through Dec 31, Safe to Spend's low; nothing below it after)
    const b = new Book(); b.at('2026-11-15'); const c = b.acct('Checking', 'checking', 100000);
    for (const [name, kind, cents, day] of [['Water', 'bill', 30000, 18], ['Pay', 'income', 50000, 20], ['Rent', 'bill', 90000, 25]] as const) {
      b.data = applyOps(b.data, createRecurring(b.ctx(), { name, kind, accountId: c, categoryId: null, schedule: monthly(day), amount: { type: 'fixed', cents } }).ops);
    }
    const v = buildHomeView(b.data, b.today); const d = v.dashboard;
    expect([d.balances.availableCashCents, d.safeToSpend.horizonEnd]).toEqual([100000, '2026-12-31']);
    expect([d.lowestBeforeNextIncome!.date, d.lowestBeforeNextIncome!.cents]).toEqual(['2026-11-18', 70000]);
    expect([d.lowestThroughMonthEnd.date, d.lowestThroughMonthEnd.cents]).toEqual(['2026-11-25', 30000]);
    expect([d.safeToSpend.lowPoint.date, d.safeToSpend.lowPoint.cents, d.safeToSpend.cents]).toEqual(['2026-12-25', -40000, -40000]);
    // no reserve, so Safe to Spend IS its low (−$400 on Dec 25, the date its caption gives): not repeated on the card
    expect(v.show).toEqual({ stsLow: false, monthLow: true, lowBeforeIncome: true, endOfDay: false });
    // with a $100 reserve Safe to Spend is −$500 and the −$400 low adds information: shown
    b.data = { ...b.data, settings: { ...b.data.settings, minReserveCents: 10000 } };
    const w = buildHomeView(b.data, b.today);
    expect([w.dashboard.safeToSpend.cents, w.dashboard.safeToSpend.lowPoint.cents]).toEqual([-50000, -40000]);
    expect(w.show).toEqual({ stsLow: true, monthLow: true, lowBeforeIncome: true, endOfDay: false });
  });

  it('first run ($2,400, nothing scheduled today, lowest today): no figure repeats the balance', async () => {
    const NOW = Date.UTC(2026, 10, 15, 15);
    const { store } = await WorkspaceStore.create(new MemoryAdapter(), createNobleProvider((n) => new Uint8Array(randomBytes(n))), 'correct horse battery', { withRecoveryKey: false, now: NOW });
    await store.apply(onboard(store.ctx(NOW, '2026-11-15'), { checkingBalanceCents: 240000, pay: { schedule: { freq: 'weekly', interval: 2, anchor: '2026-11-22' }, amountCents: 180000 }, bill: { name: 'Rent', amountCents: 120000, date: '2026-12-01', monthly: true } }));
    const v = buildHomeView(store.data, '2026-11-15'); const d = v.dashboard;
    // every low point is today's $2,400 (before the Nov 22 paycheck), the recorded balance
    for (const p of [d.safeToSpend.lowPoint, d.lowestThroughMonthEnd, d.lowestBeforeNextIncome!]) expect([p.date, p.cents]).toEqual(['2026-11-15', 240000]);
    expect([d.balances.availableCashCents, d.endOfDay.cents, d.safeToSpend.cents, d.monthEnd.cents]).toEqual([240000, 240000, 240000, 420000]);
    expect(v.show).toEqual({ stsLow: false, monthLow: false, lowBeforeIncome: false, endOfDay: false });
  });

  it('a bill due today: end of today is shown only when it differs from a low already shown', () => {
    const data = buildDemoWorkspace('2026-11-13', Date.UTC(2026, 10, 13));
    // Nov 18 (Electricity $91.40 due): end of today $2,779.83 IS this month's low (Nov 18) → hidden
    const a = buildHomeView(data, '2026-11-18');
    expect([a.quietToday, a.dashboard.endOfDay.cents, a.dashboard.lowestThroughMonthEnd.date, a.dashboard.lowestThroughMonthEnd.cents]).toEqual([false, 277983, '2026-11-18', 277983]);
    expect(a.show.endOfDay).toBe(false);
    // Nov 19 (overdue Electricity, then the $1,860 paycheck): low $2,779.83, end of today $4,639.83 → shown
    const b = buildHomeView(data, '2026-11-19');
    expect([b.dashboard.endOfDay.cents, b.dashboard.lowestThroughMonthEnd.cents]).toEqual([463983, 277983]);
    expect(b.show.endOfDay).toBe(true);
  });

  it('overdue bills (Jan 10, 2027): Safe to Spend\'s low is today and is shown once (on its card)', () => {
    const v = buildHomeView(buildDemoWorkspace('2026-11-13', Date.UTC(2026, 10, 13)), '2027-01-10'); const d = v.dashboard;
    expect([d.safeToSpend.lowPoint.date, d.safeToSpend.lowPoint.cents, d.safeToSpend.shortfallCents]).toEqual(['2027-01-10', -133689, 153689]);
    expect([d.lowestThroughMonthEnd.cents, d.lowestBeforeNextIncome!.cents, d.endOfDay.cents]).toEqual([-133689, -133689, -133689]);
    expect(v.show).toEqual({ stsLow: true, monthLow: false, lowBeforeIncome: false, endOfDay: false });
  });
});
