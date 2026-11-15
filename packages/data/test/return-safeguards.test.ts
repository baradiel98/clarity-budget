import { describe, expect, it } from 'vitest';
import { cardPaymentsInTransit, historyStatus, balanceAsOfDate } from '@clarity/engine';
import { addDays, type ID } from '@clarity/shared';
import {
  addTransaction, applyOps, deleteTransaction, describeImportResult, inverseOps, markPostedBeforeOpening, markTransactionPosted, recordPaymentReturn, returnOptionsForEntry, returnRowText,
  updateTransaction,
} from '../src';
import { Book, errorOf, row } from './fixtures/settlement-harness';

/**
 * Phase 4A.5.18: returned card payments entered by hand, partial returns, returns after 30 days, the review row, and the
 * opening-balance correction. Checking $1,000; Visa owes $500; no schedules; today Sep 12, 2026 unless stated. Every
 * expected value is worked out by hand in the comments (truth = each bank's own ledger).
 */
const setup = () => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', 100000);
  const v = b.acct('Visa', 'credit_card', 50000);
  b.at('2026-09-12');
  return { b, c, v };
};
const inTransit = (b: Book) => cardPaymentsInTransit(b.data.accounts, b.data.transactions, b.today).map((p) => p.cents);
const manualReturn = (b: Book, legId: ID, account: ID, cents: number, date = b.today, extra: { replaceTxId?: ID; status?: 'pending' | 'confirmed' } = {}) => {
  const r = recordPaymentReturn(b.ctx(), { paymentLegId: legId, accountId: account, amountCents: cents, date, ...extra });
  b.data = applyOps(b.data, r.ops);
  return r;
};
const options = (b: Book, account: ID, cents: number, merchant = 'Deposit', all = false, date = b.today) => returnOptionsForEntry(b.data, { kind: 'income', accountId: account, amountCents: cents, date, merchant }, all);

describe('manual entry: a returned card payment typed in by hand', () => {
  it('suggested for income of the full amount within 30 days; recording it: $500 (as separate income it would be $700)', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    expect(options(b, c, 20000).map((m) => [m.txId, m.basis, m.returnInfo!.remainingAfterCents])).toEqual([[t.out.id, 'return', 0]]);
    manualReturn(b, t.out.id, c, 20000);
    // checking 1,000 − 200 + 200 = 1,000; Visa: payment returned before the issuer posted anything → owes 500
    expect([b.sts(), b.rec(c), b.rec(v), inTransit(b)]).toEqual([50000, 100000, -50000, []]);
  });
  it('every settlement state of the payment: before either side posts, checking posted, card posted, both posted → $500', () => {
    for (const [so, si] of [['pending', 'pending'], ['confirmed', 'pending'], ['pending', 'confirmed'], ['confirmed', 'confirmed']] as const) {
      const { b, c, v } = setup();
      const t = b.transfer(c, v, '2026-09-10', 20000, so, si);
      manualReturn(b, t.out.id, c, 20000);
      expect([b.sts(), b.rec(v)], `${so}/${si}`).toEqual([50000, -50000]);
    }
  });
  it('legitimate income that resembles a return: the user says it is separate → $700 (a genuine deposit plus a payment still on its way); a smaller amount isn\'t even suggested', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    expect(options(b, c, 8000, 'PAYROLL')).toEqual([]);
    const r = addTransaction(b.ctx(), { kind: 'income', accountId: c, date: b.today, amountCents: 20000, merchant: 'Payroll', categoryId: null, provenance: { source: 'manual', separateFrom: [t.out.id] } });
    b.data = applyOps(b.data, r.ops);
    // checking 1,000 − 200 + 200 = 1,000; Visa 500 − 200 on its way = 300
    expect([b.sts(), r.txs[0]!.provenance.separateFrom]).toEqual([70000, [t.out.id]]);
  });
  it('an existing income transaction corrected into a return keeps its date, status and statement identity; re-importing still recognises the row', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const imp = b.commit(b.review(c, [['2026-09-12', 'DEPOSIT 7781', 20000, 100000]]), { 'DEPOSIT 7781': 'none' });
    const income = imp.txs[0]!;
    expect(b.sts()).toBe(70000); // imported as separate income
    manualReturn(b, t.out.id, c, 20000, b.today, { replaceTxId: income.id });
    expect([b.sts(), b.data.transactions.some((x) => x.id === income.id)]).toEqual([50000, false]);
    expect(b.review(c, [['2026-09-12', 'DEPOSIT 7781', 20000, 100000]]).preview.candidates[0]!.duplicate?.level).toBe('exact');
  });
  it('undo (the store\'s inverse operations) removes the return; the payment is on its way again', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const before = b.data;
    const r = recordPaymentReturn(b.ctx(), { paymentLegId: t.out.id, accountId: c, amountCents: 20000, date: b.today });
    b.data = applyOps(b.data, r.ops);
    b.data = applyOps(b.data, inverseOps(before, r.ops));
    expect([b.sts(), inTransit(b), b.data.transactions.length]).toEqual([50000, [20000], 2]);
  });
});

