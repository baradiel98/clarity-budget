import { describe, expect, it } from 'vitest';
import { accountBalance, buildDashboard, buildForecast, canIAfford, computeSafeToSpend, type EngineInput, type Forecast } from '../src';
import { account, input, rec, tx } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.4.4 regression tests (audit 4A.4.3). Expected values are worked out by hand in the comments.
 * Today is Fri, Nov 13, 2026; no paycheck after November, so Safe to Spend runs through Dec 31.
 */
const TODAY = '2026-11-13';
const since = (d: string) => ({ startDate: d, trackFrom: d });
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const move = (id: string, from: string, to: string, date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  once(id, 'transfer', date, cents, { accountId: from, toAccountId: to, ...extra });
const A = (id: string, name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', bal: number, extra: Record<string, unknown> = {}) =>
  account({ id, name, type, openingBalanceCents: bal, openingDate: '2026-11-01', ...extra });
const chk = (b: number) => A('chk', 'Checking', 'checking', b);
const sts = (i: EngineInput) => computeSafeToSpend(i).cents;
const warns = (i: EngineInput) => buildDashboard(i).warnings;
const warning = (i: EngineInput, prefix: string) => warns(i).find((w) => w.id.startsWith(prefix));
const forecastOf = (i: EngineInput): Forecast =>
  buildForecast({ today: i.today, horizonEnd: computeSafeToSpend(i).horizonEnd, accounts: i.accounts, transactions: i.transactions, recurring: i.recurring, exceptions: i.exceptions, baseCurrency: 'USD', includeEstimatedIncome: false });
const archive = (i: EngineInput, id: string): EngineInput => ({ ...i, accounts: i.accounts.map((a) => (a.id === id ? { ...a, archived: true } : a)) });
/** Same reconciliation as financial-integrity.test.ts (the overdrawn balance counts as money moved in from the spendable accounts). */
function reconcile(i: EngineInput) {
  const f = forecastOf(i);
  const startTotal = i.accounts.reduce((s, a) => s + accountBalance(a, i.transactions, i.today), 0);
  const nonTransfer = f.days.flatMap((d) => d.events).filter((e) => e.legs.length !== 2).reduce((s, e) => s + e.legs.reduce((a, l) => a + l.deltaCents, 0), 0);
  const covered = f.coveredPayments.reduce((s, c) => s + c.coveredCents, 0);
  expect(Object.values(f.endBalances).reduce((s, b) => s + b, 0)).toBe(startTotal + nonTransfer + covered);
  expect(f.days.at(-1)!.endCashCents).toBe(f.cashAccountIds.reduce((s, id) => s + (f.endBalances[id] ?? 0), 0) - covered);
}

describe('1. Archiving never hides a negative balance', () => {
  it('audit example: Checking $1,000 + another checking at −$500 → $500 before AND after archiving (was $1,000 after)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('old', 'Old checking', 'checking', -50000)] });
    expect(sts(i)).toBe(50000); // 1,000 − 500
    const a = archive(i, 'old');
    expect(sts(a)).toBe(50000);
    const w = warning(a, 'archived-overdrawn:old')!;
    expect(w.title).toBe('Old checking is archived and overdrawn by $500.00');
    expect(w.detail).toContain('Archiving doesn\'t clear it: Safe to Spend still counts $500.00 against your spendable accounts');
    // the debt stays in the totals, once; the positive Checking balance is unchanged
    const b = buildDashboard(a).balances;
    expect([b.availableCashCents, b.totalAssetsCents, b.netCents]).toEqual([100000, 50000, 50000]);
    reconcile(a);
  });

  it('counted once: a later bill from the archived account is paid from the restored $0, not double-counted', () => {
    const i = archive(input({ today: TODAY, accounts: [chk(100000), A('old', 'Old checking', 'checking', -50000)], recurring: [once('fee', 'bill', '2026-11-20', 10000, { accountId: 'old', name: 'Fee' })] }), 'old');
    // −500 (debt) − 100 (fee, the archived account holds $0 after the debt is counted) = 1,000 − 600 = 400
    expect(sts(i)).toBe(40000);
    reconcile(i);
  });

  it('cash account: −$200 archived → still counted ($800)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('wal', 'Wallet', 'cash', -20000)] });
    expect([sts(i), sts(archive(i, 'wal'))]).toEqual([80000, 80000]);
  });

  it('savings (not spendable) at −$100: not counted before, not counted after — archiving changes nothing', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('sav', 'Savings', 'savings', -10000)] });
    expect([sts(i), sts(archive(i, 'sav'))]).toEqual([100000, 100000]);
    expect(buildDashboard(archive(i, 'sav')).balances.totalAssetsCents).toBe(90000); // still in the totals as owed
  });

  it('a savings account marked spendable is treated like checking', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('sav', 'Savings', 'savings', -10000, { spendable: true })] });
    expect([sts(i), sts(archive(i, 'sav'))]).toEqual([90000, 90000]);
  });

  it('a positive archived balance is still not spendable', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('old', 'Old checking', 'checking', 50000)] });
    expect([sts(i), sts(archive(i, 'old'))]).toEqual([150000, 100000]);
    expect(warning(archive(i, 'old'), 'archived-overdrawn:')).toBeUndefined();
  });

  it('unarchiving gives the same result (the debt is counted either way)', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('old', 'Old checking', 'checking', -50000, { archived: true })] });
    const restored = { ...i, accounts: i.accounts.map((a) => ({ ...a, archived: false })) };
    expect([sts(i), sts(restored)]).toEqual([50000, 50000]);
  });
});

