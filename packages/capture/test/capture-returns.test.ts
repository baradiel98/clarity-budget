import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeSafeToSpend, accountBalance } from '@clarity/engine';
import { MemoryAdapter, WorkspaceStore, addTransaction, createAccount, engineInput, onboard, recordPaymentReturn, saveCaptured, type CaptureItem } from '@clarity/data';
import { createNobleProvider } from '@clarity/security/noble';
import type { WorkspaceData } from '@clarity/shared';
import { draftReturnOptions, interpretLocal, parseDrafts, reviewDraft, toCaptureItem, toTxInput, type CaptureContext, type CaptureDraft } from '../src';

/**
 * Phase 4A.7 (audit 4A.6 H1): Clarity Capture recognises a returned card payment the same way the Add form does.
 * Checking $2,000 and Chase Visa owing $300 (opened Nov 1); Savings $500 isn't spendable; no schedules; today Nov 13.
 * A $200 payment Checking → Visa on Nov 10 that Visa hasn't posted: Checking 1,800; Visa 300 with 200 on its way → 100
 * counted → Safe to Spend 1,800 − 100 = $1,700. Its return: Checking 2,000; Visa owes 300 again → $1,700. The same $200
 * saved as income instead would show 2,000 − 100 = $1,900 (the audit defect). Expected values worked out by hand.
 */
const noble = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
const TODAY = '2026-11-13';
const NOW = Date.UTC(2026, 10, 13, 15);

async function workspace() {
  const { store } = await WorkspaceStore.create(new MemoryAdapter(), noble, 'correct horse battery', { withRecoveryKey: false, now: NOW });
  await store.apply(onboard(store.ctx(NOW, '2026-11-01'), { checkingBalanceCents: 200000 }));
  await store.apply(createAccount(store.ctx(NOW, '2026-11-01'), { name: 'Savings', type: 'savings', currentBalanceCents: 50000 }).ops);
  await store.apply(createAccount(store.ctx(NOW, '2026-11-01'), { name: 'Chase Visa', type: 'credit_card', currentBalanceCents: 30000 }).ops);
  return store;
}
const id = (d: WorkspaceData, name: string) => d.accounts.find((a) => a.name === name)!.id;
const ctxOf = (d: WorkspaceData): CaptureContext => ({ today: TODAY, currency: d.settings.baseCurrency, categories: d.categories, accounts: d.accounts, defaultAccountId: d.settings.defaultAccountId, transactions: d.transactions });
const drafts = (text: string, d: WorkspaceData) => interpretLocal(text, ctxOf(d)).drafts.map((x) => ({ ...x, acknowledged: [...x.acknowledged, 'date_assumed' as const, 'account_default' as const] }));
const blocking = (dr: CaptureDraft, d: WorkspaceData) => reviewDraft(dr, ctxOf(d)).filter((i) => i.blocking).map((i) => i.code);
const sts = (s: WorkspaceStore) => computeSafeToSpend(engineInput(s.data, TODAY)).cents;
const bal = (s: WorkspaceStore, name: string) => accountBalance(s.data.accounts.find((a) => a.name === name)!, s.data.transactions, TODAY);
async function pay(s: WorkspaceStore, date = '2026-11-10', cents = 20000, status: 'pending' | 'confirmed' = 'confirmed', toStatus: 'pending' | 'confirmed' = 'pending') {
  const r = addTransaction(s.ctx(NOW, TODAY), { kind: 'transfer', accountId: id(s.data, 'Checking'), toAccountId: id(s.data, 'Chase Visa'), date, amountCents: cents, merchant: 'Payment to Chase Visa', categoryId: null, status, toStatus });
  await s.apply(r.ops);
  return r.txs.find((t) => t.amountCents < 0)!;
}
async function save(s: WorkspaceStore, ds: CaptureDraft[]) {
  const items = ds.map((x) => toCaptureItem(x, ctxOf(s.data)));
  expect(items.every(Boolean)).toBe(true);
  await s.apply(saveCaptured(s.ctx(NOW, TODAY), items as CaptureItem[]).ops);
}

