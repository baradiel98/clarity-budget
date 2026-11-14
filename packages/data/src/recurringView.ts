import type { Cents, RecurringItem, Transaction } from '@clarity/shared';
import { historyEstimate } from '@clarity/engine';

/**
 * How a recurring item's amount is shown in Planning (web and mobile).
 * For a variable bill there are two legitimate numbers:
 *  - `typicalCents`: what the user entered as the usual amount;
 *  - `forecastCents`: what the forecast actually uses — the engine's `historyEstimate` (average of the
 *    last 3 recorded payments) when there is history, otherwise the user's amount.
 * Nothing is calculated here; the forecast figure comes from the same engine function the forecast uses.
 */
export type RecurringAmountView =
  | { kind: 'fixed'; forecastCents: Cents }
  | { kind: 'estimate'; forecastCents: Cents; typicalCents: Cents; basis: 'history_average' | 'user_estimate' }
  | { kind: 'unknown' }
  | { kind: 'card_full_balance' };

export function recurringAmountView(item: RecurringItem, transactions: readonly Transaction[]): RecurringAmountView {
  const a = item.amount;
  switch (a.type) {
    case 'fixed':
      return { kind: 'fixed', forecastCents: a.cents };
    case 'variable': {
      const h = historyEstimate(item.id, transactions);
      return { kind: 'estimate', forecastCents: h ?? a.cents, typicalCents: a.cents, basis: h === null ? 'user_estimate' : 'history_average' };
    }
    case 'unknown':
      return { kind: 'unknown' };
    case 'card_full_balance':
      return { kind: 'card_full_balance' };
  }
}

/** One short line under an estimated item explaining where the forecast figure comes from. */
export function estimateNote(v: Extract<RecurringAmountView, { kind: 'estimate' }>, fmt: (c: Cents) => string): string {
  return v.basis === 'history_average'
    ? v.forecastCents === v.typicalCents
      ? 'Estimate: average of recent payments'
      : `Estimate: average of recent payments (your usual: ${fmt(v.typicalCents)})`
    : 'Estimate: your usual amount (no payments recorded yet)';
}