describe('2. An archived credit card keeps its debt warning', () => {
  const card = (archived: boolean, bal = -100000) => A('card', 'Visa', 'credit_card', bal, { archived });
  it('$1,000 owed, no payment: the warning stays when the card is archived, once', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), card(true)] });
    const ws = warns(i).filter((w) => w.id.includes('card'));
    expect(ws.map((w) => w.title)).toEqual(['$1,000.00 on Visa with no payment scheduled']);
    expect(ws[0]!.detail).toContain("Visa is archived; archiving doesn't clear what it owes.");
    expect(buildDashboard(i).balances.cardOwedCents).toBe(100000);
    expect(sts(i)).toBe(100000); // unchanged: card debt is counted only through a scheduled payment
  });
  it('paid off, payment scheduled, or unarchived: the right warning or none', () => {
    expect(warns(input({ today: TODAY, accounts: [chk(100000), card(true, 0)] })).filter((w) => w.id.includes('card'))).toEqual([]);
    const pay = rec({ id: 'p', name: 'Visa payment', kind: 'transfer', accountId: 'chk', toAccountId: 'card', ...since('2026-11-25'), schedule: { freq: 'monthly', interval: 1, day: 25, anchor: '2026-11-25' }, amount: { type: 'card_full_balance' } });
    const scheduled = input({ today: TODAY, accounts: [chk(200000), card(true)], recurring: [pay] });
    expect(warns(scheduled).some((w) => w.id.startsWith('card-unscheduled'))).toBe(false);
    expect(sts(scheduled)).toBe(100000); // 2,000 − 1,000 paid on Nov 25
    const active = warns(input({ today: TODAY, accounts: [chk(100000), card(false)] })).find((w) => w.id.startsWith('card-unscheduled'))!;
    expect(active.detail).toBe('This balance is not deducted from Safe to Spend until you schedule a card payment.');
  });
});

