import { describe, expect, it } from 'vitest';
import { buildDashboard, canIAfford, computeSafeToSpend, type EngineInput } from '../src';
import { account, input, rec, transfer, tx } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.5.4 — card credits (audit 4A.5.3 D1–D3). Only payments (money moved into a card from another account)
 * cover existing card debt ahead of their date. Refunds, cashback and other credits are not payments: they lower
 * the debt only from the day they arrive; pending ones only once they post (the recorded balance is unchanged).
 * Expected values are worked out by hand. Today Fri, Nov 13, 2026; horizon Dec 31 unless stated.
 */
const TODAY = '2026-11-13';
const since = (d: string) => ({ startDate: d, trackFrom: d });
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const move = (id: string, from: string, to: string, date: string, cents: number) => once(id, 'transfer', date, cents, { accountId: from, toAccountId: to, name: 'Visa payment' });
const fullPay = (card: string, date: string) =>
  rec({ id: `fp-${card}-${date}`, name: `${card} payment`, kind: 'transfer', accountId: 'chk', toAccountId: card, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'card_full_balance' } });
const pay = (date: string, cents: number) => once(`pay${date}`, 'income', date, cents, { name: 'Paycheck' });
const refund = (card: string, date: string, cents: number, extra: Record<string, unknown> = {}) =>
  tx({ accountId: card, date, amountCents: cents, kind: 'refund', merchant: 'Refund', id: `r-${card}-${date}-${cents}`, ...extra });
