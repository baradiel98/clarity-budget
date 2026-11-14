import { describe, expect, it } from 'vitest';
import { buildDashboard, buildForecast, canIAfford, computeSafeToSpend, type EngineInput } from '../src';
import { account, input, rec, tx } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.5.2 — Policy B (owner decision after audit 4A.5.1). Card debt that no payment the user scheduled covers
 * is owed now; a scheduled payment (or refund) sets when the debt it covers is counted. Payments pay the oldest debt
 * first. Expected values are worked out by hand. Today Fri, Nov 13, 2026; horizon Dec 31 unless stated.
 */
const TODAY = '2026-11-13';
const since = (d: string) => ({ startDate: d, trackFrom: d });
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const move = (id: string, from: string, to: string, date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  once(id, 'transfer', date, cents, { accountId: from, toAccountId: to, ...extra });
const fullPay = (card: string, date: string) =>
  rec({ id: `fp-${card}-${date}`, name: `${card} payment`, kind: 'transfer', accountId: 'chk', toAccountId: card, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'card_full_balance' } });
const pay = (date: string, cents: number) => once(`pay${date}`, 'income', date, cents, { name: 'Paycheck' });
const A = (id: string, name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', bal: number, extra: Record<string, unknown> = {}) =>
  account({ id, name, type, openingBalanceCents: bal, openingDate: '2026-11-01', ...extra });
const chk = (b: number) => A('chk', 'Checking', 'checking', b);
const visa = (owed: number, extra: Record<string, unknown> = {}) => A('visa', 'Visa', 'credit_card', -owed, extra);
const base = (recurring: RecurringItem[], accounts = [chk(50000), visa(40000)], today = TODAY) => input({ today, accounts, recurring });
const sts = (i: EngineInput) => computeSafeToSpend(i).cents;
const lines = (i: EngineInput) => computeSafeToSpend(i).explanation.lines;
const warns = (i: EngineInput) => buildDashboard(i).warnings;
const ends = (i: EngineInput) => buildForecast({ today: i.today, horizonEnd: computeSafeToSpend(i).horizonEnd, accounts: i.accounts, transactions: i.transactions, recurring: i.recurring, exceptions: i.exceptions, baseCurrency: 'USD', includeEstimatedIncome: false }).endBalances;

describe('Phase 4A.5.1 scenarios ($500 checking, Visa owes $400)', () => {
  it('1. payment Nov 25, paycheck $1,000 Dec 4 → $100 (Nov 25: 500 − 400)', () => {
    expect(sts(base([pay('2026-12-04', 100000), fullPay('visa', '2026-11-25')]))).toBe(10000);
  });
  it('1b. same without any payment → $100: the debt is owed now; the Dec 4 paycheck can\'t cover it (Phase 4A.5: $500)', () => {
    const i = base([pay('2026-12-04', 100000)]);
    expect(sts(i)).toBe(10000);
    expect(computeSafeToSpend(i).lowPoint.date).toBe(TODAY);
    expect(lines(i).find((l) => l.label === 'Visa: owed now')).toMatchObject({ cents: -40000, note: 'no payment is scheduled for it, so it is counted as owed now' });
    expect(canIAfford(i, { amountCents: 45000, accountId: 'chk', date: TODAY }).verdict).toBe('no'); // was "Yes, through Dec 31"
  });
  it('2. payment Dec 10, after the paycheck → $500, and "Why this number?" names the card, amount and planned date', () => {
    const i = base([pay('2026-12-04', 100000), fullPay('visa', '2026-12-10')]);
    // today 500 (debt covered by the Dec 10 payment); Dec 4: 1,500; Dec 10: 1,100 → lowest 500
    expect(sts(i)).toBe(50000);
    const l = lines(i).find((x) => x.label === 'Visa: $400.00 owed')!;
    expect(l.kind).toBe('info');
    expect(l.note).toBe('covered by the payment you planned for Dec 10 (a date you entered, not a statement due date); counted on that day');
  });
  it('3. no payment and no income → $100', () => expect(sts(base([]))).toBe(10000));
  it('4. payment scheduled before the forecast ends (Dec 20) → $500', () => {
    expect(sts(base([pay('2026-12-04', 100000), fullPay('visa', '2026-12-20')]))).toBe(50000);
  });
  it('5. payment scheduled after the forecast ends (Jan 15): boundary rule kept — set aside on Dec 31', () => {
    // with the paycheck: debt covered by Jan 15 → daily lows ≥ 500; end: 1,500 − 400 = 1,100 → 500
    expect(sts(base([pay('2026-12-04', 100000), fullPay('visa', '2027-01-15')]))).toBe(50000);
    // without income: end: 500 − 400 = 100
    const i = base([fullPay('visa', '2027-01-15')]);
    expect(sts(i)).toBe(10000);
    expect(lines(i).find((l) => l.label === 'Visa still owed on Dec 31')!.note).toBe('your planned payment on Jan 15 is after the forecast ends, so it is set aside here');
  });
  it('6. partial payment: $100 on Nov 25 covers $100; the other $300 is owed now → $100', () => {
    const i = base([pay('2026-12-04', 100000), move('p', 'chk', 'visa', '2026-11-25', 10000, { name: 'Visa payment' })]);
    // today: 500 − 300 = 200; Nov 25: 400 − 300 = 100 (Phase 4A.5: $400)
    expect(sts(i)).toBe(10000);
    const w = warns(i).find((x) => x.id === 'card-uncovered:visa')!;
    expect(w.title).toBe("Visa: $300.00 of $400.00 isn't covered by a scheduled payment");
    expect(w.detail).toBe('Safe to Spend counts the $300.00 as owed now. The payment you planned for Nov 25 covers the other $100.00 on that day.');
  });
  it('7. two cards: Visa $300 paid Nov 20, Amex $200 paid Dec 20; $400 checking; paycheck Dec 4 → $100', () => {
    const accts = [chk(40000), visa(30000), A('amex', 'Amex', 'credit_card', -20000)];
    expect(sts(base([pay('2026-12-04', 100000), fullPay('visa', '2026-11-20'), fullPay('amex', '2026-12-20')], accts))).toBe(10000); // Nov 20: 400 − 300
    // Amex without a payment: owed now → Nov 20: 400 − 300 − 200 = −100
    expect(sts(base([pay('2026-12-04', 100000), fullPay('visa', '2026-11-20')], accts))).toBe(-10000);
  });
  it('11. an archived card owing $400 with no payment → $100', () => expect(sts(base([], [chk(50000), visa(40000, { archived: true })]))).toBe(10000));
  it('12. a EUR card owing €400 is not converted: $500, named, and the affordability answer is qualified', () => {
    const i = input({ today: TODAY, accounts: [chk(50000), A('ec', 'Euro card', 'credit_card', -40000, { currency: 'EUR' })] });
    expect(sts(i)).toBe(50000);
    expect(warns(i).some((w) => w.id === 'card-unreliable:ec')).toBe(true);
    expect(canIAfford(i, { amountCents: 1000, accountId: 'chk', date: TODAY }).headline).toBe('Yes, through Dec 31 — not counting Euro card');
  });
  it('13. paycheck and full payment the same day (Dec 4), checking $100 → −$300 (payments before same-day income)', () => {
    expect(sts(base([pay('2026-12-04', 100000), fullPay('visa', '2026-12-04')], [chk(10000), visa(40000)]))).toBe(-30000);
  });
  it('14. the forecast end moving from Dec 31 to a Feb 1 paycheck no longer changes the result ($100 both days)', () => {
    const p = once('feb', 'income', '2027-02-01', 100000, { name: 'Paycheck' });
    const on = (today: string, extra: RecurringItem[] = []) => computeSafeToSpend(input({ today, accounts: [chk(50000), visa(40000)], recurring: [p, ...extra] }));
    expect([on('2026-11-30').cents, on('2026-12-01').cents]).toEqual([10000, 10000]); // Phase 4A.5: $100 → $500
    expect([on('2026-11-30').horizonEnd, on('2026-12-01').horizonEnd]).toEqual(['2026-12-31', '2027-02-01']);
    // with a payment planned for Jan 20: Nov 30 (after the forecast: set aside Dec 31) and Dec 1 (inside it) agree
    const jan = fullPay('visa', '2027-01-20');
    expect([on('2026-11-30', [jan]).cents, on('2026-12-01', [jan]).cents]).toEqual([10000, 10000]);
  });
});

describe('Purchases, cash advances and refunds on their dates', () => {
  // $500 checking, card owes $0, a fixed $400 payment on Dec 21, $400 of purchases on the date below
  const P = (date: string, cents = 40000) => base([move('p', 'chk', 'visa', '2026-12-21', 40000), once('buy', 'bill', date, cents, { accountId: 'visa', name: 'Purchases' })], [chk(50000), visa(0)]);
  it('purchases before (Dec 20), on (Dec 21) or after (Dec 22) the payment → $100 each (500 − 400)', () => {
    expect([sts(P('2026-12-20')), sts(P('2026-12-21')), sts(P('2026-12-22'))]).toEqual([10000, 10000, 10000]);
  });
  it('$490 of purchases after the payment: the payment can\'t pay them in advance; $90 owed from Dec 22 → $10', () => {
    expect(sts(P('2026-12-22', 49000))).toBe(1000);
    expect(ends(P('2026-12-22', 49000)).visa).toBe(-9000);
  });
  it('a $90 cash advance before (Nov 20) or after (Dec 22) a $400 payment (card owes $400) → $100, the same as with no advance', () => {
    const adv = (d: string) => base([move('p', 'chk', 'visa', '2026-12-21', 40000), move('adv', 'visa', 'chk', d, 9000, { name: 'Cash advance' })]);
    expect([sts(adv('2026-11-20')), sts(adv('2026-12-22')), sts(base([move('p', 'chk', 'visa', '2026-12-21', 40000)]))]).toEqual([10000, 10000, 10000]);
    expect(lines(adv('2026-11-20')).find((l) => l.label === 'Cash advance still owed')?.cents).toBe(-9000);
  });
  it('the 4A.4 audit case still holds: $1,000 advance, rent $1,200, full payment Dec 15 → −$900', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), visa(0)], recurring: [move('adv', 'visa', 'chk', '2026-11-20', 100000), once('rent', 'bill', '2026-12-01', 120000), fullPay('visa', '2026-12-15')] });
    expect(sts(i)).toBe(-90000);
  });
  it('a $50 refund on Dec 10 is not a payment: the $400 is owed now until it arrives → $100 (Phase 4A.5.4; was $150)', () => {
    const i = input({ today: TODAY, accounts: [chk(50000), visa(40000)], transactions: [tx({ accountId: 'visa', date: '2026-12-10', amountCents: 5000, kind: 'refund', merchant: 'Refund' })] });
    // audit 4A.5.3 D3: the refund lowers the debt only from Dec 10 (to 350): today 500 − 400 = 100
    expect(sts(i)).toBe(10000);
  });
  it('a card in credit creates no spendable money: owes $100, pays $300 → $200', () => {
    expect(sts(base([move('p', 'chk', 'visa', '2026-11-20', 30000)], [chk(50000), visa(10000)]))).toBe(20000);
  });
});