describe('3. An archived account in another currency is never described as counted', () => {
  const eur = (b: number) => A('eur', 'Euro savings', 'savings', b, { archived: true, currency: 'EUR' });
  for (const [label, bal] of [['zero', 0], ['partial', 20000], ['enough', 100000]] as const) {
    it(`archived EUR account (${label} balance) paying two bills: not counted, and it says so`, () => {
      const i = input({ today: TODAY, accounts: [chk(100000), eur(bal)], recurring: [once('fee', 'bill', '2026-11-20', 50000, { accountId: 'eur', name: 'Fee' }), once('tax', 'bill', '2026-12-05', 30000, { accountId: 'eur', name: 'Tax' })] });
      expect(sts(i)).toBe(100000);
      const w = warning(i, 'archived:eur')!;
      expect(w.title).toBe('2 scheduled items still use Euro savings, which is archived');
      expect(w.detail).toContain("Euro savings is in EUR, and Clarity doesn't convert currencies, so none of these are counted in Safe to Spend (USD)");
      expect(w.detail).not.toContain('still counted');
      expect(w.items!.map((x) => x.currency)).toEqual(['EUR', 'EUR']);
      expect(warns(i).find((w) => w.id === 'currency')!.detail).toContain('Fee (Nov 20), Tax (Dec 5)'); // the currency notice includes it
    });
  }
  it('an archived GBP account and an active EUR account are both in the currency notice; USD archived text unchanged', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('gbp', 'Pounds', 'checking', 0, { archived: true, currency: 'GBP' }), A('e', 'Euro', 'savings', 0, { currency: 'EUR' }), A('old', 'Old', 'checking', 0, { archived: true })],
      recurring: [once('g', 'bill', '2026-11-20', 1000, { accountId: 'gbp', name: 'Pound bill' }), once('e', 'bill', '2026-11-21', 2000, { accountId: 'e', name: 'Euro bill' }), once('o', 'bill', '2026-11-22', 3000, { accountId: 'old', name: 'Old bill' })] });
    expect(warns(i).find((w) => w.id === 'currency')!.items).toEqual([{ date: '2026-11-20', label: 'Pound bill', cents: -1000, currency: 'GBP' }, { date: '2026-11-21', label: 'Euro bill', cents: -2000, currency: 'EUR' }]);
    expect(warning(i, 'archived:old')!.detail).toContain('Bills and transfers out of Old are still counted');
    expect(sts(i)).toBe(100000 - 3000); // only the USD archived bill is counted
  });
});

