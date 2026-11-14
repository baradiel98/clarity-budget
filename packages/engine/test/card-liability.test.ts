import { describe, expect, it } from 'vitest';
import { buildDashboard, buildForecast, canIAfford, computeSafeToSpend, type EngineInput } from '../src';
import { account, input, rec, tx } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.5 (owner decisions). Expected values are worked out by hand in the comments.
 * Today is Fri, Nov 13, 2026; with no paycheck after November the Safe to Spend horizon is Dec 31.
 *
 * Card liability: at the end of the forecast, what each base-currency card is projected to still owe (after every
 * purchase, cash advance, refund and payment on its date) is set aside from the spendable cash. Safe to Spend =
 * min(lowest daily own-money low, end-of-forecast cash − card debt still owed) − reserve.
 */
const TODAY = '2026-11-13';
const since = (d: string) => ({ startDate: d, trackFrom: d });
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const move = (id: string, from: string, to: string, date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  once(id, 'transfer', date, cents, { accountId: from, toAccountId: to, ...extra });
const fullPay = (date: string, from = 'chk', card = 'card') =>
  rec({ id: `fp${date}`, name: 'Card payment', kind: 'transfer', accountId: from, toAccountId: card, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'card_full_balance' } });
const A = (id: string, name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', bal: number, extra: Record<string, unknown> = {}) =>
  account({ id, name, type, openingBalanceCents: bal, openingDate: '2026-11-01', ...extra });
const chk = (b: number) => A('chk', 'Checking', 'checking', b);
const card = (owed: number, extra: Record<string, unknown> = {}) => A('card', 'Visa', 'credit_card', -owed, extra);
const sts = (i: EngineInput) => computeSafeToSpend(i).cents;
const ends = (i: EngineInput) => buildForecast({ today: i.today, horizonEnd: computeSafeToSpend(i).horizonEnd, accounts: i.accounts, transactions: i.transactions, recurring: i.recurring, exceptions: i.exceptions, baseCurrency: 'USD', includeEstimatedIncome: false }).endBalances;
const warns = (i: EngineInput) => buildDashboard(i).warnings;

describe('Card debt is set aside even when no payment is scheduled', () => {
  it('Checking $1,000; Visa owes $1,000; nothing scheduled → $0 (was $1,000)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), card(100000)] });
    expect(sts(i)).toBe(0);
    const s = computeSafeToSpend(i);
    expect(s.cardsOwedAtHorizon).toEqual([{ accountId: 'card', cents: 100000 }]);
    expect(s.lowPoint.date).toBe('2026-12-31');
    expect(s.explanation.lines.find((l) => l.label === 'Visa still owed on Dec 31')?.cents).toBe(-100000);
    expect(warns(i).find((w) => w.id === 'card-unscheduled:card')!.detail).toBe('No payment is scheduled. Safe to Spend sets aside what Visa is projected to still owe on Dec 31 ($1,000.00).');
  });

  it('a full-balance payment on Nov 25 is counted once: $0, not −$1,000', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), card(100000)], recurring: [fullPay('2026-11-25')] });
    // Nov 25: cash 1,000 − 1,000 = 0; the card owes 0 at the end
    expect(sts(i)).toBe(0);
    expect(ends(i)).toEqual({ chk: 0, card: 0 });
    expect(warns(i).some((w) => w.id.startsWith('card-'))).toBe(false);
  });

  it('a partial payment: owes $300, pays $100 → 1,000 − 100 − 200 still owed = $700', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), card(30000)], recurring: [move('p', 'chk', 'card', '2026-11-25', 10000)] });
    expect(sts(i)).toBe(70000);
  });

  it('paying it after the forecast or within it gives the same answer (owes $300 + $100 purchase Dec 10)', () => {
    const buy = once('buy', 'bill', '2026-12-10', 10000, { accountId: 'card', name: 'Shoes' });
    const later = input({ today: TODAY, accounts: [chk(100000), card(30000)], recurring: [buy, fullPay('2027-01-15')] });
    const within = input({ today: TODAY, accounts: [chk(100000), card(30000)], recurring: [buy, fullPay('2026-12-31')] });
    // later: cash 1,000, card owes 400 at the end → 600. within: Dec 31 pays 400 → cash 600, owes 0 → 600.
    expect([sts(later), sts(within)]).toEqual([60000, 60000]);
    expect(warns(later).some((w) => w.id.startsWith('card-projected'))).toBe(false); // a payment after Dec 31 is scheduled
  });

  it('purchases and a refund on their dates: $200 purchase Dec 5, $50 refund Dec 10 → 500 − 150 = $350', () => {
    const i = input({ today: TODAY, accounts: [chk(50000), card(0)], recurring: [once('buy', 'bill', '2026-12-05', 20000, { accountId: 'card', name: 'Jacket' })],
      transactions: [tx({ accountId: 'card', date: '2026-12-10', amountCents: 5000, kind: 'refund', merchant: 'Jacket refund' })] });
    expect(sts(i)).toBe(35000);
    expect(ends(i).card).toBe(-15000);
  });

  it('overpaying leaves a credit that is not spendable: owes $100, pays $300 → 500 − 300 = $200', () => {
    const i = input({ today: TODAY, accounts: [chk(50000), card(10000)], recurring: [move('p', 'chk', 'card', '2026-11-20', 30000)] });
    expect(sts(i)).toBe(20000);
    expect(ends(i).card).toBe(20000);
  });

  it('the daily low still governs when it is lower: rent $800 Dec 1, pay $500 Dec 15, card owes $300 → $200', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), card(30000)], recurring: [once('rent', 'bill', '2026-12-01', 80000), once('pay', 'income', '2026-12-15', 50000)] });
    // Dec 1 low: 1,000 − 800 = 200. End: 200 + 500 − 300 owed = 400. Lower: 200.
    expect(sts(i)).toBe(20000);
    expect(computeSafeToSpend(i).lowPoint.date).toBe('2026-12-01');
  });

  it('an archived card that still owes money is set aside too', () => {
    expect(sts(input({ today: TODAY, accounts: [chk(100000), card(40000, { archived: true })] }))).toBe(60000);
  });
});