describe('partial returns', () => {
  it('$80 of a $200 payment: the other $120 stays on its way → $500; Visa shows $380', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    expect(options(b, c, 8000)).toEqual([]); // no evidence: not suggested
    expect(options(b, c, 8000, 'Payment returned').map((m) => m.returnInfo)).toEqual([{ paymentCents: 20000, returnedBeforeCents: 0, returnCents: 8000, remainingAfterCents: 12000, older: false }]);
    manualReturn(b, t.out.id, c, 8000);
    // checking 1,000 − 200 + 80 = 880; Visa 500 − 120 = 380
    expect([b.sts(), b.rec(c), b.rec(v), inTransit(b)]).toEqual([50000, 88000, -38000, [12000]]);
  });
  it('after the issuer posted the payment: the partial return\'s card side awaits the reversal; still $500', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000, 'confirmed', 'confirmed');
    manualReturn(b, t.out.id, c, 8000);
    expect([b.sts(), b.rec(v), inTransit(b)]).toEqual([50000, -38000, []]);
  });
  it('several partial returns ($80, $70, then $50): never more than the payment; a fourth is refused; a duplicate full return is refused', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    manualReturn(b, t.out.id, c, 8000);
    manualReturn(b, t.out.id, c, 7000);
    expect([b.sts(), inTransit(b)]).toEqual([50000, [5000]]);
    expect(errorOf(() => manualReturn(b, t.out.id, c, 6000))).toMatchObject({ field: 'amount', message: expect.stringMatching(/only \$50\.00 of this \$200\.00 payment is left to return \(\$150\.00 already returned\)/) });
    manualReturn(b, t.out.id, c, 5000);
    expect([b.sts(), inTransit(b), b.rec(v), options(b, c, 20000, 'Payment returned', true)]).toEqual([50000, [], -50000, []]);
    expect(errorOf(() => manualReturn(b, t.out.id, c, 100))).toMatchObject({ field: 'amount' });
  });
  it('import: two partial-return rows in one statement ($80 + $70) are both offered and recorded; rows adding up to more than the payment are refused', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const lines = (a: number, x: number): Parameters<Book['review']>[1] => [['2026-09-11', 'PAYMENT RETURNED A', a, 100000], ['2026-09-12', 'PAYMENT RETURNED B', x, 100000]];
    const rv = b.review(c, lines(8000, 15000));
    expect(errorOf(() => b.commit(rv, { 'PAYMENT RETURNED A': t.out.id, 'PAYMENT RETURNED B': t.out.id }))).toMatchObject({ field: 'amount' });
    const r = b.commit(b.review(c, lines(8000, 7000)), { 'PAYMENT RETURNED A': t.out.id, 'PAYMENT RETURNED B': t.out.id });
    expect([b.sts(), inTransit(b), describeImportResult(r.batch)]).toEqual([50000, [5000], '0 new transactions imported · 2 returned card payments recorded']);
  });
});