describe('4. Cash advance vs card payments and later purchases', () => {
  // Audit scenario: Checking $500, $90 advance Nov 20, $400 card payment Dec 21, $400 card purchases on a date below.
  const S = (purchaseDate: string, extra: RecurringItem[] = [], withAdvance = true, purchase = 40000) => input({
    today: TODAY,
    accounts: [chk(50000), A('card', 'Visa', 'credit_card', 0)],
    recurring: [
      ...(withAdvance ? [move('adv', 'card', 'chk', '2026-11-20', 9000, { name: 'Cash advance' })] : []),
      move('pay', 'chk', 'card', '2026-12-21', 40000, { name: 'Card payment' }),
      once('buy', 'bill', purchaseDate, purchase, { accountId: 'card', name: 'Card purchases' }),
      ...extra,
    ],
  });
  it('purchases BEFORE the payment (Dec 20): the payment pays them first; the advance stays owed → $100', () => {
    // Dec 21: real 500 + 90 − 400 = 190; card owes 490 − 400 = 90, all of it the advance → own money 190 − 90 = 100
    expect(sts(S('2026-12-20'))).toBe(10000);
    expect(warning(S('2026-12-20'), 'advance:')!.detail).toContain('Through Dec 31, $90.00 of planned cash advances is not paid back.');
  });
  it('purchases ON the payment date: same day, purchases count first → $100', () => {
    expect(sts(S('2026-12-21'))).toBe(10000);
  });
  it('purchases AFTER the payment (Dec 22): the payment really repays the advance → $190, and the unpaid card balance is now disclosed', () => {
    // Dec 21: card owed only the $90 advance; the $400 payment repays it and leaves a $310 credit.
    // Dec 22: $400 purchases use the $310 credit and leave $90 of purchase debt, which (like all card purchases)
    // is counted only when a payment is scheduled. Real cash: 500 + 90 − 400 = 190.
    const i = S('2026-12-22');
    expect(sts(i)).toBe(19000);
    expect(forecastOf(i).endBalances.card).toBe(-9000);
    expect(warning(i, 'advance:')!.detail).not.toContain('not paid back');
    const w = warning(i, 'card-projected:card')!;
    expect(w.title).toBe('Visa is projected to owe $90.00 on Dec 31, and no payment is scheduled for it');
  });
  it('the same $90 of unpaid purchase debt appears without any advance (it is the card rule, not borrowed money)', () => {
    const i = S('2026-12-22', [], false, 49000); // $490 of purchases after a $400 payment
    expect(sts(i)).toBe(10000); // 500 − 400
    expect(warning(i, 'card-projected:card')!.title).toBe('Visa is projected to owe $90.00 on Dec 31, and no payment is scheduled for it');
  });
  it('a later scheduled payment pays it: no projected-debt warning', () => {
    const i = S('2026-12-22', [move('jan', 'chk', 'card', '2027-01-21', 9000, { name: 'January payment' })]);
    expect(warning(i, 'card-projected:')).toBeUndefined();
  });
  it('a full-balance payment repays the advance once (no double count) → −$900 audit case unchanged', () => {
    const i = input({ today: TODAY, accounts: [chk(30000), A('card', 'Visa', 'credit_card', 0)], recurring: [
      move('adv', 'card', 'chk', '2026-11-20', 100000, { name: 'Cash advance' }), once('rent', 'bill', '2026-12-01', 120000, { name: 'Rent' }),
      rec({ id: 'p', name: 'Card payment', kind: 'transfer', accountId: 'chk', toAccountId: 'card', ...since('2026-12-15'), schedule: { freq: 'once', date: '2026-12-15' }, amount: { type: 'card_full_balance' } })] });
    expect(sts(i)).toBe(-90000);
  });
  it('an advance from a EUR card into a EUR account is not subtracted from USD Safe to Spend', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('ec', 'Euro card', 'credit_card', 0, { currency: 'EUR' }), A('ea', 'Euro checking', 'checking', 0, { currency: 'EUR' })], recurring: [move('adv', 'ec', 'ea', '2026-11-20', 50000)] });
    expect(sts(i)).toBe(100000); // before Phase 4A.4.4: 1,000 − 500 (€500 subtracted from dollars)
  });
});

describe('5. Amounts are shown in their own currency', () => {
  it('EUR → EUR transfer short of money: "€500.00 of €800.00", never "$"', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('eurc', 'Euro checking', 'checking', 50000, { currency: 'EUR' }), A('eur', 'Euro savings', 'savings', 0, { currency: 'EUR' })], recurring: [move('a', 'eurc', 'eur', '2026-11-20', 80000, { name: 'Euro move' })] });
    const w = warning(i, 'unfunded:')!;
    expect(w.title).toBe('Euro move: only €500.00 of €800.00 is available');
    expect(w.detail).toBe('Scheduled for Nov 20 from Euro checking, which is projected to have €500.00 then. Only that amount is counted; €300.00 is not.');
    expect(w.items).toEqual([{ date: '2026-11-20', label: 'Euro move', cents: -30000, currency: 'EUR' }]);
  });
  it('mixed currencies in one list: each item keeps its own currency; negative amounts keep their sign', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('eur', 'Euro savings', 'savings', 100000, { currency: 'EUR' }), A('gbp', 'Pounds', 'checking', 0, { currency: 'GBP' })],
      recurring: [move('fx', 'eur', 'chk', '2026-11-20', 50000, { name: 'Euro move' }), once('g', 'income', '2026-11-21', 7000, { accountId: 'gbp', name: 'Pound refund' })],
      transactions: [tx({ accountId: 'gbp', date: '2026-11-25', amountCents: -1234, merchant: 'Pound shop' })] });
    expect(warning(i, 'currency-transfer:')!.items).toEqual([{ date: '2026-11-20', label: 'Euro move', cents: -50000, currency: 'EUR' }]);
    expect(warns(i).find((w) => w.id === 'currency')!.items).toEqual([
      { date: '2026-11-20', label: 'Euro move', cents: -50000, currency: 'EUR' },
      { date: '2026-11-21', label: 'Pound refund', cents: 7000, currency: 'GBP' },
      { date: '2026-11-25', label: 'Pound shop', cents: -1234, currency: 'GBP' },
    ]);
    // upcoming items on foreign accounts carry their currency for display
    const up = buildDashboard(i).upcoming.find((u) => u.label === 'Pound refund')!;
    expect([up.cents, up.currency, up.affectsCash]).toEqual([7000, 'GBP', false]);
  });
  it('a possible duplicate on a EUR account is described in euros', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('eur', 'Euro checking', 'checking', 100000, { currency: 'EUR' })], recurring: [once('rent', 'bill', '2026-12-01', 80000, { accountId: 'eur', name: 'Rent' })],
      transactions: [tx({ accountId: 'eur', date: '2026-12-01', amountCents: -80000, merchant: 'Rent', id: 'p1' })] });
    expect(warning(i, 'duplicate:')!.detail).toContain('A planned transaction for €800.00 on Dec 1');
  });
});

