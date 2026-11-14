import { parseSignedAmountInput } from './money';
import { CARD_BALANCE_ERROR, SIGNED_BALANCE_ERROR } from './terms';
import type { Cents, CurrencyCode } from './types';

/** Phase 4A.5.8: how a card's balance is entered: an amount, plus whether the card is owed money or in credit. */
export type CardBalanceMode = 'owed' | 'credit';

/**
 * Parse a balance typed into onboarding, Add account or Update balance (web and mobile use this one function).
 * - Checking, savings, cash: signed. "-50" is overdrawn by $50; the sign is never dropped.
 * - Cards (`card` given): an unsigned amount plus Owed / In credit. Result = amount OWED, signed:
 *   positive = owed, negative = in credit. A typed minus sign is rejected with a message, never flipped.
 * Empty text counts as 0 only when `emptyIsZero`.
 */
export function parseBalanceEntry(text: string, currency: CurrencyCode, card?: CardBalanceMode, emptyIsZero = false): { ok: true; cents: Cents } | { ok: false; message: string } {
  const t = text.trim();
  if (t === '' && emptyIsZero) return { ok: true, cents: 0 };
  const v = parseSignedAmountInput(t, currency);
  if (card) {
    if (v === null || v < 0) return { ok: false, message: CARD_BALANCE_ERROR };
    return { ok: true, cents: card === 'credit' && v !== 0 ? -v : v };
  }
  if (v === null) return { ok: false, message: SIGNED_BALANCE_ERROR };
  return { ok: true, cents: v };
}

/** The form state for a stored card balance (negative cents = owed): mode + unsigned amount. */
export function cardModeOf(balanceCents: Cents): { mode: CardBalanceMode; amountCents: Cents } {
  return balanceCents > 0 ? { mode: 'credit', amountCents: balanceCents } : { mode: 'owed', amountCents: -balanceCents };
}
