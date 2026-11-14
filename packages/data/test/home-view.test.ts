import { describe, expect, it } from 'vitest';
import { formatCents as f, formatShortDate as s, formatWeekdayDate as w, INCOME_STATUS_LABEL, OCCURRENCE_STATUS_LABEL } from '@clarity/shared';
import { buildDashboard } from '@clarity/engine';
import { buildDemoWorkspace, buildHomeView, engineInput, recentRow, upcomingLaterPreview } from '../src';
import { HOME_SAMPLE as X, SAMPLE_NOW, SAMPLE_TODAY } from './fixtures/home-sample-nov13';

describe('shared Home view model', () => {
  const data = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const v = buildHomeView(data, SAMPLE_TODAY);
  const d = v.dashboard;

  it('is the engine dashboard, unchanged (no second calculation)', () => {
    expect(d).toEqual(buildDashboard(engineInput(data, SAMPLE_TODAY)));
    expect(v.monthEndDeltaCents).toBe(d.monthEnd.cents - d.balances.availableCashCents);
  });

  it('the cross-platform fixture matches the engine (both apps are tested against this fixture)', () => {
    expect(f(d.monthEnd.cents)).toBe(X.monthEnd);
    expect(`${f(Math.abs(v.monthEndDeltaCents))} ${v.monthEndDeltaCents >= 0 ? 'more' : 'less'} than you have today, by ${s(d.monthEnd.date)}.`).toBe(X.monthEndDelta);
    expect(f(d.safeToSpend.cents)).toBe(X.safeToSpend);
    expect(d.safeToSpend.afterLow.note).toBe(X.safeToSpendAfterLow);
    expect(f(d.balances.availableCashCents)).toBe(X.recordedBalance);
    expect([f(d.lowestThroughMonthEnd.cents), `${s(d.lowestThroughMonthEnd.date)} · through month-end`]).toEqual([X.lowest, X.lowestSub]);
    expect(v.sameLow).toBe(true);
    expect(f(d.lowestBeforeNextIncome!.cents)).toBe(X.lowestBeforeIncome);
    expect(`Same low point (${s(d.lowestBeforeNextIncome!.date)}), before your ${s(d.lowestBeforeNextIncome!.nextIncome.date)} income`).toBe(X.lowestBeforeIncomeSub);
    expect([f(d.endOfDay.cents), v.quietToday]).toEqual([X.endOfDay, true]);
    expect(s(d.upcomingUntil)).toBe(X.upcomingUntil);
    expect(d.upcoming.map((u) => [w(u.date), u.label, (u.isIncome ? INCOME_STATUS_LABEL : OCCURRENCE_STATUS_LABEL)[u.status], `${u.status === 'estimated' ? '≈' : ''}${f(u.cents, 'USD', { sign: 'always' })}`])).toEqual(X.upcoming);
    const later = upcomingLaterPreview(d);
    expect(later.shown.map((u) => [s(u.date), `${u.label}${u.affectsCash ? '' : ' · card'}`, `${u.status === 'estimated' ? '≈' : ''}${f(u.cents, 'USD', { sign: 'always' })}`])).toEqual(X.upcomingLater);
    expect(`${later.more} more through ${s(later.until)}.`).toBe(X.upcomingLaterMore);
    expect(later.shown[0]).toMatchObject({ label: 'Rent', date: '2026-12-01' }); // counted in Safe to Spend, and shown
    const cats = new Map(data.categories.map((c) => [c.id, c.name]));
    expect(v.recent.map((t) => { const r = recentRow(t, t.categoryId ? cats.get(t.categoryId) : undefined); return [s(t.date), r.title, r.meta, f(r.cents, 'USD', { sign: r.sign })]; })).toEqual(X.recent);
  });

  it('recorded vs planned: Upcoming items are not transactions, recent items are all recorded on or before today', () => {
    const ids = new Set(data.transactions.map((t) => t.id));
    expect(d.upcoming.some((u) => ids.has(u.id))).toBe(false);
    expect(v.recent.every((t) => t.date <= SAMPLE_TODAY)).toBe(true);
  });

  it('flags only true repeats: on a day with a bill due, end-of-today differs and is not marked quiet', () => {
    const v2 = buildHomeView(data, '2026-11-18');
    expect(v2.quietToday).toBe(false);
    expect(v2.dashboard.endOfDay.cents).not.toBe(v2.dashboard.balances.availableCashCents);
  });
});
