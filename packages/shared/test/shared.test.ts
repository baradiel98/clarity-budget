import { describe, expect, it } from 'vitest';
import {
  addDays, clampDay, daysInMonth, diffDays, endOfMonth, formatCents, fromDayNumber, parseAmountInput,
  percentChange, sumCents, toDayNumber, weekday, centsToDecimalString,
} from '@clarity/shared';

describe('dates', () => {
  it('round-trips day numbers across centuries', () => {
    for (const d of ['1970-01-01', '2000-02-29', '2024-12-31', '2100-03-01', '1999-12-31']) {
      expect(fromDayNumber(toDayNumber(d))).toBe(d);
    }
    expect(toDayNumber('1970-01-01')).toBe(0);
  });
  it('handles leap years', () => {
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(diffDays('2026-03-01', '2026-02-01')).toBe(28);
  });
  it('clamps day-of-month and supports last day', () => {
    expect(clampDay(2027, 2, 31)).toBe('2027-02-28');
    expect(clampDay(2028, 2, 30)).toBe('2028-02-29');
    expect(clampDay(2026, 4, 'last')).toBe('2026-04-30');
    expect(endOfMonth('2026-11-13')).toBe('2026-11-30');
  });
  it('computes weekdays', () => {
    expect(weekday('1970-01-01')).toBe(4); // Thursday
    expect(weekday('2026-11-13')).toBe(5); // Friday
    expect(weekday('2026-11-15')).toBe(0); // Sunday
  });
});

describe('money', () => {
  it('formats deterministically', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-5)).toBe('−$0.05');
    expect(formatCents(100000, 'USD', { compact: true })).toBe('$1,000');
    expect(formatCents(2500, 'USD', { sign: 'always' })).toBe('+$25.00');
    expect(formatCents(0)).toBe('$0.00');
  });
  it('parses typed amounts without floats', () => {
    expect(parseAmountInput('12')).toBe(1200);
    expect(parseAmountInput('12.5')).toBe(1250);
    expect(parseAmountInput('0.07')).toBe(7);
    expect(parseAmountInput('1,234.56')).toBe(123456);
    expect(parseAmountInput('$19.99')).toBe(1999);
    expect(parseAmountInput('.5')).toBe(50);
    expect(parseAmountInput('12.345')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
    expect(parseAmountInput('')).toBeNull();
    // the classic float trap: 0.1 + 0.2
    expect(sumCents([parseAmountInput('0.1')!, parseAmountInput('0.2')!])).toBe(30);
  });
  it('rejects non-integer cents', () => {
    expect(() => sumCents([1.5])).toThrow();
    expect(() => formatCents(0.1)).toThrow();
  });
  it('converts to decimal strings and percentages', () => {
    expect(centsToDecimalString(-1230)).toBe('-12.30');
    expect(percentChange(10000, 11450)).toBe(15);
    expect(percentChange(0, 100)).toBeNull();
  });
});