describe('dates, duplicates and other paths', () => {
  it('after 30 days: not suggested from the amount alone, but the user can choose it ("all"); with "RETURNED" it is suggested', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-01', 20000, 'confirmed', 'confirmed');
    b.at('2026-10-15');
    expect(options(b, c, 20000, 'Deposit', false, '2026-10-12')).toEqual([]);
    expect(options(b, c, 20000, 'RETURNED PAYMENT', false, '2026-10-12').map((m) => m.returnInfo!.older)).toEqual([true]);
    expect(options(b, c, 20000, 'Deposit', true, '2026-10-12').map((m) => m.txId)).toEqual([t.out.id]);
    manualReturn(b, t.out.id, c, 20000, '2026-10-12');
    // checking 1,000 − 200 + 200; Visa 300 posted + 200 reversal pending → owes 500 → 500
    expect(b.sts()).toBe(50000);
  });
  it('a return already recorded through a statement import can\'t be entered again by hand (nothing left to return)', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    b.commit(b.review(c, [['2026-09-12', 'RETURNED PAYMENT', 20000, 100000]]), { 'RETURNED PAYMENT': t.out.id });
    expect(options(b, c, 20000, 'Returned payment', true)).toEqual([]);
    expect(errorOf(() => manualReturn(b, t.out.id, c, 20000))).toMatchObject({ field: 'amount' });
  });
  it('entered by hand, then the statement shows the same return: the row is offered as that return\'s own leg (a link), not a second return', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const m = manualReturn(b, t.out.id, c, 20000, b.today, { status: 'pending' });
    const here = m.txs.find((x) => x.accountId === c)!;
    const rv = b.review(c, [['2026-09-12', 'RETURNED PAYMENT', 20000, 100000]]);
    expect(row(rv, 'RETURNED PAYMENT').matchCandidates.map((x) => [x.txId, x.basis])).toEqual([[here.id, 'pending']]);
    b.commit(rv, { 'RETURNED PAYMENT': here.id });
    expect([b.sts(), b.data.transactions.length, b.tx(here.id).status]).toEqual([50000, 4, 'confirmed']);
  });
  it('import undo, then re-import offers the return again', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const r = b.commit(b.review(c, [['2026-09-12', 'RETURNED PAYMENT', 20000, 100000]]), { 'RETURNED PAYMENT': t.out.id });
    b.undo(r.batch.id);
    expect([b.sts(), inTransit(b)]).toEqual([50000, [20000]]);
    expect(row(b.review(c, [['2026-09-12', 'RETURNED PAYMENT', 20000, 100000]]), 'RETURNED PAYMENT').matchCandidates.map((x) => x.basis)).toEqual(['return']);
  });
  it('editing the original payment ($200 → $300 after an $80 return) keeps the return; Phase 4A.7: the payment can be deleted only after its return', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    manualReturn(b, t.out.id, c, 8000);
    b.data = applyOps(b.data, updateTransaction(b.ctx(), t.out.id, { kind: 'transfer', accountId: c, toAccountId: v, date: '2026-09-10', amountCents: 30000, merchant: 'Transfer', categoryId: null, status: 'pending' }).ops);
    // checking 1,000 − 300 + 80 = 780; Visa 500 − 220 = 280 → 500
    expect([b.sts(), inTransit(b)]).toEqual([50000, [22000]]);
    // Phase 4A.7 (supersedes 4A.5.18's cascade): refused, nothing changes; the return is deleted first, then the payment
    expect(() => deleteTransaction(b.ctx(), t.out.id)).toThrow(/can't be deleted while a return is recorded/);
    const ret = b.data.transactions.find((x) => x.returnOf && x.accountId === c)!;
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), ret.id));
    // checking 1,000 − 300 = 700; Visa 500 − 300 in transit = 200 → 500
    expect([b.sts(), inTransit(b)]).toEqual([50000, [30000]]);
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), t.out.id));
    expect([b.sts(), b.data.transactions.length]).toEqual([50000, 0]);
  });
  it('two possible payments (Sep 5, Sep 10) and two cards with the same amount: all listed, closest first; returning the Amex one restores Amex', () => {
    const { b, c, v } = setup();
    const amex = b.acct('Amex', 'credit_card', 30000);
    const p1 = b.transfer(c, v, '2026-09-05', 20000);
    const p2 = b.transfer(c, amex, '2026-09-12', 20000);
    const p3 = b.transfer(c, v, '2026-09-10', 20000);
    expect(options(b, c, 20000).map((m) => m.txId)).toEqual([p2.out.id, p3.out.id, p1.out.id]);
    manualReturn(b, p2.out.id, c, 20000);
    // checking 1,000 − 600 + 200 = 600; Visa 500 − 400 = 100; Amex 300 (returned) → 600 − 400 = 200
    expect(b.sts()).toBe(20000);
  });
  it('an archived card: the return restores its debt → $500', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    b.data = applyOps(b.data, [{ t: 'put', table: 'accounts', value: { ...b.a(v), archived: true } }]);
    manualReturn(b, t.out.id, c, 20000);
    expect(b.sts()).toBe(50000);
  });
  it('the review row confirmed as a return says what is recorded instead of a type and category', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const rv = b.review(c, [['2026-09-12', 'PAYMENT RETURNED', 8000, 100000]]);
    expect(returnRowText(b.live(rv, 'PAYMENT RETURNED')[0]!, b.data)).toBe('Linked as the return of $80.00 of the $200.00 payment to Visa on Sep 10, not imported as income.');
    void t;
  });
});

