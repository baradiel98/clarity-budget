import { describe, expect, it } from 'vitest';
import { cardPaymentsInTransit, computeSafeToSpend } from '@clarity/engine';
import { addDays, type ID } from '@clarity/shared';
import { applyOps, adjustBalance, describeImportResult, describeImportUndo, engineInput, markTransactionPosted, previewBalanceUpdate, transferSettlement } from '../src';
import { Book, errorOf, row } from './fixtures/settlement-harness';

/**
 * Phase 4A.5.17: pending transactions dated before an account's opening date (F2) and returned card payments (F1),
 * with the explanation (F3) and card wording (F4). Every expected value is worked out by hand in the comments; today
 * is Sep 12, 2026 unless stated. Truth = each bank's own ledger.
 */
const inTransit = (b: Book) => cardPaymentsInTransit(b.data.accounts, b.data.transactions, b.today);
const why = (b: Book) => computeSafeToSpend(engineInput(b.data, b.today)).explanation.lines;

describe('F2: the opening balance is the POSTED balance; pending items dated before it still count', () => {
  it('E2 (audit): checking added Sep 12 at $1,000 posted; Visa owes $500; a $200 payment made Sep 10, pending at both → $500 (was $700)', () => {
    const b = new Book();
    const v = b.acct('Visa', 'credit_card', 50000);
    b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    b.transfer(c, v, '2026-09-10', 20000);
    // checking 1,000 − 200 pending = 800; Visa 500 − 200 on its way = 300 → 500
    expect([b.sts(), b.rec(c), b.posted(c), b.rec(v)]).toEqual([50000, 80000, 100000, -30000]);
  });
  it('E1 (audit): Visa added Sep 12 owing $500 posted; a $200 payment made Sep 10, pending at both → $500 (was $300)', () => {
    const b = new Book();
    const c = b.acct('Checking', 'checking', 100000);
    b.at('2026-09-12');
    const v = b.acct('Visa', 'credit_card', 50000);
    b.transfer(c, v, '2026-09-10', 20000);
    expect([b.sts(), b.rec(v), b.posted(v), inTransit(b).length]).toEqual([50000, -30000, -50000, 1]);
  });
  it('a pending purchase dated before the account was added reduces it ($800, was $1,000); it keeps counting after it posts', () => {
    const b = new Book(); b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    const p = b.add({ kind: 'expense', accountId: c, date: '2026-09-10', amountCents: 20000, merchant: 'Card hold', categoryId: null, status: 'pending' })[0]!;
    expect([b.sts(), b.posted(c)]).toEqual([80000, 100000]); // the bank's posted $1,000 doesn't include it yet
    b.data = applyOps(b.data, markTransactionPosted(b.ctx(), p.id));
    expect([b.sts(), b.posted(c), b.tx(p.id).postedDate]).toEqual([80000, 80000, '2026-09-12']);
  });
  it('a pending credit dated before the account was added is not spendable ($1,000) until it posts ($1,100); a pending incoming transfer likewise', () => {
    const b = new Book(); b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    const s = b.acct('Savings', 'savings', 50000);
    const r = b.add({ kind: 'refund', accountId: c, date: '2026-09-09', amountCents: 10000, merchant: 'Store refund', categoryId: null, status: 'pending' })[0]!;
    const t = b.transfer(s, c, '2026-09-10', 5000);
    expect(b.sts()).toBe(100000);
    b.data = applyOps(b.data, markTransactionPosted(b.ctx(), r.id));
    b.data = applyOps(b.data, markTransactionPosted(b.ctx(), t.in.id));
    expect(b.sts()).toBe(115000);
  });
  it('a POSTED transaction dated before the account was added is in the opening balance: not counted again; labelled with the reason', () => {
    const b = new Book(); b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    b.add({ kind: 'expense', accountId: c, date: '2026-09-10', amountCents: 20000, merchant: 'Groceries', categoryId: null });
    expect([b.sts(), b.rec(c)]).toEqual([100000, 100000]);
  });
  it('linking a statement row: posted on/after the opening date → counts; posted before it → it was in the opening balance', () => {
    for (const [rowDate, expected] of [['2026-09-13', 80000], ['2026-09-11', 100000]] as const) {
      const b = new Book(); b.at('2026-09-12');
      const c = b.acct('Checking', 'checking', 100000);
      const p = b.add({ kind: 'expense', accountId: c, date: '2026-09-10', amountCents: 20000, merchant: 'Hold', categoryId: null, status: 'pending' })[0]!;
      b.at('2026-09-14');
      b.commit(b.review(c, [[rowDate, 'HOLD 22', -20000, rowDate === '2026-09-13' ? 80000 : 100000]]), { 'HOLD 22': p.id });
      expect(b.rec(c), rowDate).toBe(expected);
    }
  });
  it('Update balance: entering the bank\'s posted $1,000 matches (no adjustment, nothing counted twice); $800 is flagged as the pending item', () => {
    const b = new Book(); b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    b.add({ kind: 'expense', accountId: c, date: '2026-09-10', amountCents: 20000, merchant: 'Hold', categoryId: null, status: 'pending' });
    expect(adjustBalance(b.ctx(), c, 100000, 'x', b.today).tx).toBeNull();
    const p = previewBalanceUpdate(b.data, c, 80000, b.today);
    expect([p.differenceCents, p.matches.map((m) => m.map((t) => t.merchant))]).toEqual([-20000, [['Hold']]]);
  });
  it('statement reconciliation compares posted with posted: the pending pre-opening item is left out', () => {
    const b = new Book(); b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    b.add({ kind: 'expense', accountId: c, date: '2026-09-10', amountCents: 20000, merchant: 'Hold', categoryId: null, status: 'pending' });
    b.at('2026-09-13');
    const r = b.commit(b.review(c, [['2026-09-13', 'COFFEE', -500, 99500]]), { COFFEE: 'none' });
    expect(r.recon!.differenceCents).toBe(0);
  });
  it('an archived account and several accounts follow the same rule', () => {
    const b = new Book(); b.at('2026-09-12');
    const c = b.acct('Checking', 'checking', 100000);
    const w = b.acct('Wallet', 'cash', 20000);
    const old = b.acct('Old checking', 'checking', 1000);
    b.add({ kind: 'expense', accountId: w, date: '2026-09-11', amountCents: 5000, merchant: 'Hold', categoryId: null, status: 'pending' });
    b.add({ kind: 'expense', accountId: old, date: '2026-09-11', amountCents: 6000, merchant: 'Old hold', categoryId: null, status: 'pending' });
    b.data = applyOps(b.data, [{ t: 'put', table: 'accounts', value: { ...b.a(old), archived: true } }]);
    // checking 1,000 + wallet 200 − 50 = 1,150; Old: 10 − 60 = −50, still owed → 1,100
    expect(b.sts()).toBe(110000);
    void c;
  });
});

