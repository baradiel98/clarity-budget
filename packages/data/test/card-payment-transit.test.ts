import { describe, expect, it } from 'vitest';
import { addDays, type ID } from '@clarity/shared';
import { canIAfford, computeSafeToSpend, buildDashboard } from '@clarity/engine';
import { applyOps, deleteTransaction, engineInput, markTransactionPosted, updateTransaction, createRecurring } from '../src';
import { Book } from './fixtures/settlement-harness';

/**
 * Phase 4A.5.15 (owner decision): a card payment that has been initiated but not yet fully settled is counted exactly
 * once against Safe to Spend: from the account it comes from (its sending leg, pending or posted), not a second time
 * as card debt. A forecast-reservation rule only: no status, posted balance, identity or link changes.
 * Checking $1,000, Visa owes $500, no payment scheduled (so the debt is reserved now, Policy B); today Sep 12, 2026.
 * Every expected value is worked out by hand in the comments.
 */
const setup = (owed = 50000, chkCents = 100000) => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', chkCents);
  const v = b.acct('Visa', 'credit_card', owed); // entered as the amount owed
  b.at('2026-09-12');
  return { b, c, v };
};
const pay = (b: Book, from: ID, card: ID, cents: number, status: 'pending' | 'confirmed' = 'pending', toStatus = status, date = '2026-09-10') =>
  b.transfer(from, card, date, cents, status, toStatus);
const lines = (b: Book) => computeSafeToSpend(engineInput(b.data, b.today)).explanation.lines;

describe('both settlement orders: the payment is reserved exactly once', () => {
  it('the owner example: $200 pending at both banks → $500 (4A.5.14 gave $300); balances and statuses untouched', () => {
    const { b, c, v } = setup();
    const t = pay(b, c, v, 20000);
    // checking: 1,000 − 200 pending debit = 800 available; Visa: 500 − 200 already counted from checking = 300
    expect(b.sts()).toBe(50000);
    expect([b.tx(t.out.id).status, b.tx(t.in.id).status, b.posted(c), b.posted(v), b.rec(v)]).toEqual(['pending', 'pending', 100000, -50000, -30000]);
  });
  it('A: checking posted, card issuer not yet → $500; B: card posted, checking pending → $500; both posted → $500', () => {
    for (const [s, ts] of [['confirmed', 'pending'], ['pending', 'confirmed'], ['confirmed', 'confirmed']] as const) {
      const { b, c, v } = setup();
      pay(b, c, v, 20000, s, ts);
      expect(b.sts(), `${s}/${ts}`).toBe(50000);
    }
  });
  it('every transition, either order: Safe to Spend never moves; each posted balance moves only when its own bank posts', () => {
    for (const order of ['checking first', 'card first'] as const) {
      const { b, c, v } = setup();
      const t = pay(b, c, v, 20000);
      const seen = [[b.sts(), b.posted(c), b.posted(v)]];
      const first = order === 'checking first' ? t.out.id : t.in.id;
      const second = order === 'checking first' ? t.in.id : t.out.id;
      b.post(first); seen.push([b.sts(), b.posted(c), b.posted(v)]);
      b.post(second); seen.push([b.sts(), b.posted(c), b.posted(v)]);
      expect(seen, order).toEqual(order === 'checking first'
        ? [[50000, 100000, -50000], [50000, 80000, -50000], [50000, 80000, -30000]]
        : [[50000, 100000, -50000], [50000, 100000, -30000], [50000, 80000, -30000]]);
    }
  });
});

