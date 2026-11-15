import type { ISODate, Transaction, WorkspaceData } from '@clarity/shared';
import { buildDashboard, type Dashboard, type Explanation } from '@clarity/engine';
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
  /**
   * Phase 4B.2: which supporting figures Home shows (both apps). A figure is hidden only when it is the very same
   * amount on the very same date as one already shown more prominently (the recorded balance, or another low point):
   * - stsLow: Safe to Spend's lowest point (through its horizon), unless it is today's recorded balance or the very
   *   amount Safe to Spend shows (no reserve: Safe to Spend IS the low, and its caption gives the date);
   * - monthLow: the lowest balance this month, unless it is that same point (or today's recorded balance);
   * - lowBeforeIncome: the lowest before next income, unless it is one of those points (false when there is none);
   * - endOfDay: the end-of-today figure, unless nothing else is scheduled today (`quietToday`: it equals the balance) or
 *   it is today's low point already shown (same amount, today).
   */
  show: { stsLow: boolean; monthLow: boolean; lowBeforeIncome: boolean; endOfDay: boolean };
  /**
   * Phase 4B.2: Safe to Spend's "Why this number?": the engine's explanation, with the card's former "after the low
   * point" sentence added to its summary (the card no longer shows it). Lines, amounts and assumptions unchanged.
   */
  stsExplanation: Explanation;
}

export const RECENT_COUNT = 6;

export function buildHomeView(data: WorkspaceData, today: ISODate): HomeView {
  const d = buildDashboard(engineInput(data, today));
  const s = d.safeToSpend;
  const lb = d.lowestBeforeNextIncome;
  const cash = d.balances.availableCashCents;
  const same = (a: { date: ISODate; cents: number }, b: { date: ISODate; cents: number }) => a.date === b.date && a.cents === b.cents;
  const isBalanceToday = (p: { date: ISODate; cents: number }) => same(p, { date: today, cents: cash });
  const month = d.lowestThroughMonthEnd;
  const quietToday = (d.forecast.days.find((x) => x.date === today)?.events.length ?? 0) === 0 && !d.upcoming.some((u) => u.status === 'overdue' && !u.isIncome);
  return {
    dashboard: d,
    monthEndDeltaCents: d.monthEnd.cents - d.balances.availableCashCents,
    stsIncomeBeforeCents: s.lowPoint.incomeBefore.reduce((a, e) => a + e.cashDeltaCents, 0),
    stsBillsBeforeCents: s.lowPoint.obligations.reduce((a, e) => a + e.cashDeltaCents, 0),
    sameLow: !!lb && lb.date === d.lowestThroughMonthEnd.date && lb.cents === d.lowestThroughMonthEnd.cents,
    quietToday,
    recent: data.transactions
      .filter((t) => t.date <= today && (t.kind !== 'transfer' || t.amountCents < 0))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt))
      .slice(0, RECENT_COUNT),
    show: {
      stsLow: !isBalanceToday(s.lowPoint) && s.lowPoint.cents !== s.cents,
      monthLow: !same(month, s.lowPoint) && !isBalanceToday(month),
      lowBeforeIncome: !!lb && !same(lb, month) && !same(lb, s.lowPoint) && !isBalanceToday(lb),
      endOfDay: !quietToday && !same({ date: today, cents: d.endOfDay.cents }, s.lowPoint) && !same({ date: today, cents: d.endOfDay.cents }, month),
    },
    stsExplanation: s.afterLow.note ? { ...s.explanation, summary: `${s.explanation.summary} ${s.afterLow.note}` } : s.explanation,
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

/** How many items of `Dashboard.upcomingLater` Home lists before "N more through <date>" (both apps). */
export const UPCOMING_LATER_PREVIEW = 4;

/** The later items Home shows, and how many more are counted in Safe to Spend through the horizon. */
export function upcomingLaterPreview(d: Dashboard): { shown: Dashboard['upcomingLater']; more: number; until: string } {
  return { shown: d.upcomingLater.slice(0, UPCOMING_LATER_PREVIEW), more: Math.max(0, d.upcomingLater.length - UPCOMING_LATER_PREVIEW), until: d.upcomingLaterUntil };
}

/**
 * Money going out that Safe to Spend counts (Upcoming + Later), for the first overview after onboarding,
 * so a bill entered during setup is visibly accounted for (Phase 4A). First `limit` items + how many more.
 */
export function countedOutflows(d: Dashboard, limit = 4): { items: Dashboard['upcoming']; more: number; until: string } {
  const all = [...d.upcoming, ...d.upcomingLater].filter((u) => u.cents < 0 && u.affectsCash);
  return { items: all.slice(0, limit), more: Math.max(0, all.length - limit), until: d.upcomingLaterUntil };
}