/** F1: Checking $1,000, Visa owes $500, today Sep 12. */
const setup = () => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', 100000);
  const v = b.acct('Visa', 'credit_card', 50000);
  b.at('2026-09-12');
  return { b, c, v };
};
const STMT = (): Parameters<Book['review']>[1] => [['2026-09-10', 'VISA PAYMENT', -20000, 80000], ['2026-09-12', 'RETURNED PAYMENT VISA', 20000, 100000]];

describe('F1: a returned card payment', () => {
  it('the return row lists the payment, is never selected by default, and can\'t be imported without a decision', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const rv = b.review(c, STMT());
    const ret = row(rv, 'RETURNED PAYMENT VISA');
    expect([ret.include, ret.matchCandidates.map((m) => [m.txId, m.basis])]).toEqual([false, [[t.out.id, 'return']]]);
    expect(errorOf(() => b.commit(rv, { 'VISA PAYMENT': t.out.id, 'RETURNED PAYMENT VISA': 'auto' }))).toMatchObject({ field: 'match' });
  });
  it('the audit case: link the debit, confirm the return → checking posted $1,000, Visa owes $500, $500, not income, no longer in transit (was $700)', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const r = b.commit(b.review(c, STMT()), { 'VISA PAYMENT': t.out.id, 'RETURNED PAYMENT VISA': t.out.id });
    const ret = r.txs.find((x) => x.returnOf && x.accountId === c)!;
    expect([b.sts(), b.posted(c), b.rec(v), inTransit(b).length, ret.kind, ret.amountCents, r.recon!.differenceCents]).toEqual([50000, 100000, -50000, 0, 'transfer', 20000, 0]);
    expect([b.tx(t.in.id).status, b.tx(t.out.id).status]).toEqual(['pending', 'confirmed']); // the card side was never posted automatically
    expect(describeImportResult(r.batch)).toBe('0 new transactions imported · 1 existing transaction linked (1 marked posted) · 1 returned card payment recorded');
    expect([transferSettlement(b.tx(t.out.id), b.data.transactions, b.data.accounts), transferSettlement(ret, b.data.transactions, b.data.accounts)]).toEqual(['Payment returned', 'Returned card payment']);
    expect(why(b).some((l) => /not yet posted by the card issuer/.test(l.label))).toBe(false);
  });
  it('the old behaviour stays possible only as an explicit choice: "a different transaction" imports it as income (correct when it really is separate) → $700', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    b.commit(b.review(c, STMT()), { 'VISA PAYMENT': t.out.id, 'RETURNED PAYMENT VISA': 'none' });
    // checking 1,000 − 200 + 200 = 1,000; the payment is still on its way: Visa 300 → 700
    expect([b.sts(), inTransit(b).length]).toEqual([70000, 1]);
  });
  it('returned before either side posted (only the return row imported): $500', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    b.commit(b.review(c, [['2026-09-12', 'RETURNED PAYMENT', 20000, 120000]]), { 'RETURNED PAYMENT': t.out.id });
    // checking 1,000 − 200 (pending) + 200 (returned) = 1,000; Visa: the payment and its return cancel → 500
    expect([b.sts(), b.rec(v), b.tx(t.out.id).status]).toEqual([50000, -50000, 'pending']);
  });
  it('returned after the card issuer posted it: the return\'s card side awaits the reversal; linking it from the card statement → $500 throughout', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-08', 20000, 'confirmed', 'confirmed');
    const r = b.commit(b.review(c, [['2026-09-12', 'RETURNED PAYMENT', 20000, 100000]]), { 'RETURNED PAYMENT': t.out.id });
    const back = r.txs.find((x) => x.returnOf && x.accountId === v)!;
    expect([b.sts(), b.rec(v), back.status]).toEqual([50000, -50000, 'pending']);
    const cv = b.review(v, [['2026-09-11', 'GROCER', -1000, -31000], ['2026-09-12', 'PAYMENT REVERSAL', -20000, -51000]]);
    expect(b.live(cv, 'PAYMENT REVERSAL').map((m) => m.txId)).toEqual([back.id]);
    b.commit(cv, { GROCER: 'skip', 'PAYMENT REVERSAL': back.id });
    expect([b.sts(), b.rec(v), b.posted(v)]).toEqual([50000, -50000, -50000]);
  });
  it('the card statement first (payment posted, then reversed): the return is recorded from the card side; checking awaits the money ($300) until its own statement shows it ($500)', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-08', 20000);
    const r = b.commit(b.review(v, [['2026-09-09', 'PAYMENT THANK YOU', 20000, -30000], ['2026-09-11', 'PAYMENT RETURNED', -20000, -50000]]), { 'PAYMENT THANK YOU': t.in.id, 'PAYMENT RETURNED': t.in.id });
    const here = r.txs.find((x) => x.returnOf && x.accountId === c)!;
    // checking: −200 pending + 200 pending (not spendable yet) = 800; Visa owes 500 → 300 (the checking bank hasn't returned it yet)
    expect([b.sts(), here.status]).toEqual([30000, 'pending']);
    b.commit(b.review(c, [['2026-09-08', 'VISA PAYMENT', -20000, 80000], ['2026-09-12', 'RETURN VISA PMT', 20000, 100000]]), { 'VISA PAYMENT': t.out.id, 'RETURN VISA PMT': here.id });
    expect([b.sts(), b.posted(c)]).toEqual([50000, 100000]);
  });
  it('two payments of the same amount: both are listed (ambiguous); the user picks the one that was returned', () => {
    const { b, c, v } = setup();
    const a1 = b.transfer(c, v, '2026-09-05', 20000);
    const a2 = b.transfer(c, v, '2026-09-10', 20000);
    const rv = b.review(c, [['2026-09-12', 'RETURNED PAYMENT', 20000, 100000]]);
    expect(row(rv, 'RETURNED PAYMENT').matchCandidates.map((m) => [m.txId, m.basis])).toEqual([[a2.out.id, 'return'], [a1.out.id, 'return']]);
    b.commit(rv, { 'RETURNED PAYMENT': a1.out.id });
    // checking 1,000 − 400 + 200 = 800; Visa 500 − 200 (a2 still on its way) = 300 → 500
    expect([b.sts(), inTransit(b).map((p) => p.txId)]).toEqual([50000, [a2.in.id]]);
  });
  it('re-importing the statement: the return is recognised; nothing is restored twice', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    b.commit(b.review(c, STMT()), { 'VISA PAYMENT': t.out.id, 'RETURNED PAYMENT VISA': t.out.id });
    const again = b.review(c, STMT());
    expect(again.preview.candidates.map((x) => x.duplicate?.level)).toEqual(['exact', 'exact']);
    b.commit(again);
    expect([b.sts(), b.data.transactions.length]).toEqual([50000, 4]);
  });
  it('undo removes only the return (the payment is on its way again, $700 with the linked debit undone too → back to $500); re-import offers it again', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const r = b.commit(b.review(c, STMT()), { 'VISA PAYMENT': t.out.id, 'RETURNED PAYMENT VISA': t.out.id });
    expect(describeImportUndo(b.data, r.batch.id)).toMatch(/the returned card payment is no longer recorded, so that payment counts as paying the card again/);
    b.undo(r.batch.id);
    expect([b.sts(), b.data.transactions.length, inTransit(b).length, b.tx(t.out.id).status]).toEqual([50000, 2, 1, 'pending']);
    expect(row(b.review(c, STMT()), 'RETURNED PAYMENT VISA').matchCandidates.map((m) => m.basis)).toEqual(['return']);
  });
  it('a partial payment and another to a second card; only the returned one stops counting', () => {
    const { b, c, v } = setup();
    const amex = b.acct('Amex', 'credit_card', 30000);
    const p1 = b.transfer(c, v, '2026-09-12', 10000);
    b.transfer(c, amex, '2026-09-12', 30000, 'confirmed', 'pending');
    b.commit(b.review(c, [['2026-09-12', 'PAYMENT RETURNED', 10000, 110000]]), { 'PAYMENT RETURNED': p1.out.id });
    // checking 1,000 − 100 − 300 + 100 = 700; Visa 500 (returned); Amex 300 − 300 on its way = 0 → 200
    expect(b.sts()).toBe(20000);
  });
  it('a same-day return: payment and return both on Sep 12 → $500', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-12', 20000);
    b.commit(b.review(c, [['2026-09-12', 'VISA PMT', -20000, 80000], ['2026-09-12', 'VISA PMT RETURN', 20000, 100000]]), { 'VISA PMT': t.out.id, 'VISA PMT RETURN': t.out.id });
    expect(b.sts()).toBe(50000);
  });
  it('not a return candidate: a deposit of a different amount, before the payment, more than 30 days later, or for a transfer between two bank accounts', () => {
    const { b, c, v } = setup();
    const s = b.acct('Savings', 'savings', 50000);
    b.transfer(c, v, '2026-09-10', 20000);
    b.transfer(c, s, '2026-09-10', 15000);
    for (const [d, a] of [['2026-09-12', 19000], ['2026-09-09', 20000], [addDays('2026-09-10', 31), 20000], ['2026-09-12', 15000]] as const) {
      b.at(d > '2026-09-12' ? d : '2026-09-12');
      const rv = b.review(c, [[d, 'RETURNED PAYMENT', a, 100000]]);
      expect(row(rv, 'RETURNED PAYMENT').matchCandidates.filter((m) => m.basis === 'return'), `${d} ${a}`).toEqual([]);
    }
  });
  it('a stale commit is refused: the payment returned in another review first', () => {
    const { b, c, v } = setup();
    const t = b.transfer(c, v, '2026-09-10', 20000);
    const rv1 = b.review(c, [['2026-09-12', 'RETURNED PAYMENT', 20000, 100000]]);
    const rv2 = b.review(c, [['2026-09-12', 'PMT RETURNED', 20000, 100000]]);
    const d2 = b.decisions(rv2, { 'PMT RETURNED': t.out.id });
    b.commit(rv1, { 'RETURNED PAYMENT': t.out.id });
    expect(['match', 'stale']).toContain((errorOf(() => b.commit(rv2, {}, { decisions: d2 })) as { field: string }).field);
    expect(b.data.transactions.filter((x) => x.returnOf).length).toBe(2);
  });
});

