import { describe, expect, it } from 'vitest';
import { applyWeekendRule, describeSchedule, expandOccurrences, monthlyEquivalentCents, scheduleDates } from '../src';
import { ex, rec, tx } from './builders';

describe('scheduleDates', () => {
  it('monthly on the 31st clamps to the last day of shorter months (incl. leap Feb)', () => {
    const s = { freq: 'monthly', interval: 1, day: 31, anchor: '2028-01-31' } as const;
    expect(scheduleDates(s, '2028-01-01', '2028-05-31')).toEqual([
      '2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31',
    ]);
    expect(scheduleDates(s, '2027-02-01', '2027-02-28')).toEqual(['2027-02-28']);
  });

  it('last-day anchor', () => {
    const s = { freq: 'monthly', interval: 1, day: 'last', anchor: '2026-01-31' } as const;
    expect(scheduleDates(s, '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('annual on Feb 29 falls back to Feb 28 in non-leap years', () => {
    const s = { freq: 'monthly', interval: 12, day: 29, anchor: '2028-02-29' } as const;
    expect(scheduleDates(s, '2027-01-01', '2029-12-31')).toEqual(['2027-02-28', '2028-02-29', '2029-02-28']);
  });

  it('quarterly follows the anchor month', () => {
    const s = { freq: 'monthly', interval: 3, day: 15, anchor: '2026-02-15' } as const;
    expect(scheduleDates(s, '2026-01-01', '2026-12-31')).toEqual(['2026-02-15', '2026-05-15', '2026-08-15', '2026-11-15']);
  });

  it('twice monthly on the 15th and last day', () => {
    const s = { freq: 'twice_monthly', day1: 15, day2: 'last' } as const;
    expect(scheduleDates(s, '2027-01-20', '2027-03-15')).toEqual(['2027-01-31', '2027-02-15', '2027-02-28', '2027-03-15']);
  });

  it('biweekly crosses months and years from its anchor', () => {
    const s = { freq: 'weekly', interval: 2, anchor: '2026-12-18' } as const;
    expect(scheduleDates(s, '2026-11-01', '2027-01-31')).toEqual([
      '2026-11-06', '2026-11-20', '2026-12-04', '2026-12-18', '2027-01-01', '2027-01-15', '2027-01-29',
    ]);
  });

  it('once', () => {
    expect(scheduleDates({ freq: 'once', date: '2026-10-02' }, '2026-10-01', '2026-10-31')).toEqual(['2026-10-02']);
    expect(scheduleDates({ freq: 'once', date: '2026-09-02' }, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('describes schedules', () => {
    expect(describeSchedule({ freq: 'weekly', interval: 2, anchor: '2026-01-02' })).toBe('Every 2 weeks');
    expect(describeSchedule({ freq: 'monthly', interval: 1, day: 31, anchor: '2026-01-31' })).toBe('Monthly on the 31st (or last day)');
    expect(describeSchedule({ freq: 'twice_monthly', day1: 1, day2: 15 })).toBe('Twice a month (1st and 15th)');
  });

  it('monthly equivalents are integers', () => {
    expect(monthlyEquivalentCents({ freq: 'weekly', interval: 2, anchor: '2026-01-02' }, 100000)).toBe(216667);
    expect(monthlyEquivalentCents({ freq: 'monthly', interval: 12, day: 1, anchor: '2026-01-01' }, 12000)).toBe(1000);
  });
});

describe('weekend rules', () => {
  it('moves only when configured', () => {
    expect(applyWeekendRule('2026-09-05', 'none')).toBe('2026-09-05'); // Saturday
    expect(applyWeekendRule('2026-09-05', 'before')).toBe('2026-09-04');
    expect(applyWeekendRule('2026-09-06', 'before')).toBe('2026-09-04');
    expect(applyWeekendRule('2026-09-05', 'after')).toBe('2026-09-07');
    expect(applyWeekendRule('2026-09-06', 'after')).toBe('2026-09-07');
    expect(applyWeekendRule('2026-09-07', 'after')).toBe('2026-09-07');
  });
});

describe('expandOccurrences', () => {
  const rent = rec({ id: 'rent', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 5, anchor: '2026-01-05' }, amount: { type: 'fixed', cents: 140000 } });
  const range = { from: '2026-09-01', to: '2026-11-30', today: '2026-09-03' };

  it('applies skip, move and override exceptions', () => {
    const occ = expandOccurrences(
      [rent],
      [
        ex({ recurringId: 'rent', originalDate: '2026-09-05', action: 'skip' }),
        ex({ recurringId: 'rent', originalDate: '2026-10-05', action: 'move', newDate: '2026-10-09' }),
        ex({ recurringId: 'rent', originalDate: '2026-11-05', action: 'override', amountCents: 150000 }),
      ],
      [],
      range,
    );
    expect(occ.map((o) => [o.date, o.status, o.amountCents])).toEqual([
      ['2026-09-05', 'skipped', 140000],
      ['2026-10-09', 'expected', 140000],
      ['2026-11-05', 'expected', 150000],
    ]);
  });

  it('pause stops occurrences from pausedFrom', () => {
    const occ = expandOccurrences([{ ...rent, paused: true, pausedFrom: '2026-10-01' }], [], [], range);
    expect(occ.map((o) => o.date)).toEqual(['2026-09-05']);
    expect(expandOccurrences([{ ...rent, paused: true }], [], [], range)).toEqual([]);
  });

  it('marks unrecorded past occurrences overdue, and matched ones confirmed', () => {
    const r = { ...rent, schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2026-01-01' } as const, trackFrom: '2026-08-15' };
    let occ = expandOccurrences([r], [], [], { from: '2026-08-01', to: '2026-09-30', today: '2026-09-03' });
    // Aug 1 is before trackFrom → not reported
    expect(occ.map((o) => [o.date, o.status])).toEqual([['2026-09-01', 'overdue']]);
    const paid = tx({ accountId: 'chk', date: '2026-09-02', amountCents: -140000, occurrenceRef: { recurringId: 'rent', originalDate: '2026-09-01' } });
    occ = expandOccurrences([r], [], [paid], { from: '2026-08-01', to: '2026-09-30', today: '2026-09-03' });
    expect(occ[0]).toMatchObject({ status: 'confirmed', matchedTxId: paid.id });
  });

  it('variable bills use the average of the last 3 actual amounts', () => {
    const power = rec({ id: 'power', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 20, anchor: '2026-01-20' }, amount: { type: 'variable', cents: 8000 } });
    let occ = expandOccurrences([power], [], [], range);
    expect(occ[0]).toMatchObject({ amountCents: 8000, amountBasis: 'user_estimate', status: 'estimated' });
    const hist = [
      tx({ accountId: 'chk', date: '2026-06-20', amountCents: -9000, occurrenceRef: { recurringId: 'power', originalDate: '2026-06-20' } }),
      tx({ accountId: 'chk', date: '2026-07-20', amountCents: -10000, occurrenceRef: { recurringId: 'power', originalDate: '2026-07-20' } }),
      tx({ accountId: 'chk', date: '2026-08-20', amountCents: -11001, occurrenceRef: { recurringId: 'power', originalDate: '2026-08-20' } }),
      tx({ accountId: 'chk', date: '2026-05-20', amountCents: -50000, occurrenceRef: { recurringId: 'power', originalDate: '2026-05-20' } }),
    ];
    occ = expandOccurrences([power], [], hist, range);
    // (9000 + 10000 + 11001) / 3 = 10000.33 → 10000
    expect(occ[0]).toMatchObject({ amountCents: 10000, amountBasis: 'history_average' });
  });

  it('weekend rule is applied before range filtering', () => {
    const r = { ...rent, weekendRule: 'before' as const };
    const occ = expandOccurrences([r], [], [], { from: '2026-09-04', to: '2026-09-04', today: '2026-09-01' });
    expect(occ.map((o) => [o.originalDate, o.date])).toEqual([['2026-09-05', '2026-09-04']]);
  });
});