describe('No double counting, no artificial money', () => {
  it('a scheduled payment is counted once: with it $500 (payment Dec 10 after the paycheck), not $100', () => {
    const i = base([pay('2026-12-04', 100000), fullPay('visa', '2026-12-10')]);
    expect(sts(i)).toBe(50000);
    expect(ends(i)).toEqual({ chk: 110000, visa: 0 });
  });
  it('scheduling a payment never gives more than the cash flow allows: no income → $100 whether or not one is scheduled', () => {
    expect([sts(base([])), sts(base([fullPay('visa', '2026-11-25')])), sts(base([fullPay('visa', '2026-12-20')])), sts(base([fullPay('visa', '2027-01-15')]))]).toEqual([10000, 10000, 10000, 10000]);
  });
  it('a card purchase in "Can I afford this?" uses the same rule: owed now unless a scheduled payment covers it', () => {
    const none = base([], [chk(50000), visa(0)]);
    expect(canIAfford(none, { amountCents: 20000, accountId: 'visa', date: TODAY }).after.cents).toBe(30000); // 500 − 200 owed now
    const covered = base([fullPay('visa', '2026-12-21')], [chk(50000), visa(0)]);
    // the Dec 21 full payment covers it: today 500; Dec 21: 500 − 200 = 300 → 300
    expect(canIAfford(covered, { amountCents: 20000, accountId: 'visa', date: TODAY }).after.cents).toBe(30000);
  });
});