describe('F3/F4: explanation and wording', () => {
  it('"Why this number?" says what to do if the payment is returned; card payments say "awaiting posting by Visa", bank transfers still "awaiting deposit"', () => {
    const { b, c, v } = setup();
    const s = b.acct('Savings', 'savings', 0);
    const t = b.transfer(c, v, '2026-09-10', 20000, 'confirmed', 'pending');
    const u = b.transfer(c, s, '2026-09-10', 5000, 'confirmed', 'pending');
    const l = why(b).find((x) => x.label === 'Visa: $200.00 payment from Checking not yet posted by the card issuer')!;
    expect(l.note).toMatch(/If it's returned or rejected: when the returned money shows on a statement, choose "It's the return of this card payment" in the import review \(not a separate deposit\), and the card debt is counted in full again; if the money never left Checking, delete the payment$/);
    expect([transferSettlement(b.tx(t.out.id), b.data.transactions, b.data.accounts), transferSettlement(b.tx(t.in.id), b.data.transactions, b.data.accounts)]).toEqual(['Sent · awaiting posting by Visa', 'Sent from Checking · awaiting posting by Visa']);
    expect([transferSettlement(b.tx(u.out.id), b.data.transactions, b.data.accounts), transferSettlement(b.tx(u.in.id), b.data.transactions, b.data.accounts)]).toEqual(['Sent · awaiting deposit in Savings', 'Sent from Checking · awaiting deposit']);
  });
});

/**
 * Randomized, against an independent model (written here from the banks' side; it doesn't call Clarity's
 * calculations): checking and two cards, one card added on Sep 12 after some payments were made (so pending items
 * dated before its opening date occur), card payments from checking with independent settlement, some returned via a
 * checking statement row (the user confirms the return), some imports undone and statements re-imported.
 *   checking money = 3,000 + every recorded checking item (pending or posted) + returned money posted
 *   card owed      = opening owed − payments not in the opening balance (a payment the issuer posted before the
 *                    card was added is already in it) + every returned payment (the card owes it again)
 *   Safe to Spend  = checking money − Σ max(0, card owed)
 */
it('randomized: pending opening-date items and returned card payments (300 runs)', () => {
  let s = 0; const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let actions = 0, returns = 0, undos = 0, reimports = 0;
  for (let run = 1; run <= 300; run++) {
    s = run * 4447;
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    const b = new Book();
    const c = b.acct('Checking', 'checking', 300000);
    const visa = b.acct('Visa', 'credit_card', pick([20000, 60000]));
    b.at('2026-09-12');
    const amex = b.acct('Amex', 'credit_card', pick([0, 40000])); // added today: earlier-dated items are before its opening
    const cards = [visa, amex];
    const owed: Record<ID, number> = { [visa]: -b.a(visa).openingBalanceCents, [amex]: -b.a(amex).openingBalanceCents };
    let money = 300000;
    const pays: { out: ID; in: ID; card: ID; cents: number; date: string; inOpening: boolean; returned: boolean; batch?: ID }[] = [];
    const expect$ = (m: string) => expect(b.sts(), `run ${run}: ${m}`).toBe(money - cards.reduce((a, k) => a + Math.max(0, owed[k]!), 0));
    for (let st = 0; st < 10; st++) {
      const op = rnd();
      if (op < 0.4) {
        const card = pick(cards), cents = pick([5000, 10000, 20000]), date = addDays('2026-09-12', -Math.floor(rnd() * 6));
        const so = pick(['pending', 'confirmed'] as const), si = pick(['pending', 'confirmed'] as const);
        const t = b.transfer(c, card, date, cents, so, si);
        const inOpening = card === amex && date < '2026-09-12' && si === 'confirmed';
        pays.push({ out: t.out.id, in: t.in.id, card, cents, date, inOpening, returned: false });
        money -= cents; if (!inOpening) owed[card]! -= cents;
      } else if (op < 0.6) {
        const live = pays.filter((p) => !p.returned); if (!live.length) continue;
        const p = pick(live); b.data = applyOps(b.data, markTransactionPosted(b.ctx(), rnd() < 0.5 ? p.out : p.in));
      } else if (op < 0.85) {
        const live = pays.filter((p) => !p.returned); if (!live.length) continue;
        const p = pick(live);
        const rv = b.review(c, [['2026-09-12', `RETURNED PAYMENT ${st}`, p.cents, 100000]]);
        const r = b.commit(rv, { [`RETURNED PAYMENT ${st}`]: p.out });
        p.returned = true; p.batch = r.batch.id; returns++;
        // the returned money is back in checking; the card owes it again, even when the payment was already inside its
        // opening balance (the issuer reverses it)
        money += p.cents; owed[p.card]! += p.cents;
        if (rnd() < 0.3) { b.commit(b.review(c, [['2026-09-12', `RETURNED PAYMENT ${st}`, p.cents, 100000]])); reimports++; }
      } else {
        const done = pays.filter((p) => p.returned && p.batch); if (!done.length) continue;
        const p = pick(done); b.undo(p.batch!); p.returned = false; p.batch = undefined; undos++;
        money -= p.cents; owed[p.card]! -= p.cents;
      }
      actions++;
      expect$(`step ${st}`);
    }
  }
  expect([actions > 2000, returns > 300, undos > 50, reimports > 50]).toEqual([true, true, true, true]);
});