const buy = (card: string, date: string, cents: number) => once(`b-${card}-${date}`, 'bill', date, cents, { accountId: card, name: 'Purchase' });
const A = (id: string, name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', bal: number, extra: Record<string, unknown> = {}) =>
  account({ id, name, type, openingBalanceCents: bal, openingDate: '2026-11-01', ...extra });
const chk = (b: number) => A('chk', 'Checking', 'checking', b);
const visa = (owed: number, extra: Record<string, unknown> = {}) => A('visa', 'Visa', 'credit_card', -owed, extra);
const amex = (owed: number) => A('amex', 'Amex', 'credit_card', -owed);
const mk = (accounts: ReturnType<typeof A>[], recurring: RecurringItem[] = [], transactions: ReturnType<typeof tx>[] = []) => input({ today: TODAY, accounts, recurring, transactions });
const sts = (i: EngineInput) => computeSafeToSpend(i).cents;
const lines = (i: EngineInput) => computeSafeToSpend(i).explanation.lines;
const warns = (i: EngineInput) => buildDashboard(i).warnings;

describe('the Phase 4A.5.3 audit scenarios ($500 checking, Visa owes $400 unless stated)', () => {
  it('$200 future refund (Dec 10) → $100: owed now until it arrives (was $300)', () => expect(sts(mk([chk(50000), visa(40000)], [], [refund('visa', '2026-12-10', 20000)]))).toBe(10000));
  it('same plus a $1,000 paycheck Dec 4 → $100 (was $300)', () => expect(sts(mk([chk(50000), visa(40000)], [pay('2026-12-04', 100000)], [refund('visa', '2026-12-10', 20000)]))).toBe(10000));
  it('refund Dec 1, paycheck Dec 10 → $100 (was $300)', () => expect(sts(mk([chk(50000), visa(40000)], [pay('2026-12-10', 100000)], [refund('visa', '2026-12-01', 20000)]))).toBe(10000));
  it('$600 future refund against $400 → $100; the $200 credit is not spendable (was $500)', () => expect(sts(mk([chk(50000), visa(40000)], [], [refund('visa', '2026-12-10', 60000)]))).toBe(10000));
  it('$400 refund after the forecast ends (Jan 20) → $100 (was $500)', () => expect(sts(mk([chk(50000), visa(40000)], [pay('2026-12-04', 100000)], [refund('visa', '2027-01-20', 40000)]))).toBe(10000));
  it('two future $100 refunds → $100 (was $300)', () => expect(sts(mk([chk(50000), visa(40000)], [], [refund('visa', '2026-11-20', 10000), refund('visa', '2026-12-01', 10000)]))).toBe(10000));
  it('fixed $50 cashback on Nov 15 and Dec 15 → $100 (was $200); a variable (estimated) one is never counted', () => {
    const cb = (type: 'fixed' | 'variable') => rec({ id: 'cb', name: 'Cashback', kind: 'income', accountId: 'visa', ...since('2026-11-15'), schedule: { freq: 'monthly', interval: 1, day: 15, anchor: '2026-11-15' }, amount: { type, cents: 5000 } });
    expect(sts(mk([chk(50000), visa(40000)], [cb('fixed')]))).toBe(10000);
    expect(sts(mk([chk(50000), visa(40000)], [cb('variable')]))).toBe(10000);
  });
  it('Visa $400 with a $200 future refund, Amex $200, $1,000 checking → $400 (was $600)', () => {
    expect(sts(mk([chk(100000), visa(40000), amex(20000)], [], [refund('visa', '2026-12-10', 20000)]))).toBe(40000);
  });
  it('$300 purchase and $300 refund on the same future day (card at $0) → $200: money out before money in (was $500)', () => {
    expect(sts(mk([chk(50000), visa(0)], [buy('visa', '2026-12-05', 30000)], [refund('visa', '2026-12-05', 30000)]))).toBe(20000);
  });
  it('$200 purchase Dec 5 and $50 future refund Dec 10 → $300 (was $350)', () => {
    expect(sts(mk([chk(50000), visa(0)], [buy('visa', '2026-12-05', 20000)], [refund('visa', '2026-12-10', 5000)]))).toBe(30000);
  });
  it('$200 purchase and $50 refund both already posted → $350 (the recorded balance already owes $150)', () => {
    const i = mk([chk(50000), visa(0)], [], [tx({ accountId: 'visa', date: '2026-11-10', amountCents: -20000, merchant: 'Shoes', id: 'p' }), refund('visa', '2026-11-12', 5000)]);
    expect(sts(i)).toBe(35000);
  });
  it('$400 debt, $200 refund already posted, later $200 payment → $300 (not $100: the refunded $200 is not owed twice)', () => {
    // posted refund: the card owes 200; the Dec 20 payment covers it: 500 − 200 = 300
    const i = mk([chk(50000), visa(40000)], [move('p', 'chk', 'visa', '2026-12-20', 20000)], [refund('visa', '2026-11-12', 20000)]);
    expect(sts(i)).toBe(30000);
    // refund arriving Dec 10 instead: the uncovered $200 is owed now until then: 500 − 200 = 300
    expect(sts(mk([chk(50000), visa(40000)], [move('p', 'chk', 'visa', '2026-12-20', 20000)], [refund('visa', '2026-12-10', 20000)]))).toBe(30000);
  });
  it('$400 debt with a $200 refund still pending (recorded today), no payment → $100', () => {
    // recorded balance: −400 + 200 pending = −200 (unchanged); for card debt the pending $200 is not counted: 500 − 400
    const i = mk([chk(50000), visa(40000)], [], [refund('visa', TODAY, 20000, { status: 'pending' })]);
    expect(sts(i)).toBe(10000);
    expect(buildDashboard(i).balances.cardOwedCents).toBe(20000); // the recorded balance is not changed
    expect(warns(i).find((w) => w.id === 'card-unscheduled:visa')!.detail).toBe("No payment is scheduled, so Safe to Spend counts the $400.00 as owed now. That includes $200.00 of pending refunds or payments, which aren't counted until they post.");
  });
});

describe('payments still cover debt; credits only on their day', () => {
  it('refund before a full payment: refund Dec 10, full payment Dec 20 → $300 (unchanged)', () => {
    expect(sts(mk([chk(50000), visa(40000)], [fullPay('visa', '2026-12-20')], [refund('visa', '2026-12-10', 20000)]))).toBe(30000);
  });
  it('refund after a full payment (Nov 25): the credit is not spendable → $100 (unchanged)', () => {
    expect(sts(mk([chk(50000), visa(40000)], [fullPay('visa', '2026-11-25')], [refund('visa', '2026-12-10', 20000)]))).toBe(10000);
  });
  it('a pending refund and a full payment Dec 20: the payment pays the recorded $200; the pending $200 stays counted → $100', () => {
    // today: owed 400 (incl. pending), payment 200 covers 200 → 200 owed now: 300. Dec 20: 300, still 200 → 100.
    expect(sts(mk([chk(50000), visa(40000)], [fullPay('visa', '2026-12-20')], [refund('visa', TODAY, 20000, { status: 'pending' })]))).toBe(10000);
  });
  it('Phase 4A.5.14 (owner decision: each leg settles on its own; neutrality only once both legs posted): a card payment pending at both banks → −$100', () => {
    // The sending leg counts at once (checking 500 − 200 = 300); the card's receiving leg is a pending credit, so the card
    // still owes 400 until the card issuer posts the payment: 300 − 400 = −100. (Before 4A.5.14: counted once, $100.)
    const i = mk([chk(50000), visa(40000)], [], transfer('chk', 'visa', TODAY, 20000, { status: 'pending' }));
    expect(sts(i)).toBe(-10000);
  });
  it('Phase 4A.5.14: the same payment once the card has posted it (checking still pending) → $100, counted once', () => {
    const [out, inc] = transfer('chk', 'visa', TODAY, 20000, { status: 'pending' });
    const i = mk([chk(50000), visa(40000)], [], [out!, { ...inc!, status: 'confirmed' }]);
    expect(sts(i)).toBe(10000); // checking 300 (pending debit counted), card owes 200
  });
  it('a refund beyond the 62-day lookahead (Mar 10) changes nothing → $100', () => {
    expect(sts(mk([chk(50000), visa(40000)], [pay('2026-12-04', 100000)], [refund('visa', '2027-03-10', 40000)]))).toBe(10000);
  });
  it('one card\'s refund never lowers another card\'s debt: Amex refund + payment, Visa unpaid → $200', () => {
    // today: Visa 400 owed now; Amex 300 owed, its Nov 25 full payment will be 200 (after the Nov 20 refund) → 100 owed now:
    // 800 − 500 = 300. Nov 25: 800 − 200 = 600, Visa still 400 → 200. Lowest: 200.
    expect(sts(mk([chk(80000), visa(40000), amex(30000)], [fullPay('amex', '2026-11-25')], [refund('amex', '2026-11-20', 10000)]))).toBe(20000);
  });
  it('an archived card with a future refund: owed now until it arrives → $100', () => {
    expect(sts(mk([chk(50000), visa(40000, { archived: true })], [], [refund('visa', '2026-12-10', 20000)]))).toBe(10000);
  });
  it('same day: purchase $300, refund $300, a full-balance payment (amount $0 at the start of the day) and a paycheck → $200', () => {
    expect(sts(mk([chk(50000), visa(0)], [buy('visa', '2026-12-05', 30000), fullPay('visa', '2026-12-05'), pay('2026-12-05', 100000)], [refund('visa', '2026-12-05', 30000)]))).toBe(20000);
  });
  it('editing, cancelling or moving a planned refund never raises today: removed / $600 / Nov 14 → $100 each', () => {
    const base = [chk(50000), visa(40000)];
    expect(sts(mk(base))).toBe(10000);
    expect(sts(mk(base, [], [refund('visa', '2026-12-10', 60000)]))).toBe(10000);
    expect(sts(mk(base, [], [refund('visa', '2026-11-14', 20000)]))).toBe(10000);
  });
});

describe('explanations and affordability match the calculation', () => {
  it('a future refund is shown as a credit, never as a planned payment', () => {
    const l = lines(mk([chk(50000), visa(40000)], [], [refund('visa', '2026-12-10', 20000)]));
    expect(l.find((x) => x.label === 'Visa: owed now')).toMatchObject({ cents: -40000, note: 'no payment is scheduled for it, so it is counted as owed now' });
    expect(l.find((x) => x.label === 'Visa: $200.00 refund or credit expected Dec 10')!.note).toBe("not a payment; it lowers what's owed only from the day it arrives");
    expect(l.some((x) => /planned payment/.test(x.note ?? ''))).toBe(false);
  });
  it('a pending refund is named', () => {
    const l = lines(mk([chk(50000), visa(40000)], [], [refund('visa', TODAY, 20000, { status: 'pending' })]));
    expect(l.find((x) => x.label === 'Visa: $200.00 pending refund, deposit or incoming transfer')!.note).toBe("not counted until it posts; it is included in what's owed above");
  });
  it('a payment planned after the forecast ends is described as set aside on Dec 31', () => {
    const l = lines(mk([chk(50000), visa(40000)], [pay('2026-12-04', 100000), fullPay('visa', '2027-02-25')]));
    expect(l.find((x) => x.label === 'Visa: $400.00 owed')!.note).toBe('covered by the payment you planned for Feb 25 (a date you entered, not a statement due date); that is after the forecast ends, so it is set aside on Dec 31');
  });
  it('"Can I afford this?" uses the same rule: $250 with a $200 future refund is not affordable (was "Yes")', () => {
    const r = canIAfford(mk([chk(50000), visa(40000)], [], [refund('visa', '2026-12-10', 20000)]), { amountCents: 25000, accountId: 'chk', date: TODAY });
    expect(r.verdict).toBe('no');
  });
  it('every line of "Why this number?" adds up to the lowest point', () => {
    const s = computeSafeToSpend(mk([chk(50000), visa(40000), amex(20000)], [move('p', 'chk', 'visa', '2026-11-25', 10000)], [refund('visa', '2026-12-10', 20000)]));
    const counted = s.explanation.lines.filter((l) => (l.kind === 'start' || l.kind === 'in' || l.kind === 'out') && !(l.note ?? '').includes('after the lowest point'));
    expect(counted.reduce((a, l) => a + (l.cents ?? 0), 0)).toBe(s.lowPoint.cents);
  });
});
