import { describe, expect, it } from 'vitest';
import { accountBalance, buildDashboard, buildForecast, canIAfford, computeSafeToSpend, type EngineInput, type Forecast } from '../src';
import { account, input, rec, transfer, tx } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.4: regression tests for every defect confirmed by the Phase 4A.3 audit (F1–F8), using the audit's
 * exact examples. Expected values are worked out by hand in the comments, not taken from the engine.
 * Today is Fri, Nov 13, 2026; with no paycheck after November the Safe to Spend horizon is Dec 31.
 *
 * Same-day order (docs/calculation-rules.md): morning = moves out of spendable accounts, then bills/payments;
 * afternoon = income and cash advances; evening = transfers out of savings (capped at what savings holds by then).
 * The combined low point = start of day + the day's money going out (before anything comes in).
 */
const TODAY = '2026-11-13';
const since = (d: string) => ({ startDate: d, trackFrom: d });
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const move = (id: string, from: string, to: string, date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  once(id, 'transfer', date, cents, { accountId: from, toAccountId: to, ...extra });
const fullBalance = (id: string, from: string, card: string, date: string) =>
  rec({ id, name: 'Card payment', kind: 'transfer', accountId: from, toAccountId: card, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'card_full_balance' } });
const pay = (id: string, acct: string, date: string, cents: number) => once(id, 'income', date, cents, { accountId: acct, name: 'Paycheck' });
const A = (id: string, name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', bal: number) =>
  account({ id, name, type, openingBalanceCents: bal, openingDate: '2026-11-01' });
const chk = (b: number) => A('chk', 'Checking', 'checking', b);
const sav = (b: number) => A('sav', 'Savings', 'savings', b);
const cash = (b: number) => A('cash', 'Cash', 'cash', b);
const card = (b = 0) => A('card', 'Visa', 'credit_card', b);

const forecastOf = (i: EngineInput): Forecast =>
  buildForecast({ today: i.today, horizonEnd: computeSafeToSpend(i).horizonEnd, accounts: i.accounts, transactions: i.transactions, recurring: i.recurring, exceptions: i.exceptions, baseCurrency: 'USD', includeEstimatedIncome: false });
const end = (i: EngineInput) => forecastOf(i).endBalances;
const titles = (i: EngineInput) => buildDashboard(i).warnings.map((w) => w.title);
const warning = (i: EngineInput, prefix: string) => buildDashboard(i).warnings.find((w) => w.id.startsWith(prefix));

/**
 * Reconciliation, checked for every scenario:
 *  - total across ALL accounts = today's total + every non-transfer amount + money that had to be moved in
 *    from the spendable accounts for a payment savings couldn't cover (transfers move money, never create it);
 *  - the combined spendable cash at the end of the forecast = the spendable accounts' own end balances − that
 *    same covered money (the forecast counts it against them, without guessing which account it comes from).
 */
function reconcile(i: EngineInput) {
  const f = forecastOf(i);
  const startTotal = i.accounts.reduce((s, a) => s + accountBalance(a, i.transactions, i.today), 0);
  const nonTransfer = f.days.flatMap((d) => d.events).filter((e) => e.legs.length !== 2).reduce((s, e) => s + e.legs.reduce((a, l) => a + l.deltaCents, 0), 0);
  const covered = f.coveredPayments.reduce((s, c) => s + c.coveredCents, 0);
  const endTotal = Object.values(f.endBalances).reduce((s, b) => s + b, 0);
  expect(endTotal).toBe(startTotal + nonTransfer + covered);
  const spendableEnd = f.cashAccountIds.reduce((s, id) => s + (f.endBalances[id] ?? 0), 0);
  expect(f.days.at(-1)!.endCashCents).toBe(spendableEnd - covered);
  for (const id of i.accounts.filter((a) => a.type === 'savings').map((a) => a.id)) {
    // a non-spendable account never pays out money it doesn't have
    const opening = accountBalance(i.accounts.find((a) => a.id === id)!, i.transactions, i.today);
    if (opening >= 0) expect(f.endBalances[id]).toBeGreaterThanOrEqual(0);
  }
}

describe('F1: a bill paid from savings (a non-spendable account) is not dropped from Safe to Spend', () => {
  const tuition = (cents = 50000, date = '2026-11-20') => once('tuition', 'bill', date, cents, { accountId: 'sav', name: 'Tuition' });

  it('audit example: Checking $1,000, Savings $0, tuition $500 from Savings on Nov 20 → $500 (was $1,000)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(0)], recurring: [tuition()] });
    // Savings pays 0 of 500; the 500 has to come from Checking: 1,000 − 500 = 500.
    expect(computeSafeToSpend(i).cents).toBe(50000);
    expect(end(i)).toEqual({ chk: 100000, sav: 0 }); // no money is moved for the user; the 500 is counted against the pool
    const f = forecastOf(i);
    expect(f.coveredPayments.map((c) => [c.date, c.accountId, c.requestedCents, c.fundedCents, c.coveredCents, c.accountBalanceCents])).toEqual([['2026-11-20', 'sav', 50000, 0, 50000, 0]]);
    expect(f.days.find((d) => d.date === '2026-11-20')!.lowCashCents).toBe(50000);
    const w = warning(i, 'covered:')!;
    expect(w.title).toBe("Tuition: Savings can't cover it");
    expect(w.detail).toBe("Due Nov 20 from Savings, which is projected to have $0.00 then. Safe to Spend counts the other $500.00 against your spendable accounts. Move $500.00 into Savings before Nov 20, or change the account it's paid from.");
    expect(i.recurring).toHaveLength(1); // nothing is scheduled automatically
    reconcile(i);
  });

  it('following the advice (move $500 Checking → Savings on Nov 19) gives the same $500, not $0: nothing is counted twice', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(0)], recurring: [tuition(), move('fix', 'chk', 'sav', '2026-11-19', 50000)] });
    // the move takes 500 out of the pool on Nov 19; Savings then pays the tuition itself: 1,000 − 500 = 500
    expect(computeSafeToSpend(i).cents).toBe(50000);
    expect(forecastOf(i).coveredPayments).toEqual([]);
    expect(end(i)).toEqual({ chk: 50000, sav: 0 });
    expect(warning(i, 'covered:')).toBeUndefined();
    reconcile(i);
  });

  it('a move into Savings on the same day as the bill also funds it (morning moves settle before payments)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(0)], recurring: [tuition(), move('fix', 'chk', 'sav', '2026-11-20', 50000)] });
    expect(computeSafeToSpend(i).cents).toBe(50000);
    expect(forecastOf(i).coveredPayments).toEqual([]);
    reconcile(i);
  });

  it('fully funded: Savings $800 pays the $500 itself; Safe to Spend is not reduced', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(80000)], recurring: [tuition()] });
    expect(computeSafeToSpend(i).cents).toBe(100000);
    expect(end(i)).toEqual({ chk: 100000, sav: 30000 }); // 800 − 500
    expect(buildDashboard(i).warnings).toEqual([]);
    reconcile(i);
  });

  it('partly funded: Savings $200 → $300 is counted against the spendable accounts', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(20000)], recurring: [tuition()] });
    expect(computeSafeToSpend(i).cents).toBe(100000 - 30000); // 700
    expect(end(i)).toEqual({ chk: 100000, sav: 0 });
    expect(warning(i, 'covered:')!.title).toBe('Tuition: Savings can cover only $200.00 of $500.00');
    reconcile(i);
  });

  it('several bills: Savings $600 pays a $400 bill, then only $200 of the next $400', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(60000)], recurring: [tuition(40000), once('books', 'bill', '2026-12-01', 40000, { accountId: 'sav', name: 'Books' })] });
    // Nov 20: 600 − 400 = 200 left. Dec 1: 200 of 400 from savings, 200 from the pool → 1,000 − 200 = 800
    expect(computeSafeToSpend(i).cents).toBe(80000);
    expect(forecastOf(i).coveredPayments.map((c) => [c.date, c.fundedCents, c.coveredCents])).toEqual([['2026-12-01', 20000, 20000]]);
    reconcile(i);
  });

  it('a move that is too small: $200 moved on Nov 19 + $300 still to cover = $500 in total, not $700', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(0)], recurring: [tuition(), move('fix', 'chk', 'sav', '2026-11-19', 20000)] });
    expect(computeSafeToSpend(i).cents).toBe(100000 - 20000 - 30000); // 500
    expect(warning(i, 'covered:')!.title).toBe('Tuition: Savings can cover only $200.00 of $500.00');
    reconcile(i);
  });

  it('a card payment from Savings that Savings cannot make is an obligation too', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), sav(0), card(-40000)], recurring: [move('cardpay', 'sav', 'card', '2026-11-25', 40000, { name: 'Visa payment' })] });
    // the $400 owed on the card still has to be paid: 1,000 − 400 = 600; the card ends at 0
    expect(computeSafeToSpend(i).cents).toBe(60000);
    expect(end(i)).toEqual({ chk: 100000, sav: 0, card: 0 });
    expect(warning(i, 'covered:')!.title).toBe("Visa payment: Savings can't cover it");
    reconcile(i);
  });
});