describe('6. One scheduled item, many dates: one warning with every date', () => {
  const weekly = rec({ id: 'gym', name: 'Gym', kind: 'bill', accountId: 'old', ...since('2026-11-14'), schedule: { freq: 'weekly', interval: 1, anchor: '2026-11-14' }, amount: { type: 'fixed', cents: 10000 } });
  it('audit example: weekly $100 from an archived account holding $250 → one grouped warning, five dates, $450 total', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('old', 'Old', 'checking', 25000, { archived: true })], recurring: [weekly] });
    // Nov 14 + Nov 21 paid by Old (250 → 50); Nov 28: 50 of 100; Dec 5, 12, 19, 26: 0 of 100 → covered 50 + 400 = 450
    expect(sts(i)).toBe(100000 - 45000);
    const covered = warns(i).filter((w) => w.id.startsWith('covered:'));
    expect(covered).toHaveLength(1);
    expect(covered[0]!.title).toBe("Gym: Old can't fully cover 5 payments");
    expect(covered[0]!.detail).toContain('Safe to Spend counts $450.00 in total against your spendable accounts. Move $450.00 into Old before Nov 28');
    expect(covered[0]!.items!.map((x) => [x.date, x.cents])).toEqual([['2026-11-28', -5000], ['2026-12-05', -10000], ['2026-12-12', -10000], ['2026-12-19', -10000], ['2026-12-26', -10000]]);
    const arch = warning(i, 'archived:old')!;
    expect(arch.title).toBe('1 scheduled item still uses Old, which is archived'); // was "7 scheduled items"
    expect(arch.items).toHaveLength(7);
  });
  it('two different bills with the same amount are not combined', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('sav', 'Savings', 'savings', 0)], recurring: [once('a', 'bill', '2026-11-20', 5000, { accountId: 'sav', name: 'Gym' }), once('b', 'bill', '2026-11-20', 5000, { accountId: 'sav', name: 'Phone' })] });
    expect(warns(i).filter((w) => w.id.startsWith('covered:')).map((w) => w.title)).toEqual(["Gym: Savings can't cover it", "Phone: Savings can't cover it"]);
  });
  it('the Home short list is no longer filled by one recurring item', () => {
    const i = input({ today: TODAY, accounts: [chk(100000), A('old', 'Old', 'checking', 0, { archived: true }), A('cash', 'Cash', 'cash', 0)],
      recurring: [weekly, once('c', 'bill', '2026-11-20', 30000, { accountId: 'cash', name: 'Cash bill' })] });
    expect(warns(i).slice(0, 5).map((w) => w.id.split(':')[0])).toEqual(expect.arrayContaining(['covered', 'account-short', 'archived']));
  });
});

describe('"Can I afford this?" is unaffected for normal accounts', () => {
  it('still Yes from checking', () => expect(canIAfford(input({ today: TODAY, accounts: [chk(100000)] }), { amountCents: 1000, accountId: 'chk', date: TODAY }).headline).toBe('Yes, through Dec 31'));
});
