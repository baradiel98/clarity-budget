import type { Cents, CurrencyCode } from './types';

/**
 * Integer-cent money helpers. No floating point is used for any money value.
 * All functions throw on non-integer input so a float can never leak into totals.
 */

export function assertCents(value: number, label = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label} must be an integer number of cents`);
  }
  return value;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) total += assertCents(v);
  return assertCents(total, 'sum');
}

export const absCents = (c: Cents): Cents => (c < 0 ? -c : c);

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  CAD: '$',
  AUD: '$',
  MXN: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

/** Currencies without minor units. Phase 1 still stores "cents" = whole units for these. */
const ZERO_DECIMAL = new Set(['JPY', 'KRW']);

export function currencyDecimals(currency: CurrencyCode): number {
  return ZERO_DECIMAL.has(currency) ? 0 : 2;
}

export interface FormatOptions {
  /** 'auto': minus only when negative. 'always': + or −. 'never': magnitude only. */
  sign?: 'auto' | 'always' | 'never';
  /** Hide the minor units when they are zero (e.g. $1,200). */
  compact?: boolean;
}

/**
 * Deterministic formatter (does not depend on Intl, so identical on every platform).
 * Uses a true minus sign (U+2212) for negatives.
 */
export function formatCents(cents: Cents, currency: CurrencyCode = 'USD', opts: FormatOptions = {}): string {
  assertCents(cents);
  const sign = opts.sign ?? 'auto';
  const decimals = currencyDecimals(currency);
  const neg = cents < 0;
  const abs = absCents(cents);
  const base = 10 ** decimals;
  const whole = Math.floor(abs / base);
  const frac = abs % base;
  const wholeStr = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let body = wholeStr;
  if (decimals > 0 && !(opts.compact && frac === 0)) {
    body += '.' + String(frac).padStart(decimals, '0');
  }
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const value = symbol + body;
  if (sign === 'never') return value;
  if (neg) return '−' + value;
  if (sign === 'always' && cents > 0) return '+' + value;
  return value;
}

/**
 * Parse what a person types into an amount field: "12", "12.5", "1,234.56", "$7.00".
 * Returns a positive magnitude in cents, or null when the text is not a valid amount.
 * Never uses parseFloat.
 */
export function parseAmountInput(text: string, currency: CurrencyCode = 'USD'): Cents | null {
  const decimals = currencyDecimals(currency);
  const cleaned = text.trim().replace(/[\s$€£¥]/g, '').replace(/,/g, '');
  if (cleaned === '') return null;
  const re = decimals === 0 ? /^\d+$/ : /^(\d*)(?:\.(\d{0,2}))?$/;
  const m = re.exec(cleaned);
  if (!m) return null;
  if (decimals === 0) return assertCents(Number(cleaned));
  const wholePart = m[1] ?? '';
  const fracPart = m[2] ?? '';
  if (wholePart === '' && fracPart === '') return null;
  const whole = wholePart === '' ? 0 : Number(wholePart);
  const frac = Number(fracPart.padEnd(2, '0') || '0');
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

/** Cents → plain decimal string for inputs / CSV ("-12.30"). */
export function centsToDecimalString(cents: Cents, currency: CurrencyCode = 'USD'): string {
  assertCents(cents);
  const decimals = currencyDecimals(currency);
  const neg = cents < 0;
  const abs = absCents(cents);
  if (decimals === 0) return (neg ? '-' : '') + String(abs);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return (neg ? '-' : '') + s;
}

/** Integer percentage change, rounded half away from zero; null when base is 0. */
export function percentChange(from: Cents, to: Cents): number | null {
  if (from === 0) return null;
  const num = (to - from) * 100;
  const q = num / Math.abs(from);
  return q < 0 ? -Math.round(-q) : Math.round(q);
}