describe('F2: a cash advance is borrowed money; it never raises Safe to Spend', () => {
  // Audit example: Checking $300, card at $0, $1,000 advance Nov 20, rent $1,200 Dec 1.
  const base = (extra: RecurringItem[] = [], cardBal = 0) =>
    input({ today: TODAY, accounts: [chk(30000), card(cardBal)], recurring: [move('adv', 'card', 'chk', '2026-11-20', 100000, { name: 'Cash advance' }), once('rent', 'bill', '2026-12-01', 120000, { name: 'Rent' }), ...extra] });

  it('no card payment scheduled: short by $900 (was +$100); the debt is disclosed', () => {
    const i = base();
    // own money: 300 − 1,200 = −900. Real Checking: 300 + 1,000 − 1,200 = 100; card owes 1,000.
    expect(computeSafeToSpend(i).cents).toBe(-90000);
    expect(end(i)).toEqual({ chk: 10000, card: -100000 });
    const w = warning(i, 'advance:')!;
    expect(w.title).toBe('Cash advance: $1,000.00 borrowed from Visa');
    expect(w.detail).toContain('Through Dec 31, $1,000.00 of planned cash advances is not paid back.');
    expect(w.detail).toContain('Interest, fees and your card limit are not known');
    const s = computeSafeToSpend(i);
    expect(s.explanation.lines.find((l) => l.label === 'Cash advance still owed')?.cents).toBe(-100000);
    expect(s.explanation.assumptions.join(' ')).toContain("isn't counted as yours until a scheduled card payment pays it back");
    expect(s.dependableIncome).toBe(false); // borrowing is not income
    reconcile(i);
  });

  it('full-balance payment Dec 15: still −$900, not −$1,900 (the repayment is not counted twice)', () => {
    const i = base([fullBalance('pay', 'chk', 'card', '2026-12-15')]);
    // Dec 1: real 100, owed 1,000 → −900. Dec 15: pays 1,000 → real −900, owed 0 → −900.
    expect(computeSafeToSpend(i).cents).toBe(-90000);
    expect(end(i)).toEqual({ chk: -90000, card: 0 });
    expect(warning(i, 'advance:')!.detail).not.toContain('not paid back');
    reconcile(i);
  });

  it('full-balance payment Jan 15 (after the forecast): −$900, and the payment is named as next', () => {
    const i = base([fullBalance('pay', 'chk', 'card', '2027-01-15')]);
    const s = computeSafeToSpend(i);
    expect(s.cents).toBe(-90000);
    expect(s.nextAfterNote).toBe('Next after Dec 31: Card payment ≈$1,000.00 on Jan 15 — not included.');
    reconcile(i);
  });

  it('fixed $50 payment Dec 15: −$900; $950 is still owed', () => {
    const i = base([move('min', 'chk', 'card', '2026-12-15', 5000)]);
    // Dec 15: real 100 − 50 = 50, owed 950 → −900
    expect(computeSafeToSpend(i).cents).toBe(-90000);
    expect(warning(i, 'advance:')!.detail).toContain('$950.00 of planned cash advances is not paid back');
    reconcile(i);
  });

  it('partial $600 payment Dec 10 and full payment before the rent (Nov 25): −$900 either way', () => {
    // Dec 10: real 100 − 600 = −500, owed 400 → −900
    expect(computeSafeToSpend(base([move('part', 'chk', 'card', '2026-12-10', 60000)])).cents).toBe(-90000);
    // Nov 25: real 1,300 − 1,000 = 300, owed 0; Dec 1: 300 − 1,200 = −900
    const early = base([fullBalance('pay', 'chk', 'card', '2026-11-25')]);
    expect(computeSafeToSpend(early).cents).toBe(-90000);
    reconcile(early);
  });

  it('card already owes $500 in purchases: a $500 payment pays the purchases first; the advance is still owed', () => {
    const i = base([move('p', 'chk', 'card', '2026-12-10', 50000)], -50000);
    // own money: 300 − 1,200 − 500 = −1,400 (the 1,000 borrowed is still owed: card owes 1,000 after the payment)
    expect(computeSafeToSpend(i).cents).toBe(-140000);
    reconcile(i);
  });

  it('"Can I afford this?" is not inflated by the advance', () => {
    const r = canIAfford(base(), { amountCents: 5000, accountId: 'chk', date: TODAY });
    expect(r.verdict).toBe('no');
    expect(r.after.cents).toBe(-95000);
  });
});