describe('amounts', () => {
  it('a partial payment ($100 of $500) → $500 (checking 900, Visa 400)', () => {
    const { b, c, v } = setup();
    pay(b, c, v, 10000);
    expect(b.sts()).toBe(50000);
  });
  it('several payments to one card ($100 posted at checking + $150 pending at both) → $500', () => {
    const { b, c, v } = setup();
    pay(b, c, v, 10000, 'confirmed', 'pending');
    pay(b, c, v, 15000);
    expect(b.sts()).toBe(50000);
  });
  it('payments to two cards (Visa $500, Amex $300; $200 to Visa pending, $300 to Amex posted at Amex only) → $200 = 1,000 − 800 either way', () => {
    const { b, c, v } = setup();
    const a = b.acct('Amex', 'credit_card', 30000);
    pay(b, c, v, 20000, 'pending', 'pending', '2026-09-12');
    pay(b, c, a, 30000, 'pending', 'confirmed', '2026-09-12'); // (Amex was added today)
    expect(b.sts()).toBe(20000); // checking 500; Visa 300 + Amex 0
  });
  it('a payment larger than the debt (owes $100, pays $300): the $200 credit is not spendable → $700 (never $900)', () => {
    const { b, c, v } = setup(10000);
    const t = pay(b, c, v, 30000);
    expect(b.sts()).toBe(70000);
    b.post(t.in.id);
    expect(b.sts()).toBe(70000);
  });
  it('a card already in credit ($50) receiving a $100 payment → $900; nothing spendable is created', () => {
    const { b, c, v } = setup(-5000);
    pay(b, c, v, 10000);
    expect(b.sts()).toBe(90000);
  });
  it('a payment from SAVINGS (not spendable) is counted once, from savings: checking untouched, Visa owes 300 → $700', () => {
    const { b, c, v } = setup();
    const s = b.acct('Savings', 'savings', 100000);
    pay(b, s, v, 20000);
    expect(b.sts()).toBe(70000);
    void c;
  });
});

describe('what does NOT offset card debt', () => {
  it('a pending refund on the card is still held back until it posts (Phase 4A.5.4) → $500, not $600', () => {
    const { b, v } = setup();
    b.add({ kind: 'refund', accountId: v, date: '2026-09-11', amountCents: 10000, merchant: 'Store refund', categoryId: null, status: 'pending' });
    expect(b.sts()).toBe(50000);
  });
  it('a scheduled payment that has not been initiated follows the scheduled-payment rules (covered on its date, not now)', () => {
    const { b, c, v } = setup();
    b.data = applyOps(b.data, createRecurring(b.ctx(), { name: 'Visa payment', kind: 'transfer', accountId: c, toAccountId: v, categoryId: null, schedule: { freq: 'once', date: '2026-09-25' }, amount: { type: 'fixed', cents: 20000 } }).ops);
    // checking 1,000; Sep 25: −200 to Visa; Visa still owes 300 not covered → 1,000 − 200 − 300 = 500 (unchanged rule)
    expect(b.sts()).toBe(50000);
    expect(lines(b).some((l) => /not yet posted by the card issuer/.test(l.label))).toBe(false);
  });
  it('a failed payment: once the user deletes it, the full debt is reserved again and checking is whole → $500 (1,000 − 500)', () => {
    const { b, c, v } = setup();
    const t = pay(b, c, v, 20000);
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), t.out.id));
    expect([b.sts(), b.rec(c), b.rec(v)]).toEqual([50000, 100000, -50000]);
  });
});

