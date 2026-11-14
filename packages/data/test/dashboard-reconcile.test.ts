import { describe, expect, it } from 'vitest';
import { addDays } from '@clarity/shared';
import { buildDashboard } from '@clarity/engine';
import { buildDemoWorkspace, engineInput } from '../src';

/**
 * Phase 2 regression: the dashboard's visible items must reconcile with its headline numbers.
 * Found on the Nov 13, 2026 sample dashboard: a $250 savings transfer on Nov 30 was counted in the
 * month-end projection ($4,077.17) but missing from "Upcoming" (which stopped at 14 days).
 */
describe('dashboard reconciliation (sample data)', () => {
  it('Nov 13, 2026: every event behind the month-end figure is listed, including the Nov 30 savings transfer', () => {
    const today = '2026-11-13';
    const d = buildDashboard(engineInput(buildDemoWorkspace(today, Date.UTC(2026, 10, 13)), today));
    expect(d.balances.availableCashCents).toBe(287123);
    expect(d.monthEnd.cents).toBe(407717);
    expect(d.upcoming.map((u) => [u.date, u.label, u.cents])).toEqual([
      ['2026-11-18', 'Electricity', -9140],
      ['2026-11-19', 'Paycheck', 186000],
      ['2026-11-22', 'Phone', -6500],
      ['2026-11-25', 'Card payment', -24766],
      ['2026-11-30', 'Savings', -25000],
    ]);
    expect(d.upcomingUntil).toBe('2026-11-30');
    // Safe to Spend (Phase 4A): the horizon runs to the end of next month, so the $1,450 rent on Dec 1 counts.
    // Low on Dec 1: 2,871.23 + 1,860.00 − (91.40 + 65.00 + 247.66 + 250.00 + 1,450.00) = 2,627.17; minus the 200.00 reserve.
    // (Before Phase 4A the horizon stopped at Nov 30 and reported 2,579.83, ignoring that rent.)
    const s = d.safeToSpend;
    expect([s.cents, s.lowPoint.cents, s.lowPoint.date, s.horizonEnd]).toEqual([242717, 262717, '2026-12-01', '2026-12-31']);
    expect(s.lowPoint.obligations.map((e) => [e.label, e.cashDeltaCents])).toEqual([['Electricity', -9140], ['Phone', -6500], ['Card payment', -24766], ['Savings', -25000], ['Rent', -145000]]);
    expect(s.afterLow.events.map((e) => e.label)).toEqual(['Paycheck', 'Paycheck', 'Electricity', 'Phone', 'Card payment', 'Savings', 'Paycheck']);
    expect([s.afterLow.inCents, s.afterLow.outCents]).toEqual([558000, 42189]);
    expect(s.afterLow.note).toBe("Electricity, Phone, Card payment and Savings ($421.89) come after Dec 1, once $5,580.00 has come in. Your balance stays at or above the Dec 1 low through Dec 31, so they don't lower Safe to Spend.");
  });

  it('on every day for 90 days: available cash + listed cash items through month-end = projected month-end', () => {
    for (let i = 0; i < 90; i++) {
      const today = addDays('2026-09-01', i);
      const d = buildDashboard(engineInput(buildDemoWorkspace(today, Date.UTC(2026, 8, 1)), today));
      const listed = d.upcoming.filter((u) => u.affectsCash && u.date >= today && u.date <= d.monthEnd.date && u.status !== 'overdue').reduce((a, u) => a + u.cents, 0);
      const overdue = d.upcoming.filter((u) => u.affectsCash && u.status === 'overdue' && u.cents < 0).reduce((a, u) => a + u.cents, 0);
      expect(d.balances.availableCashCents + listed + overdue, today).toBe(d.monthEnd.cents);
      expect(d.upcomingUntil >= d.monthEnd.date, today).toBe(true);
    }
  });
});