describe('F3: "Can I afford this?" checks what it claims', () => {
  // Audit example: Checking $2,000, Savings $0, Cash $100, rent $1,400 monthly from Dec 1. Before: 2,100 − 1,400 = 700.
  const rent = rec({ id: 'rent', name: 'Rent', kind: 'bill', ...since('2026-12-01'), schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2026-12-01' }, amount: { type: 'fixed', cents: 140000 } });
  const i = input({ today: TODAY, accounts: [chk(200000), sav(0), cash(10000)], recurring: [rent] });

  it('baseline Safe to Spend is $700', () => expect(computeSafeToSpend(i).cents).toBe(70000));

  it('$5,000 on Feb 1 (after the forecast ends Dec 31): not checked, so never "Yes"', () => {
    const r = canIAfford(i, { amountCents: 500000, accountId: 'chk', date: '2027-02-01' });
    expect(r.verdict).toBe('unverified');
    expect(r.headline).toBe("Can't check Feb 1 yet: the forecast ends Dec 31");
    expect(r.headline).not.toMatch(/yes/i);
    expect(r.scope).toContain("a purchase on Feb 1 can't be checked yet");
  });

  it('$400 from Savings ($0): $400 has to come from the spendable accounts → $300 left, and it says so', () => {
    const r = canIAfford(i, { amountCents: 40000, accountId: 'sav', date: TODAY });
    expect(r.after.cents).toBe(70000 - 40000); // was "Yes" with $700 left
    expect(r.verdict).toBe('move_first');
    expect(r.headline).toBe('Only if you move $400.00 into Savings by Nov 13');
    expect(r.requiredMove).toEqual({ accountId: 'sav', cents: 40000, by: TODAY });
    expect(r.notes.join(' ')).toContain('$400.00 of this would have to come from your spendable accounts');
  });

  it('$400 from Cash ($100): the total covers it, but Cash would be −$300, so not "Yes"', () => {
    const r = canIAfford(i, { amountCents: 40000, accountId: 'cash', date: TODAY });
    expect(r.after.cents).toBe(70000 - 40000); // 300
    expect(r.verdict).toBe('move_first');
    expect(r.headline).toBe('Only if you move $300.00 into Cash by Nov 13');
    expect(r.notes.join(' ')).toContain('Cash would go to −$300.00 on Nov 13');
  });

  it('$400 from Checking: Yes, through Dec 31 (unchanged behaviour)', () => {
    const r = canIAfford(i, { amountCents: 40000, accountId: 'chk', date: TODAY });
    expect([r.verdict, r.headline, r.requiredMove]).toEqual(['yes', 'Yes, through Dec 31', null]);
  });

  it('$800 from Checking: not without coming up short (700 − 800 = −100)', () => {
    const r = canIAfford(i, { amountCents: 80000, accountId: 'chk', date: TODAY });
    expect([r.verdict, r.shortfallCents]).toEqual(['no', 10000]);
  });

  it('a bill with no amount is named instead of guessed', () => {
    const water = rec({ id: 'water', name: 'Water', kind: 'bill', ...since('2026-11-25'), schedule: { freq: 'once', date: '2026-11-25' }, amount: { type: 'unknown' } });
    const r = canIAfford({ ...i, recurring: [rent, water] }, { amountCents: 1000, accountId: 'chk', date: TODAY });
    expect(r.notes).toContain('Not counted because no amount is entered: Water. Add the amount for a complete answer.');
  });
});

describe('F4: every account-level shortfall is recorded, not just the first', () => {
  it('audit example: Cash $300 pays $200 (Nov 18), $300 (Nov 20), $400 (Dec 5) → −$200 then −$600; move $600', () => {
    const i = input({ today: TODAY, accounts: [chk(200000), cash(30000)], recurring: [once('b1', 'bill', '2026-11-18', 20000, { accountId: 'cash' }), once('b2', 'bill', '2026-11-20', 30000, { accountId: 'cash' }), once('b3', 'bill', '2026-12-05', 40000, { accountId: 'cash' })] });
    // Cash: 300 − 200 = 100; − 300 = −200 (Nov 20); − 400 = −600 (Dec 5). Combined: 2,300 − 900 = 1,400.
    expect(forecastOf(i).accountShortfalls.map((s) => [s.date, s.lowCents])).toEqual([['2026-11-20', -20000], ['2026-12-05', -60000]]);
    expect(computeSafeToSpend(i).cents).toBe(140000);
    const w = warning(i, 'account-short:cash')!;
    expect(w.title).toBe('Cash would go to −$200.00 on Nov 20');
    expect(w.detail).toContain('Later: −$600.00 on Dec 5 (b3)');
    expect(w.detail).toContain('Move $600.00 into Cash before Nov 20 to cover all of these');
    reconcile(i);
    // moving the full $600 on Nov 19 clears every one of them
    const fixed = { ...i, recurring: [...i.recurring, move('top', 'chk', 'cash', '2026-11-19', 60000)] };
    expect(forecastOf(fixed).accountShortfalls).toEqual([]);
    expect(warning(fixed, 'account-short:')).toBeUndefined();
  });

  it('audit example: an early shortfall on a combined-negative day no longer hides a later one', () => {
    const i = input({ today: TODAY, accounts: [chk(0), cash(30000)], recurring: [once('b1', 'bill', '2026-11-20', 40000, { accountId: 'cash' }), pay('pay', 'chk', '2026-11-21', 200000), once('b2', 'bill', '2026-12-05', 50000, { accountId: 'cash' })] });
    // Nov 20: Cash −100 (combined −100). Dec 5: Cash −600 while Checking holds 2,000.
    expect(forecastOf(i).accountShortfalls.map((s) => [s.date, s.lowCents])).toEqual([['2026-11-20', -10000], ['2026-12-05', -60000]]);
    expect(computeSafeToSpend(i).cents).toBe(-10000);
    const t = titles(i);
    expect(t).toContain('Short by $100.00');
    expect(t).toContain('Cash would go to −$100.00 on Nov 20'); // was missing
    expect(warning(i, 'account-short:cash')!.detail).toContain('Move $600.00 into Cash before Nov 20');
    reconcile(i);
  });

  it('several accounts are checked independently', () => {
    const wallet = A('wal', 'Wallet', 'cash', 5000);
    const i = input({ today: TODAY, accounts: [chk(100000), cash(10000), wallet], recurring: [once('x', 'bill', '2026-11-20', 30000, { accountId: 'cash' }), once('y', 'bill', '2026-11-22', 10000, { accountId: 'wal' })] });
    expect(forecastOf(i).accountShortfalls.map((s) => [s.accountId, s.date, s.lowCents])).toEqual([['cash', '2026-11-20', -20000], ['wal', '2026-11-22', -5000]]);
    expect(titles(i)).toEqual(expect.arrayContaining(['Cash would go to −$200.00 on Nov 20', 'Wallet would go to −$50.00 on Nov 22']));
    reconcile(i);
  });
});

describe('F5/F6: same-day transfers and incoming money', () => {
  const r2 = (extra: RecurringItem[] = []) => input({ today: TODAY, accounts: [chk(50000), cash(30000)], recurring: [once('bill', 'bill', '2026-11-20', 60000, { accountId: 'cash' }), ...extra] });

  it('audit example: a $300 Checking → Cash move on the bill day funds the $600 bill (warning was left in place)', () => {
    const i = r2([move('top', 'chk', 'cash', '2026-11-20', 30000)]);
    // Cash: 300 + 300 − 600 = 0; Checking 500 − 300 = 200; combined 200
    expect(forecastOf(i).accountShortfalls).toEqual([]);
    expect(end(i)).toEqual({ chk: 20000, cash: 0 });
    expect(computeSafeToSpend(i).cents).toBe(20000);
    expect(warning(i, 'account-short:')).toBeUndefined();
    reconcile(i);
  });

  it('same day but too small ($200) → Cash −$100; one day late (Nov 21) → still −$300 on Nov 20', () => {
    expect(forecastOf(r2([move('top', 'chk', 'cash', '2026-11-20', 20000)])).accountShortfalls.map((s) => s.lowCents)).toEqual([-10000]);
    expect(forecastOf(r2([move('top', 'chk', 'cash', '2026-11-21', 30000)])).accountShortfalls.map((s) => [s.date, s.lowCents])).toEqual([['2026-11-20', -30000]]);
  });

  it('audit example: a $1,000 paycheck into Savings funds the same-day $1,000 sweep to Checking (was short by $800)', () => {
    const i = input({ today: TODAY, accounts: [chk(0), sav(0)], recurring: [pay('pay', 'sav', '2026-11-20', 100000), move('sweep', 'sav', 'chk', '2026-11-20', 100000), once('rent', 'bill', '2026-12-01', 80000)] });
    // Checking: 0 → +1,000 (Nov 20) → 200 after rent. Lowest: 0 today. Safe to Spend 0 (was −800).
    expect(computeSafeToSpend(i).cents).toBe(0);
    expect(forecastOf(i).unfundedTransfers).toEqual([]);
    expect(end(i)).toEqual({ chk: 20000, sav: 0 });
    reconcile(i);
  });

  it('…but money from savings still arrives after the day\'s bills (conservative: a bill that day is not paid with it)', () => {
    const i = input({ today: TODAY, accounts: [chk(0), sav(100000)], recurring: [move('sweep', 'sav', 'chk', '2026-11-20', 100000), once('gas', 'bill', '2026-11-20', 30000)] });
    // Nov 20 low: 0 − 300 = −300 before the 1,000 arrives (unchanged rule)
    expect(computeSafeToSpend(i).cents).toBe(-30000);
    reconcile(i);
  });

  it('same-day chain Savings A → Savings B → Checking passes the money along', () => {
    const b = A('savb', 'Savings B', 'savings', 0);
    const i = input({ today: TODAY, accounts: [chk(0), sav(50000), b], recurring: [move('ab', 'sav', 'savb', '2026-11-20', 50000), move('bc', 'savb', 'chk', '2026-11-20', 50000)] });
    expect(forecastOf(i).unfundedTransfers).toEqual([]);
    expect(end(i)).toEqual({ chk: 50000, sav: 0, savb: 0 });
    reconcile(i);
  });

  it('audit example: same-day round trip Checking → Savings → Checking: no false warning, nothing created', () => {
    const i = input({ today: TODAY, accounts: [chk(50000), sav(0)], recurring: [move('in', 'chk', 'sav', '2026-11-20', 50000), move('out', 'sav', 'chk', '2026-11-20', 50000)] });
    expect(forecastOf(i).unfundedTransfers).toEqual([]); // was "Savings won't have the money"
    expect(end(i)).toEqual({ chk: 50000, sav: 0 });
    expect(buildDashboard(i).warnings).toEqual([]);
    reconcile(i);
  });

  it('a same-day cycle between two empty savings accounts cannot create money', () => {
    const b = A('savb', 'Savings B', 'savings', 0);
    const i = input({ today: TODAY, accounts: [chk(10000), sav(0), b], recurring: [move('ab', 'sav', 'savb', '2026-11-20', 10000), move('ba', 'savb', 'sav', '2026-11-20', 10000)] });
    expect(end(i)).toEqual({ chk: 10000, sav: 0, savb: 0 });
    expect(forecastOf(i).unfundedTransfers.map((u) => u.fundedCents)).toEqual([0, 0]);
    reconcile(i);
  });

  it('audit example: two same-day transfers from $500 Savings: the one into spendable cash is the one left short, whatever their names', () => {
    const inv = A('inv', 'Investments', 'savings', 0);
    for (const [n1, n2] of [['Aaa', 'Zzz'], ['Zzz', 'Aaa']]) {
      const i = input({ today: TODAY, accounts: [chk(0), sav(50000), inv], recurring: [move('toInv', 'sav', 'inv', '2026-11-20', 50000, { name: n1 }), move('toChk', 'sav', 'chk', '2026-11-20', 50000, { name: n2 })] });
      expect(end(i)).toEqual({ chk: 0, sav: 0, inv: 50000 });
      expect(computeSafeToSpend(i).cents).toBe(0);
      reconcile(i);
    }
  });

  it('two same-day transfers into spendable accounts share what Savings holds in proportion ($300 for 2 × $200 → $150 each)', () => {
    const i = input({ today: TODAY, accounts: [chk(0), cash(0), sav(30000)], recurring: [move('a', 'sav', 'chk', '2026-11-20', 20000), move('b', 'sav', 'cash', '2026-11-20', 20000)] });
    expect(end(i)).toEqual({ chk: 15000, cash: 15000, sav: 0 });
    reconcile(i);
  });

  it('a recorded future transfer pair is settled by the same rules', () => {
    const i = input({ today: TODAY, accounts: [chk(50000), cash(30000)], transactions: transfer('chk', 'cash', '2026-11-20', 30000), recurring: [once('bill', 'bill', '2026-11-20', 60000, { accountId: 'cash' })] });
    expect(forecastOf(i).accountShortfalls).toEqual([]);
    reconcile(i);
  });
});

describe('F7/F8: smaller corrections', () => {
  it('audit example: a planned $50 "Phone Co" on Nov 20 is matched to Phone (Nov 21), not Gym (first by amount)', () => {
    const i = input({ today: TODAY, accounts: [chk(300000)], recurring: [once('gym', 'bill', '2026-11-20', 5000, { name: 'Gym' }), once('phone', 'bill', '2026-11-21', 5000, { name: 'Phone' })], transactions: [tx({ accountId: 'chk', date: '2026-11-20', amountCents: -5000, merchant: 'Phone Co', id: 'p1' })] });
    expect(warning(i, 'duplicate:')!.title).toBe('Possible duplicate: Phone on Nov 21');
    expect(computeSafeToSpend(i).cents).toBe(300000 - 15000); // nothing merged: all three counted
  });

  it('when the name does not tell them apart, it says so instead of naming one', () => {
    const i = input({ today: TODAY, accounts: [chk(300000)], recurring: [once('gym', 'bill', '2026-11-20', 5000, { name: 'Gym' }), once('phone', 'bill', '2026-11-21', 5000, { name: 'Phone' })], transactions: [tx({ accountId: 'chk', date: '2026-11-20', amountCents: -5000, merchant: 'Payment', id: 'p1' })] });
    const w = warning(i, 'duplicate:')!;
    expect(w.title).toBe('Possible duplicate: Payment on Nov 20');
    expect(w.detail).toContain('matches more than one scheduled bill by amount and date (Gym on Nov 20, Phone on Nov 21)');
  });

  it('audit example: Savings already at −$100 is described as −$100.00, not $0.00', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), sav(-10000)], recurring: [move('m', 'sav', 'chk', '2026-11-25', 50000, { name: 'Top up' })] });
    expect(warning(i, 'unfunded:')!.detail).toContain('which is projected to have −$100.00 then');
    expect(computeSafeToSpend(i).cents).toBe(20000); // Phase 4A.5.9: $300 − $100 owed on Savings (was $300)
  });
});
