import {
  addDays,
  addMonths,
  clampDay,
  diffDays,
  monthIndex,
  parseISO,
  toDayNumber,
  weekday,
  type ISODate,
  type Schedule,
  type WeekendRule,
} from '@clarity/shared';

/**
 * Raw schedule dates (before weekend rules and exceptions) within [from, to], inclusive.
 * Every rule is pure calendar arithmetic; see docs/calculation-rules.md §Recurrence.
 */
export function scheduleDates(schedule: Schedule, from: ISODate, to: ISODate): ISODate[] {
  if (from > to) return [];
  switch (schedule.freq) {
    case 'once':
      return schedule.date >= from && schedule.date <= to ? [schedule.date] : [];

    case 'every_n_days':
    case 'weekly': {
      const step = schedule.freq === 'weekly' ? schedule.interval * 7 : schedule.interval;
      if (!Number.isInteger(step) || step < 1) throw new Error('Schedule interval must be a positive integer');
      const offset = diffDays(from, schedule.anchor);
      // first k with anchor + k*step >= from
      const k0 = Math.ceil(offset / step);
      const out: ISODate[] = [];
      for (let k = k0; ; k++) {
        const d = addDays(schedule.anchor, k * step);
        if (d > to) break;
        if (d >= from) out.push(d);
      }
      return out;
    }

    case 'twice_monthly': {
      const out: ISODate[] = [];
      const start = parseISO(from);
      const end = monthIndex(to);
      for (let mi = monthIndex(from); mi <= end; mi++) {
        const { y, m } = addMonths(start.y, start.m, mi - monthIndex(from));
        const a = clampDay(y, m, schedule.day1);
        const b = clampDay(y, m, schedule.day2);
        for (const d of a === b ? [a] : a < b ? [a, b] : [b, a]) {
          if (d >= from && d <= to) out.push(d);
        }
      }
      return out;
    }

    case 'monthly': {
      const interval = schedule.interval;
      if (!Number.isInteger(interval) || interval < 1) throw new Error('Schedule interval must be a positive integer');
      const out: ISODate[] = [];
      const anchorIdx = monthIndex(schedule.anchor);
      const start = parseISO(from);
      const fromIdx = monthIndex(from);
      const toIdx = monthIndex(to);
      for (let mi = fromIdx; mi <= toIdx; mi++) {
        if ((((mi - anchorIdx) % interval) + interval) % interval !== 0) continue;
        const { y, m } = addMonths(start.y, start.m, mi - fromIdx);
        const d = clampDay(y, m, schedule.day);
        if (d >= from && d <= to) out.push(d);
      }
      return out;
    }
  }
}

/** Shift a date off a weekend if the rule asks for it. 'before' → Friday, 'after' → Monday. */
export function applyWeekendRule(date: ISODate, rule: WeekendRule): ISODate {
  if (rule === 'none') return date;
  const wd = weekday(date);
  if (wd === 6) return addDays(date, rule === 'before' ? -1 : 2);
  if (wd === 0) return addDays(date, rule === 'before' ? -2 : 1);
  return date;
}

/** Next raw schedule date on or after `from` (searches up to ~2 years ahead). */
export function nextScheduleDate(schedule: Schedule, from: ISODate): ISODate | null {
  const dates = scheduleDates(schedule, from, addDays(from, 800));
  return dates[0] ?? null;
}

/** Human description used by both apps, e.g. "Every 2 weeks", "Monthly on the 31st (or last day)". */
export function describeSchedule(schedule: Schedule): string {
  const ord = (d: number | 'last'): string => {
    if (d === 'last') return 'last day';
    const s = ['th', 'st', 'nd', 'rd'];
    const v = d % 100;
    return d + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
  };
  switch (schedule.freq) {
    case 'once':
      return 'One time';
    case 'every_n_days':
      return `Every ${schedule.interval} days`;
    case 'weekly':
      return schedule.interval === 1 ? 'Weekly' : schedule.interval === 2 ? 'Every 2 weeks' : `Every ${schedule.interval} weeks`;
    case 'twice_monthly':
      return `Twice a month (${ord(schedule.day1)} and ${ord(schedule.day2)})`;
    case 'monthly': {
      const when = schedule.day === 'last' ? 'the last day' : `the ${ord(schedule.day)}`;
      const clampNote = typeof schedule.day === 'number' && schedule.day > 28 ? ' (or last day)' : '';
      if (schedule.interval === 1) return `Monthly on ${when}${clampNote}`;
      if (schedule.interval === 3) return `Quarterly on ${when}${clampNote}`;
      if (schedule.interval === 12) return `Yearly on ${when}${clampNote}`;
      return `Every ${schedule.interval} months on ${when}${clampNote}`;
    }
  }
}

/** Approximate monthly-equivalent amount in cents (for "monthly recurring total"). Integer math. */
export function monthlyEquivalentCents(schedule: Schedule, cents: number): number {
  switch (schedule.freq) {
    case 'once':
      return 0;
    case 'every_n_days':
      return Math.round((cents * 36525) / (schedule.interval * 1200)); // 365.25/12 days per month
    case 'weekly':
      return Math.round((cents * 52) / (schedule.interval * 12));
    case 'twice_monthly':
      return cents * 2;
    case 'monthly':
      return Math.round(cents / schedule.interval);
  }
}

export const annualEquivalentCents = (schedule: Schedule, cents: number): number => {
  switch (schedule.freq) {
    case 'once':
      return 0;
    case 'every_n_days':
      return Math.round((cents * 36525) / (schedule.interval * 100));
    case 'weekly':
      return Math.round((cents * 52) / schedule.interval);
    case 'twice_monthly':
      return cents * 24;
    case 'monthly':
      return Math.round((cents * 12) / schedule.interval);
  }
};

export { toDayNumber };