describe('Cash advance + card payment + purchases on, before and after the payment date', () => {
  // Checking $500, $90 advance Nov 20, $400 payment Dec 21, $400 purchases. The answer is $100 in every case.
  const S = (purchaseDate: string) => input({ today: TODAY, accounts: [chk(50000), card(0)], recurring: [
    move('adv', 'card', 'chk', '2026-11-20', 9000, { name: 'Cash advance' }), move('pay', 'chk', 'card', '2026-12-21', 40000, { name: 'Card payment' }),
    once('buy', 'bill', purchaseDate, 40000, { accountId: 'card', name: 'Card purchases' })] });
  for (const d of ['2026-12-20', '2026-12-21', '2026-12-22']) {
    it(`purchases on ${d}: cash 500 + 90 − 400 = 190; the card owes 90 at the end → $100`, () => {
      expect(sts(S(d))).toBe(10000);
      expect(ends(S(d))).toEqual({ chk: 19000, card: -9000 });
    });
  }
  it('without the advance: 500 − 400 = $100 (the advance never raises Safe to Spend)', () => {
    const i = input({ today: TODAY, accounts: [chk(50000), card(0)], recurring: [move('pay', 'chk', 'card', '2026-12-21', 40000), once('buy', 'bill', '2026-12-22', 40000, { accountId: 'card' })] });
    expect(sts(i)).toBe(10000);
  });
  it('the audit case: $1,000 advance, rent $1,200, no payment → −$900 (advance and card debt not counted twice)', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), card(0)], recurring: [move('adv', 'card', 'chk', '2026-11-20', 100000), once('rent', 'bill', '2026-12-01', 120000)] });
    expect(sts(i)).toBe(-90000);
  });
});

