import type { ISODate, Transaction, WorkspaceData } from '@clarity/shared';
import { buildDashboard, type Dashboard } from '@clarity/engine';
import { engineInput } from './selectors';

/**
 * Everything the Home screen shows, derived once for both apps (web and mobile). Every amount comes from the
 * engine's `Dashboard`; this only adds presentation facts (which figures repeat, which transactions are recent),
 * so the two apps cannot drift apart. No money is calculated here beyond summing engine events for display.
 */
export interface HomeView {
  dashboard: Dashboard;
  /** Projected month-end minus available cash now. */
  monthEndDeltaCents: number;
  /** Safe to Spend breakdown: income counted before the low point, and bills/transfers through it (signed). */
  stsIncomeBeforeCents: number;
  stsBillsBeforeCents: number;
  /** "Lowest before next income" is the very same point as "Lowest balance" (say so instead of repeating it). */
  sameLow: boolean;
  /** Nothing is scheduled today, so the end-of-today figure equals available cash. */
  quietToday: boolean;
  /** Most recent recorded transactions (transfers once, from the sending side), newest first. */
  recent: Transaction[];
}

export const RECENT_COUNT = 6;

export function buildHomeView(data: WorkspaceData, today: ISODate): HomeView {
  const d = buildDashboard(engineInput(data, today));
  const s = d.safeToSpend;
  const lb = d.lowestBeforeNextIncome;
  return {
    dashboard: d,
    monthEndDeltaCents: d.monthEnd.cents - d.balances.availableCashCents,
    stsIncomeBeforeCents: s.lowPoint.incomeBefore.reduce((a, e) => a + e.cashDeltaCents, 0),
    stsBillsBeforeCents: s.lowPoint.obligations.reduce((a, e) => a + e.cashDeltaCents, 0),
    sameLow: !!lb && lb.date === d.lowestThroughMonthEnd.date && lb.cents === d.lowestThroughMonthEnd.cents,
    quietToday: (d.forecast.days.find((x) => x.date === today)?.events.length ?? 0) === 0 && !d.upcoming.some((u) => u.status === 'overdue' && !u.isIncome),
    recent: data.transactions
      .filter((t) => t.date <= today && (t.kind !== 'transfer' || t.amountCents < 0))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
      .slice(0, RECENT_COUNT),
  };
}

/** How a recent transaction is titled and signed on Home (both apps). */
export function recentRow(t: Transaction, categoryName: string | undefined): { title: string; meta: string; cents: number; sign: 'always' | 'never'; inflow: boolean } {
  const transfer = t.kind === 'transfer';
  return {
    title: transfer ? 'Transfer' : t.merchant || (t.kind === 'income' ? 'Income' : '—'),
    meta: transfer ? 'Between accounts' : categoryName ?? 'Uncategorized',
    cents: transfer ? Math.abs(t.amountCents) : t.amountCents,
    sign: transfer ? 'never' : 'always',
    inflow: t.amountCents > 0 && !transfer,
  };
}