describe('edits, statements, undo, archived cards, dates', () => {
  it('editing the amount ($200 → $300) keeps it counted once; per-leg statuses are kept', () => {
    const { b, c, v } = setup();
    const t = pay(b, c, v, 20000, 'confirmed', 'pending');
    b.data = applyOps(b.data, updateTransaction(b.ctx(), t.out.id, { kind: 'transfer', accountId: c, toAccountId: v, date: '2026-09-10', amountCents: 30000, merchant: 'Transfer', categoryId: null, status: 'confirmed' }).ops);
    expect([b.sts(), b.tx(t.out.id).status, b.tx(t.in.id).status]).toEqual([50000, 'confirmed', 'pending']);
  });
  it('linked through the card statement, then the checking statement, then both undone: $500 throughout', () => {
    const { b, c, v } = setup();
    const t = pay(b, c, v, 20000);
    // the card statement shows a purchase (left out here) and the payment; its running balance fixes the sign convention
    const r1 = b.commit(b.review(v, [['2026-09-11', 'GROCER', -1000, -51000], ['2026-09-11', 'PAYMENT THANK YOU', 20000, -31000]]), { GROCER: 'skip', 'PAYMENT THANK YOU': t.in.id });
    expect([b.sts(), b.tx(t.in.id).status, b.tx(t.out.id).status]).toEqual([50000, 'confirmed', 'pending']);
    const r2 = b.commit(b.review(c, [['2026-09-11', 'VISA AUTOPAY', -20000, 80000]]), { 'VISA AUTOPAY': t.out.id });
    expect(b.sts()).toBe(50000);
    b.undo(r1.batch.id);
    expect([b.sts(), b.tx(t.in.id).status]).toEqual([50000, 'pending']);
    b.undo(r2.batch.id);
    expect([b.sts(), b.tx(t.out.id).status]).toEqual([50000, 'pending']);
  });
  it('an archived card: its debt is still reserved, minus the payment on its way → $500', () => {
    const { b, c, v } = setup();
    pay(b, c, v, 20000);
    b.data = applyOps(b.data, [{ t: 'put', table: 'accounts', value: { ...b.a(v), archived: true } }]);
    expect(b.sts()).toBe(50000);
  });
  it('a same-day card purchase and payment (pending $50 purchase, $200 payment) → $450', () => {
    const { b, c, v } = setup();
    b.add({ kind: 'expense', accountId: v, date: '2026-09-12', amountCents: 5000, merchant: 'Lunch', categoryId: null, status: 'pending' });
    pay(b, c, v, 20000, 'pending', 'pending', '2026-09-12');
    expect(b.sts()).toBe(45000); // checking 800; Visa 500 + 50 − 200 = 350
  });
  it('a payment initiated days before today counts the same; one scheduled for a future date moves both sides that day (never twice) → $500', () => {
    for (const date of ['2026-09-05', '2026-09-20']) {
      const { b, c, v } = setup();
      pay(b, c, v, 20000, 'pending', 'pending', date);
      expect(b.sts(), date).toBe(50000);
    }
  });
  it('a low checking account: shortfall warnings and "Can I afford this?" use the same rule', () => {
    const { b, c, v } = setup(50000, 25000);
    pay(b, c, v, 20000);
    // checking 250 − 200 = 50; Visa owes 300 → Safe to Spend −250 (4A.5.14: −450)
    expect(b.sts()).toBe(-25000);
    const i = engineInput(b.data, b.today);
    expect(canIAfford(i, { amountCents: 100, accountId: c, date: b.today }).verdict).not.toBe('yes');
    const big = setup();
    pay(big.b, big.c, big.v, 20000);
    const bi = engineInput(big.b.data, big.b.today);
    expect([canIAfford(bi, { amountCents: 50000, accountId: big.c, date: big.b.today }).verdict, canIAfford(bi, { amountCents: 50001, accountId: big.c, date: big.b.today }).verdict === 'yes']).toEqual(['yes', false]);
    expect(buildDashboard(bi).safeToSpend.cents).toBe(50000);
  });
  it('"Why this number?" names the payment and says it is counted once', () => {
    const { b, c, v } = setup();
    pay(b, c, v, 20000);
    const l = lines(b).find((x) => x.label === 'Visa: $200.00 payment from Checking not yet posted by the card issuer')!;
    expect(l.note).toBe("already counted from Checking, so the $200.00 of card debt it pays isn't counted again. If it's returned or rejected: when the returned money shows on a statement, choose \"It's the return of this card payment\" in the import review (not a separate deposit), and the card debt is counted in full again; if the money never left Checking, delete the payment");
    void c;
  });
});

/**
 * Randomized: two cards, checking and savings; purchases and refunds on the cards (pending or posted); payments from
 * checking or savings (partial, several, sometimes more than owed), each leg with its own status; legs posted later in
 * either order; payments edited or deleted (failed). The independent model (written here, not the engine's code):
 *   checking available = everything recorded in checking − its pending credits;
 *   each card's reserved debt = max(0, what it owes counting every payment whose sending side is recorded, and every
 *   purchase and posted refund, but not pending refunds);
 *   Safe to Spend = checking available − Σ reserved debt (savings stays positive; no schedules).
 * After every action Safe to Spend equals the model; posting either leg never moves it; no recorded balance changes.
 */