describe('Capture: a captured amount that could be a returned card payment', () => {
  it('full return: flagged and not approvable until decided; confirming it records the return → $1,700 (not $1,900)', async () => {
    const s = await workspace();
    const leg = await pay(s);
    expect(sts(s)).toBe(170000);
    const [d] = drafts('Received $200 today', s.data);
    expect(d!.kind).toBe('income');
    expect(blocking(d!, s.data)).toEqual(['possible_return']);
    expect(toCaptureItem(d!, ctxOf(s.data))).toBeNull(); // unresolved: can't be saved
    expect(draftReturnOptions(d!, ctxOf(s.data)).map((m) => [m.txId, m.returnInfo!.remainingAfterCents])).toEqual([[leg.id, 0]]);
    const chosen = { ...d!, returnChoice: leg.id };
    expect(blocking(chosen, s.data)).toEqual([]);
    await save(s, [chosen]);
    const ret = s.data.transactions.filter((t) => t.returnOf === leg.transferGroupId);
    expect([sts(s), bal(s, 'Checking'), bal(s, 'Chase Visa'), ret.length, ret.find((t) => t.amountCents > 0)!.provenance.source]).toEqual([170000, 200000, -30000, 2, 'capture']);
    expect(s.data.transactions.some((t) => t.kind === 'income')).toBe(false);
  });

  it('partial return ($80 with "reversal" in the words): suggested; recording it → Checking 1,880, $120 still on its way → $1,700', async () => {
    const s = await workspace();
    const leg = await pay(s);
    const [d] = drafts('Got $80 back today, payment reversal', s.data);
    expect(draftReturnOptions(d!, ctxOf(s.data)).map((m) => [m.txId, m.returnInfo!.remainingAfterCents])).toEqual([[leg.id, 12000]]);
    await save(s, [{ ...d!, returnChoice: leg.id }]);
    // Checking 1,800 + 80 = 1,880; Visa 300 − 120 on its way = 180 → 1,700
    expect([sts(s), bal(s, 'Checking')]).toEqual([170000, 188000]);
  });

  it('a partial amount without evidence isn\'t suggested (no question asked), but can be chosen through "every possibility"', async () => {
    const s = await workspace();
    const leg = await pay(s);
    const [d] = drafts('Received $80 today', s.data);
    expect([blocking(d!, s.data), draftReturnOptions(d!, ctxOf(s.data)).length, draftReturnOptions(d!, ctxOf(s.data), true).map((m) => m.txId)]).toEqual([[], 0, [leg.id]]);
    await save(s, [{ ...d!, askReturn: true, returnChoice: leg.id }]);
    expect([sts(s), bal(s, 'Checking')]).toEqual([170000, 188000]);
  });

  it('two possible payments: both listed (closest first); the chosen one is returned and the other still counts → $1,500', async () => {
    const s = await workspace();
    const older = await pay(s, '2026-11-05');
    const newer = await pay(s, '2026-11-10');
    const [d] = drafts('Received $200 today', s.data);
    expect(draftReturnOptions(d!, ctxOf(s.data)).map((m) => m.txId)).toEqual([newer.id, older.id]);
    await save(s, [{ ...d!, returnChoice: older.id }]);
    // Checking 2,000 − 400 + 200 = 1,800; Visa 300 − 200 (the Nov 10 payment) on its way = 100 → 1,700
    expect([sts(s), s.data.transactions.filter((t) => t.returnOf === older.transferGroupId).length, s.data.transactions.filter((t) => t.returnOf === newer.transferGroupId).length]).toEqual([170000, 2, 0]);
  });

  it('genuine income that resembles a return: "separate income" saves it as income with the payment kept on record → $1,900', async () => {
    const s = await workspace();
    const leg = await pay(s);
    const [d] = drafts('Received $200 paycheck today', s.data);
    expect(blocking(d!, s.data)).toEqual(['possible_return']);
    const sep = { ...d!, returnChoice: 'separate' as const };
    expect(toTxInput(sep, ctxOf(s.data))!.provenance).toMatchObject({ source: 'capture', separateFrom: [leg.id] });
    await save(s, [sep]);
    // Checking 1,800 + 200 = 2,000; Visa 300 − 200 on its way = 100 → 1,900 (both are real)
    expect(sts(s)).toBe(190000);
  });

  it('several items in one entry: the return waits for a decision while the others are ready; saving all together is atomic', async () => {
    const s = await workspace();
    const leg = await pay(s);
    const ds = drafts('I spent $12 at Starbucks today and received $200 today', s.data);
    expect(ds.map((x) => [x.kind, blocking(x, s.data)])).toEqual([['expense', []], ['income', ['possible_return']]]);
    // approving only the ready one leaves the other unresolved (nothing about it is saved)
    await save(s, [ds[0]!]);
    expect([sts(s), s.data.transactions.filter((t) => t.provenance.source === 'capture').length]).toEqual([168800, 1]);
    await save(s, [{ ...ds[1]!, returnChoice: leg.id }]);
    // Checking 2,000 − 12 = 1,988; Visa owes 300 → 1,688
    expect(sts(s)).toBe(168800);
  });

  it('editing the draft after choosing: a smaller amount stays a (partial) return; a larger one or another account asks again; a type change drops the question', async () => {
    const s = await workspace();
    const leg = await pay(s);
    const [d] = drafts('Received $200 today', s.data);
    const chosen = { ...d!, returnChoice: leg.id };
    expect(blocking({ ...chosen, amountCents: 15000 }, s.data)).toEqual([]);
    expect(blocking({ ...chosen, amountCents: 25000 }, s.data)).toEqual(['return_unavailable']);
    expect(blocking({ ...chosen, accountId: id(s.data, 'Savings') }, s.data)).toEqual(['return_unavailable']);
    expect(blocking({ ...d!, kind: 'expense', merchant: 'Shop', categoryId: null }, s.data)).not.toContain('possible_return');
    await save(s, [{ ...chosen, amountCents: 15000 }]);
    // Checking 1,800 + 150 = 1,950; Visa 300 − 50 on its way = 250 → 1,700
    expect([sts(s), bal(s, 'Checking')]).toEqual([170000, 195000]);
  });

  it('both settlement orders of the payment (nothing posted / both posted): the captured return → $1,700', async () => {
    for (const [st, to] of [['pending', 'pending'], ['confirmed', 'confirmed'], ['pending', 'confirmed']] as const) {
      const s = await workspace();
      const leg = await pay(s, '2026-11-10', 20000, st, to);
      expect(sts(s), `${st}/${to} before`).toBe(170000);
      const [d] = drafts('Received $200 today', s.data);
      await save(s, [{ ...d!, returnChoice: leg.id }]);
      // Visa posted it → the reversal is owed (100 + 200 = 300); not posted → nothing to reverse, still owes 300
      expect([sts(s), bal(s, 'Chase Visa')], `${st}/${to}`).toEqual([170000, -30000]);
    }
  });

  it('the data layer refuses an undecided captured income even if the screen missed it; and a payment added since the decision (another tab) asks again', async () => {
    const s = await workspace();
    const leg = await pay(s);
    const [d] = drafts('Received $200 paycheck today', s.data);
    const raw = { input: { ...toTxInput({ ...d!, returnChoice: 'separate' }, ctxOf(s.data))!, provenance: { source: 'capture' as const } } };
    expect(() => saveCaptured(s.ctx(NOW, TODAY), [raw])).toThrow(/Item 1: this could be the return of the card payment “Payment to Chase Visa”/);
    // the user said "separate" for the Nov 10 payment; meanwhile another $200 payment was recorded
    const decided = toCaptureItem({ ...d!, returnChoice: 'separate' }, ctxOf(s.data))!;
    await pay(s, '2026-11-12');
    expect(() => saveCaptured(s.ctx(NOW, TODAY), [decided])).toThrow(/could be the return of the card payment/);
    expect(s.data.transactions.filter((t) => t.kind === 'income').length).toBe(0);
    // a return of a payment that has since been fully returned is refused too (nothing saved)
    const ret = toCaptureItem({ ...d!, returnChoice: leg.id }, ctxOf(s.data))!;
    await s.apply(saveCaptured(s.ctx(NOW, TODAY), [ret]).ops);
    expect(() => saveCaptured(s.ctx(NOW, TODAY), [ret])).toThrow(/only \$0\.00 of this \$200\.00 payment is left to return/);
  });

  it('a card payment and an unrelated deposit captured together: no question (the payment is new in this entry) → both saved', async () => {
    const s = await workspace();
    const ds = drafts('Paid $200 toward my credit card today and received $200 today', s.data);
    expect(ds.map((x) => x.kind)).toEqual(['transfer', 'income']);
    const ready = ds.map((x) => (x.kind === 'transfer' ? { ...x, toAccountId: id(s.data, 'Chase Visa') } : x));
    expect(ready.map((x) => blocking(x, s.data))).toEqual([[], []]);
    await save(s, ready);
    // Checking 2,000 − 200 + 200 = 2,000; Visa 300 − 200 on its way = 100 → 1,900
    expect(sts(s)).toBe(190000);
  });

  it('the interpreter can never decide a return: returnChoice in its output is dropped', async () => {
    const s = await workspace();
    const leg = await pay(s);
    const parsed = parseDrafts({ drafts: [{ kind: 'income', amountCents: 20000, date: TODAY, merchant: '', accountId: id(s.data, 'Checking'), returnChoice: leg.id, askReturn: true, sourceText: 'x' }] }, ctxOf(s.data));
    expect(parsed.ok && [parsed.drafts[0]!.returnChoice, parsed.drafts[0]!.askReturn]).toEqual([undefined, undefined]);
    expect(parsed.ok && blocking(parsed.drafts[0]!, s.data)).toContain('possible_return');
  });

  it('Phase 4A.8 (N3): a category chosen on the draft is never saved onto a return; the return equals the Add form\'s apart from source and note', async () => {
    const s1 = await workspace();
    const leg1 = await pay(s1);
    const [d] = drafts('Received $200 today', s1.data);
    const item = toCaptureItem({ ...d!, categoryId: 'cat_paycheck', returnChoice: leg1.id }, ctxOf(s1.data))!;
    expect('paymentReturn' in item && !('categoryId' in item.paymentReturn)).toBe(true);
    const cap = saveCaptured(s1.ctx(NOW, TODAY), [item]);
    // the same return entered in the Add form (recordPaymentReturn, as the form sends it: merchant left empty, posted)
    const s2 = await workspace();
    const leg2 = await pay(s2);
    const add = recordPaymentReturn(s2.ctx(NOW, TODAY), { paymentLegId: leg2.id, accountId: id(s2.data, 'Checking'), amountCents: 20000, date: TODAY, status: 'confirmed', merchant: '' });
    const strip = (t: Record<string, unknown>) => { const { id: _i, transferGroupId: _g, returnOf: _r, createdAt: _c, updatedAt: _u, accountId, provenance: _p, notes: _n, ...rest } = t; return { ...rest, account: accountId === id(s1.data, 'Checking') || accountId === id(s2.data, 'Checking') ? 'Checking' : 'Visa' }; };
    expect(cap.txs.map((t) => strip(t as never))).toEqual(add.txs.map((t) => strip(t as never)));
    expect([cap.txs.map((t) => t.categoryId), cap.txs.map((t) => t.provenance.source), add.txs.map((t) => t.provenance.source)]).toEqual([[null, null], ['capture', 'manual'], ['manual', 'manual']]);
    await s1.apply(cap.ops); await s2.apply(add.ops);
    // both → Checking 2,000, Visa owes 300 → $1,700
    expect([sts(s1), sts(s2)]).toEqual([170000, 170000]);
  });
});