describe('A card balance that cannot be calculated is named, and "Can I afford this?" is qualified', () => {
  it('a EUR card that owes money: excluded, warned about, and the affordability answer says so', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('ec', 'Euro card', 'credit_card', -30000, { currency: 'EUR' })] });
    expect(sts(i)).toBe(100000); // never converted, so not subtracted
    expect(warns(i).find((w) => w.id === 'card-unreliable:ec')!.title).toBe("Euro card's balance isn't included in Safe to Spend");
    const r = canIAfford(i, { amountCents: 1000, accountId: 'chk', date: TODAY });
    expect(r.headline).toBe('Yes, through Dec 31 — not counting Euro card');
    expect(r.notes.join(' ')).toContain("Euro card (it's in EUR, and Clarity doesn't convert currencies)");
  });
  it('a card with a scheduled refund of unknown amount is named', () => {
    const refund = rec({ id: 'r', name: 'Refund', kind: 'income', accountId: 'card', ...since('2026-11-20'), schedule: { freq: 'once', date: '2026-11-20' }, amount: { type: 'unknown' } });
    const i = input({ today: TODAY, accounts: [chk(100000), card(10000)], recurring: [refund] });
    expect(warns(i).find((w) => w.id === 'card-unreliable:card')!.detail).toContain('something scheduled on it has no amount');
  });
  it('a purchase on a card with no payment scheduled is counted as card debt', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), card(0)] });
    const r = canIAfford(i, { amountCents: 20000, accountId: 'card', date: TODAY });
    expect([r.verdict, r.after.cents]).toEqual(['yes', 80000]); // 1,000 − 200 owed
    expect(r.notes).toContain("Charged to your card. No full-balance payment is scheduled, so it's counted as card debt still owed on Dec 31.");
  });
});

describe('Archived accounts: transfers out count only up to what they hold (owner decision, unchanged rule)', () => {
  const old = (b: number) => A('old', 'Old checking', 'checking', b, { archived: true });
  it('archived $300 → Checking $500: $300 arrives, $200 is flagged and not counted; nothing generally spendable', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), old(30000)], recurring: [move('m', 'old', 'chk', '2026-11-20', 50000, { name: 'Close out' })] });
    expect(sts(i)).toBe(100000); // today's 1,000 is the low; the $300 arrives later
    expect(ends(i)).toEqual({ chk: 130000, old: 0 });
    expect(warns(i).find((w) => w.id.startsWith('unfunded:'))!.title).toBe('Close out: only $300.00 of $500.00 is available');
  });
  it('a positive archived balance with nothing scheduled is not spendable', () => {
    expect(sts(input({ today: TODAY, accounts: [chk(100000), old(50000)] }))).toBe(100000);
  });
  it('transfers into non-spendable accounts (archived, savings) lower Safe to Spend and never raise it', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), old(0), A('sav', 'Savings', 'savings', 0)], recurring: [move('a', 'chk', 'old', '2026-11-20', 20000), move('b', 'chk', 'sav', '2026-11-21', 10000)] });
    expect(sts(i)).toBe(70000); // 1,000 − 200 − 100
    expect(ends(i)).toEqual({ chk: 70000, old: 20000, sav: 10000 });
  });
  it('money moved out and back is counted once: archived $300 → Checking (Nov 20), Checking → archived $300 (Nov 25)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), old(30000)], recurring: [move('a', 'old', 'chk', '2026-11-20', 30000), move('b', 'chk', 'old', '2026-11-25', 30000)] });
    // today 1,000; Nov 20: 1,300; Nov 25 low: 1,300 − 300 = 1,000 → 1,000
    expect(sts(i)).toBe(100000);
    expect(ends(i)).toEqual({ chk: 100000, old: 30000 });
  });
  it('archived → savings moves nothing into spendable cash', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), old(30000), A('sav', 'Savings', 'savings', 0)], recurring: [move('a', 'old', 'sav', '2026-11-20', 30000)] });
    expect(sts(i)).toBe(100000);
    expect(ends(i)).toEqual({ chk: 100000, old: 0, sav: 30000 });
  });
});