it('randomized: card payments in transit are counted exactly once after every action (300 runs)', () => {
  let seedState = 0;
  const rnd = () => ((seedState = (seedState * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  let steps = 0, transitions = 0, overpaid = 0;
  for (let run = 1; run <= 300; run++) {
    seedState = run * 2654435761 >>> 0;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const b = new Book();
    const c = b.acct('Checking', 'checking', 200000);
    const s = b.acct('Savings', 'savings', 500000);
    const cards = [b.acct('Visa', 'credit_card', pick([0, 20000, 50000, -3000])), b.acct('Amex', 'credit_card', pick([0, 10000, 40000]))];
    b.at('2026-09-12');
    const model = () => {
      const tx = b.data.transactions;
      const chk = 200000 + tx.filter((t) => t.accountId === c).reduce((a, t) => a + t.amountCents, 0) - tx.filter((t) => t.accountId === c && t.status === 'pending' && t.amountCents > 0).reduce((a, t) => a + t.amountCents, 0);
      let owed = 0;
      for (const k of cards) {
        const opening = b.a(k).openingBalanceCents;
        const counted = tx.filter((t) => t.accountId === k && !(t.status === 'pending' && t.amountCents > 0 && !t.transferGroupId)).reduce((a, t) => a + t.amountCents, 0);
        owed += Math.max(0, -(opening + counted));
      }
      return chk - owed;
    };
    const legs: { out: ID; in: ID }[] = [];
    for (let st = 0; st < 12; st++) {
      const op = rnd();
      const date = addDays('2026-09-12', -Math.floor(rnd() * 6));
      const card = pick(cards);
      if (op < 0.3) {
        b.add({ kind: rnd() < 0.75 ? 'expense' : 'refund', accountId: card, date, amountCents: pick([2500, 5000, 12000]), merchant: 'Shop', categoryId: null, status: rnd() < 0.4 ? 'pending' : 'confirmed' });
      } else if (op < 0.6) {
        const owedNow = -b.rec(card);
        const cents = pick([5000, 10000, 20000, 60000]);
        if (cents > owedNow) overpaid++;
        const t = pay(b, rnd() < 0.75 ? c : s, card, cents, pick(['pending', 'confirmed'] as const), pick(['pending', 'confirmed'] as const), date);
        legs.push({ out: t.out.id, in: t.in.id });
      } else if (op < 0.85 && legs.length) {
        const l = pick(legs);
        const id = rnd() < 0.5 ? l.out : l.in;
        if (b.tx(id)?.status === 'pending') {
          const before = { sts: b.sts(), recs: [c, s, ...cards].map((a) => b.rec(a)) };
          b.data = applyOps(b.data, markTransactionPosted(b.ctx(), id));
          transitions++;
          expect(b.sts(), `run ${run} step ${st}: posting a leg moved Safe to Spend`).toBe(before.sts);
          expect([c, s, ...cards].map((a) => b.rec(a)), `run ${run}: recorded balances changed`).toEqual(before.recs);
        }
      } else if (legs.length) {
        const l = legs.splice(Math.floor(rnd() * legs.length), 1)[0]!;
        if (rnd() < 0.5) b.data = applyOps(b.data, deleteTransaction(b.ctx(), l.out)); // failed / reversed
        else {
          const out = b.tx(l.out), inc = b.tx(l.in);
          b.data = applyOps(b.data, updateTransaction(b.ctx(), l.out, { kind: 'transfer', accountId: out.accountId, toAccountId: inc.accountId, date: out.date, amountCents: pick([7500, 15000]), merchant: 'Transfer', categoryId: null, status: out.status, toStatus: inc.status }).ops);
          legs.push(l);
        }
      }
      steps++;
      expect(b.sts(), `run ${run} step ${st}`).toBe(model());
    }
  }
  expect([steps, transitions > 200, overpaid > 20]).toEqual([3600, true, true]);
});