describe('opening-balance correction', () => {
  it('a pending item from before checking was added that had in fact posted already: the user marks it so → $1,000 (was $800); refused for anything else', () => {
    const b = new Book(); b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    const p = b.add({ kind: 'expense', accountId: c, date: '2026-09-10', amountCents: 20000, merchant: 'Hold', categoryId: null, status: 'pending' })[0]!;
    const q = b.add({ kind: 'expense', accountId: c, date: '2026-09-12', amountCents: 1000, merchant: 'Today', categoryId: null, status: 'pending' })[0]!;
    expect(b.sts()).toBe(79000);
    b.data = applyOps(b.data, markPostedBeforeOpening(b.ctx(), p.id));
    expect([b.sts(), b.posted(c), historyStatus(b.a(c), b.tx(p.id), balanceAsOfDate(b.a(c), b.data.transactions))?.kind]).toEqual([99000, 100000, 'before_opening']);
    expect(errorOf(() => markPostedBeforeOpening(b.ctx(), q.id))).toMatchObject({ field: 'status' });
  });
  it('the statement-link route works too: a row dated before the opening date puts it in the opening balance', () => {
    const b = new Book(); b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    const p = b.add({ kind: 'expense', accountId: c, date: '2026-09-10', amountCents: 20000, merchant: 'Hold', categoryId: null, status: 'pending' })[0]!;
    b.commit(b.review(c, [['2026-09-11', 'HOLD', -20000, 100000]]), { HOLD: p.id });
    expect(b.sts()).toBe(100000);
  });
});

/**
 * Randomized, against an independent model written here (not Clarity's calculations): payments from checking to two
 * cards with independent settlement; full and partial returns, entered by hand or confirmed in a statement import;
 * import undo; postings of either leg. The model:
 *   checking money = 3,000 − every payment + every return
 *   card owed      = opening owed − payments to it + returns of payments to it   (a return restores what it returns)
 *   Safe to Spend  = checking money − Σ max(0, card owed)
 */
it('randomized: full and partial returns, manual and imported, with undo (300 runs)', () => {
  let s = 0; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let actions = 0, partial = 0, manual = 0, imported = 0, undone = 0, refused = 0;
  for (let run = 1; run <= 300; run++) {
    s = run * 9091;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const b = new Book();
    const c = b.acct('Checking', 'checking', 300000);
    const cards = [b.acct('Visa', 'credit_card', pick([20000, 60000])), b.acct('Amex', 'credit_card', pick([0, 40000]))];
    b.at('2026-09-12');
    const owed: Record<ID, number> = Object.fromEntries(cards.map((k) => [k, -b.a(k).openingBalanceCents]));
    let money = 300000;
    const pays: { out: ID; in: ID; card: ID; cents: number; returned: number; batches: { id: ID; cents: number }[] }[] = [];
    for (let st = 0; st < 12; st++) {
      const op = rnd();
      if (op < 0.35 || !pays.length) {
        const card = pick(cards), cents = pick([10000, 20000, 25000]);
        const t = b.transfer(c, card, addDays('2026-09-12', -Math.floor(rnd() * 5)), cents, pick(['pending', 'confirmed'] as const), pick(['pending', 'confirmed'] as const));
        pays.push({ out: t.out.id, in: t.in.id, card, cents, returned: 0, batches: [] });
        money -= cents; owed[card]! -= cents;
      } else if (op < 0.5) {
        const p = pick(pays); b.data = applyOps(b.data, markTransactionPostedLeg(b, rnd() < 0.5 ? p.out : p.in));
      } else if (op < 0.85) {
        const p = pick(pays); const left = p.cents - p.returned;
        if (!left) { expect(errorOf(() => manualReturn(b, p.out, c, 100))).toMatchObject({ field: 'amount' }); refused++; continue; }
        const amt = rnd() < 0.5 ? left : Math.max(100, Math.floor(left * pick([0.25, 0.5]) / 100) * 100);
        if (amt < left) partial++;
        if (rnd() < 0.5) { manualReturn(b, p.out, c, amt); manual++; }
        else {
          const desc = `PAYMENT RETURNED ${run}-${st}`;
          const r = b.commit(b.review(c, [['2026-09-12', desc, amt, 100000]]), { [desc]: p.out });
          p.batches.push({ id: r.batch.id, cents: amt }); imported++;
        }
        p.returned += amt; money += amt; owed[p.card]! += amt;
      } else {
        const p = pays.find((x) => x.batches.length); if (!p) continue;
        const bt = p.batches.pop()!; b.undo(bt.id); undone++;
        p.returned -= bt.cents; money -= bt.cents; owed[p.card]! -= bt.cents;
      }
      actions++;
      expect(b.sts(), `run ${run} step ${st}`).toBe(money - cards.reduce((a, k) => a + Math.max(0, owed[k]!), 0));
    }
  }
  expect([actions > 2500, partial > 100, manual > 200, imported > 200, undone > 30, refused > 5]).toEqual([true, true, true, true, true, true]);
});

function markTransactionPostedLeg(b: Book, id: ID) { return markTransactionPosted(b.ctx(), id); }
