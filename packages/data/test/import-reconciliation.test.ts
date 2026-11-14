import { describe, expect, it } from 'vitest';
import { accountBalance, computeSafeToSpend, historyStatus, balanceAsOfDate } from '@clarity/engine';
import { buildPreview, csvParser, guessMapping, reconcilePreview, suggestSignConvention, type ImportCandidate, type ReconciliationPreview } from '@clarity/import';
import type { WorkspaceData } from '@clarity/shared';
import {
  addTransaction, adjustBalance, applyOps, CommandError, commitImport, createAccount, defaultSettings, deleteTransaction, emptyWorkspace, engineInput,
  markTransactionPosted, previewBalanceUpdate, updateTransaction, type Ctx, type TxInput,
} from '../src';

/**
 * Phase 4A.5.9: statement import uses the same posted-balance convention as onboarding, a new account and Update
 * balance; pending items that cleared are recognised, never posted automatically; partial matches; transfers.
 * Checking opened Sep 1 at $1,000.00; today Sep 12, 2026. Expected values by hand ("truth" = the bank).
 */
const NOW = Date.UTC(2026, 8, 12, 12);
let seq = 0;
const H = 'Date,Description,Amount,Balance\n';
class W {
  data: WorkspaceData = emptyWorkspace(defaultSettings(NOW));
  today = '2026-09-01';
  ctx = (): Ctx => ({ data: this.data, now: NOW, today: this.today, newId: (p) => `${p}_${++seq}` });
  at(d: string) { this.today = d; return this; }
  acct(name: string, type: 'checking' | 'savings', cents: number) { const r = createAccount(this.ctx(), { name, type, currentBalanceCents: cents }); this.data = applyOps(this.data, r.ops); return r.account.id; }
  add(i: TxInput) { const r = addTransaction(this.ctx(), i); this.data = applyOps(this.data, r.ops); return r.txs; }
  post(id: string) { this.data = applyOps(this.data, markTransactionPosted(this.ctx(), id)); }
  adjust(id: string, cents: number, opts: { unrelatedToPending?: boolean } = {}) { const r = adjustBalance(this.ctx(), id, cents, 'Matched bank', this.today, opts); this.data = applyOps(this.data, r.ops); return r.tx; }
  a(id: string) { return this.data.accounts.find((x) => x.id === id)!; }
  rec(id: string) { return accountBalance(this.a(id), this.data.transactions, this.today); }
  sts() { return computeSafeToSpend(engineInput(this.data, this.today)).cents; }
  /** The review: rows as the import selects them by default (unless `pick` overrides), and the balance check. */
  review(accountId: string, csv: string, pick?: (c: ImportCandidate) => boolean) {
    const table = csvParser.parse(csv);
    const g = guessMapping(table);
    const base = { hasHeader: g.hasHeader, columns: g.columns!, dateFormat: g.dateFormats[0]!, decimalSeparator: g.decimalSeparator };
    const settings = { ...base, signConvention: suggestSignConvention(table, base, this.a(accountId)).convention };
    const preview = buildPreview(table, settings, { account: this.a(accountId), accounts: this.data.accounts, transactions: this.data.transactions, recurring: [], exceptions: [], importBatches: this.data.importBatches, fileHash: csv, today: this.today });
    const chosen = () => preview.candidates.filter(pick ?? ((c) => c.include));
    const recon = () => reconcilePreview(preview, chosen(), { account: this.a(accountId), transactions: this.data.transactions })!;
    return { preview, settings, chosen, recon };
  }
  commit(accountId: string, r: ReturnType<W['review']>, opts: { applyAdjustment?: boolean; unrelated?: boolean; other?: Record<string, string> } = {}) {
    const res = commitImport(this.ctx(), {
      accountId, fileName: 'statement.csv', fileHash: String(++seq), parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: r.settings,
      decisions: r.chosen().map((c) => ({ candidate: c, kind: opts.other?.[c.rawDescription] ? 'transfer' : c.kind, categoryId: null, merchant: c.merchant, linkOccurrence: false, ...(opts.other?.[c.rawDescription] ? { otherAccountId: opts.other[c.rawDescription]! } : {}) })),
      totalRows: 0, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: r.recon(), applyAdjustment: opts.applyAdjustment ?? true, adjustmentUnrelatedToPending: opts.unrelated,
    });
    this.data = applyOps(this.data, res.ops);
    return res;
  }
}
const setup = () => { const w = new W(); const c = w.acct('Checking', 'checking', 100000); w.at('2026-09-12'); return { w, c }; };
const pendingDeposit = (w: W, c: string, cents: number, date = '2026-09-05', merchant = 'Store return') => w.add({ kind: 'income', accountId: c, date, amountCents: cents, merchant, categoryId: null, status: 'pending' })[0]!;
const pendingPurchase = (w: W, c: string, cents: number, date = '2026-09-05', merchant = 'Groceries run') => w.add({ kind: 'expense', accountId: c, date, amountCents: cents, merchant, categoryId: null, status: 'pending' })[0]!;
const names = (r: ReconciliationPreview) => [...(r.pendingMatches ?? []).flat(), ...(r.pendingPartial ?? [])].map((t) => t.merchant);
const errorOf = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof CommandError ? e.issues[0]! : e; } };

describe('statement import: pending items are never counted twice', () => {
  it('a pending deposit NOT on the statement: the statement matches the posted balance; no adjustment; $990 spendable, $1,290 once it posts (was $690, then $990)', () => {
    const { w, c } = setup();
    const dep = pendingDeposit(w, c, 30000);
    const r = w.review(c, H + '09/06/2026,COFFEE,-10.00,990.00\n');
    expect([r.recon().appBalanceCents, r.recon().differenceCents, names(r.recon())]).toEqual([99000, 0, []]);
    w.commit(c, r);
    expect([w.rec(c), w.sts()]).toEqual([129000, 99000]);
    w.post(dep.id);
    expect([w.rec(c), w.sts()]).toEqual([129000, 129000]);
  });
  it('a pending purchase NOT on the statement stays counted: $870 before and after it posts (was $990: a +$120 adjustment cancelled it)', () => {
    const { w, c } = setup();
    const p = pendingPurchase(w, c, 12000);
    const r = w.review(c, H + '09/06/2026,COFFEE,-10.00,990.00\n');
    expect(r.recon().differenceCents).toBe(0);
    w.commit(c, r);
    expect(w.sts()).toBe(87000);
    w.post(p.id);
    expect([w.rec(c), w.sts()]).toEqual([87000, 87000]);
  });
  it('a pending deposit that cleared (on the statement 4 days later, bank\'s own description): the row is flagged and left out; the difference names the deposit; Mark posted → $1,290, one deposit, no adjustment', () => {
    const { w, c } = setup();
    const dep = pendingDeposit(w, c, 30000);
    const r = w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1290.00\n09/06/2026,COFFEE,-10.00,990.00\n');
    const row = r.preview.candidates.find((x) => x.rawDescription === 'AMAZON REFUND')!;
    expect([row.include, row.duplicate?.txId, row.duplicate?.reason]).toEqual([false, dep.id, 'Same amount as “Store return”, still pending in Clarity (Sep 5). If this row is that transaction clearing, leave it out and mark “Store return” posted instead, so it isn\'t counted twice.']);
    expect([r.recon().differenceCents, names(r.recon())]).toEqual([30000, ['Store return']]);
    expect(errorOf(() => w.commit(c, r))).toMatchObject({ field: 'pending_match' }); // nothing posted automatically
    expect(w.data.transactions.find((t) => t.id === dep.id)!.status).toBe('pending');
    w.post(dep.id);
    expect(r.recon().differenceCents).toBe(0);
    w.commit(c, r);
    expect([w.rec(c), w.sts(), w.data.transactions.filter((t) => t.amountCents === 30000).length, w.data.transactions.filter((t) => t.kind === 'adjustment').length]).toEqual([129000, 129000, 1, 0]);
  });
  it('a pending purchase that cleared: the same; Mark posted → $870, one purchase, no adjustment', () => {
    const { w, c } = setup();
    const p = pendingPurchase(w, c, 12000);
    const r = w.review(c, H + '09/08/2026,POS SHOP 1234,-120.00,870.00\n09/06/2026,COFFEE,-10.00,990.00\n');
    expect([r.recon().differenceCents, names(r.recon())]).toEqual([-12000, ['Groceries run']]);
    w.post(p.id);
    w.commit(c, r);
    expect([w.rec(c), w.sts(), w.data.transactions.filter((t) => t.amountCents === -12000).length]).toEqual([87000, 87000, 1]);
  });
  it('the user includes the flagged row anyway (review is theirs): the difference is $0, but the pending one is named in the review; confirmed unrelated, nothing is changed', () => {
    const { w, c } = setup();
    pendingDeposit(w, c, 30000);
    const r = w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1290.00\n09/06/2026,COFFEE,-10.00,990.00\n', () => true);
    expect(r.recon().differenceCents).toBe(0); // 1,000 + 300 − 10 = 1,290 posted; the pending deposit is still separate
    w.commit(c, r);
    expect([w.rec(c), w.sts()]).toEqual([159000, 129000]); // spendable right; the pending one must not be posted later: its row says so
  });
  it('several pending items: $300 cleared (left out, named), $200 deposit and $50 purchase still pending; Mark posted → reconciles; spendable $1,240', () => {
    const { w, c } = setup();
    const d300 = pendingDeposit(w, c, 30000);
    pendingDeposit(w, c, 20000, '2026-09-06', 'Gift');
    pendingPurchase(w, c, 5000, '2026-09-07', 'Pharmacy');
    const r = w.review(c, H + '09/08/2026,TRANSFER IN,300.00,1290.00\n09/06/2026,COFFEE,-10.00,990.00\n');
    const rc = r.recon();
    expect([rc.differenceCents, (rc.pendingMatches ?? []).map((s) => s.map((t) => t.merchant)), (rc.pendingPartial ?? []).map((t) => t.merchant)]).toEqual([30000, [['Store return']], ['Gift']]);
    w.post(d300.id);
    w.commit(c, r);
    // recorded 1,000 + 300 + 200 (pending) − 50 (pending) − 10 = 1,440; spendable = 1,440 − 200 pending deposit = 1,240
    expect([w.rec(c), w.sts()]).toEqual([144000, 124000]);
  });
  it('importing the same statement again and updating the balance again change nothing', () => {
    const { w, c } = setup();
    const csv = H + '09/08/2026,SHOP,-20.00,970.00\n09/06/2026,COFFEE,-10.00,990.00\n';
    w.commit(c, w.review(c, csv));
    const n = w.data.transactions.length;
    const again = w.review(c, csv);
    expect(again.preview.candidates.every((x) => x.duplicate?.level === 'exact' && !x.include)).toBe(true);
    expect(again.recon().differenceCents).toBe(0);
    w.commit(c, again);
    expect([w.data.transactions.length, w.rec(c)]).toEqual([n, 97000]);
    expect(w.adjust(c, 97000)).toBeNull();
    expect(w.adjust(c, 97000)).toBeNull();
    expect([w.data.transactions.length, w.sts()]).toEqual([n, 97000]);
  });
  it('a statement that ends before the confirmed balance date is not used to adjust (even if asked)', () => {
    const { w, c } = setup();
    w.at('2026-09-10');
    expect(w.adjust(c, 99000)!.amountCents).toBe(-1000); // confirmed Sep 10 (a $10 coffee wasn't recorded)
    w.at('2026-09-12');
    const r = w.review(c, H + '09/06/2026,COFFEE,-10.00,990.00\n09/04/2026,SHOP,-20.00,1000.00\n');
    expect([r.recon().differenceCents, r.recon().note]).toEqual([0, 'The statement ends on Sep 6, before this account’s confirmed balance (Sep 10), so its ending balance isn’t used to adjust it.']);
    w.commit(c, r, { applyAdjustment: true });
    expect([w.rec(c), w.data.transactions.filter((t) => t.kind === 'adjustment').length]).toEqual([99000, 1]); // rows are history
  });
  it('a statement across the confirmed date: rows before it are history (labelled), rows after it count; it reconciles', () => {
    const { w, c } = setup();
    w.at('2026-09-07');
    w.adjust(c, 99000); // −$10: the Sep 6 coffee
    w.at('2026-09-12');
    const r = w.review(c, H + '09/09/2026,SHOP,-20.00,970.00\n09/06/2026,COFFEE,-10.00,990.00\n');
    expect(r.preview.candidates.find((x) => x.rawDescription === 'COFFEE')!.reasons.join(' ')).toMatch(/Before this account’s confirmed balance \(Sep 7\)/);
    expect(r.recon().differenceCents).toBe(0); // 1,000 − 10 (adjustment) − 20 = 970
    w.commit(c, r);
    const coffee = w.data.transactions.find((t) => t.merchant.toUpperCase().includes('COFFEE'))!;
    expect([w.rec(c), historyStatus(w.a(c), coffee, balanceAsOfDate(w.a(c), w.data.transactions))]).toEqual([97000, { kind: 'included', asOf: '2026-09-07' }]);
  });
  it('a transfer row: each leg follows its own account\'s confirmed date (savings confirmed after the transfer already has it)', () => {
    const { w, c } = setup();
    w.at('2026-09-01');
    const s = w.acct('Savings', 'savings', 50000);
    w.at('2026-09-10');
    expect(w.adjust(s, 60000)!.amountCents).toBe(10000); // the Sep 9 transfer arrived; savings confirmed Sep 10
    w.at('2026-09-12');
    const r = w.review(c, H + '09/09/2026,TRANSFER TO SAVINGS,-100.00,900.00\n', () => true);
    w.commit(c, r, { other: { 'TRANSFER TO SAVINGS': s } });
    const legs = w.data.transactions.filter((t) => t.transferGroupId);
    expect(legs.map((l) => [l.accountId === c ? 'chk' : 'sav', l.amountCents, !!l.includedInBalance])).toEqual([['chk', -10000, false], ['sav', 10000, true]]);
    expect([w.rec(c), w.rec(s)]).toEqual([90000, 60000]); // not 700: the +100 is in savings' confirmed balance already
  });
});

describe('partial matches in Update balance (Phase 4A.5.9)', () => {
  it('a $300 pending deposit and a +$200 difference: named as possibly part of it; recording requires confirmation; the deposit stays pending', () => {
    const { w, c } = setup();
    const d = pendingDeposit(w, c, 30000);
    const p = previewBalanceUpdate(w.data, c, 120000, w.today);
    expect([p.differenceCents, p.matches, p.partial.map((t) => t.id)]).toEqual([20000, [], [d.id]]);
    expect(errorOf(() => w.adjust(c, 120000))).toMatchObject({ field: 'pending_match', message: expect.stringMatching(/^Part of the difference \(\+\$200\.00\) could be pending item that cleared: Store return \+\$300\.00 on Sep 5/) });
    w.adjust(c, 120000, { unrelatedToPending: true });
    expect([w.data.transactions.find((t) => t.id === d.id)!.status, w.sts()]).toEqual(['pending', 120000]);
  });
  it('a $120 pending purchase and a −$50 difference: partial; a +$200 difference (other direction) is not', () => {
    const { w, c } = setup();
    const p = pendingPurchase(w, c, 12000);
    expect(previewBalanceUpdate(w.data, c, 95000, w.today).partial.map((t) => t.id)).toEqual([p.id]);
    expect(previewBalanceUpdate(w.data, c, 120000, w.today).partial).toEqual([]);
    expect(w.adjust(c, 120000)!.amountCents).toBe(20000); // coincidental, other direction: not asked
  });
  it('several deposits ($300, $100) and a +$250 difference: no exact set, both named, closest first', () => {
    const { w, c } = setup();
    const a = pendingDeposit(w, c, 30000);
    const b = pendingDeposit(w, c, 10000, '2026-09-06', 'Refund B');
    expect(previewBalanceUpdate(w.data, c, 125000, w.today).partial.map((t) => t.id)).toEqual([a.id, b.id]);
  });
  it('an exact single match and another item in the same direction: the exact one is the match, the other is "could be part of it"', () => {
    const { w, c } = setup();
    const a = pendingDeposit(w, c, 30000);
    const b = pendingDeposit(w, c, 10000, '2026-09-06', 'Refund B');
    const p = previewBalanceUpdate(w.data, c, 130000, w.today);
    expect([p.matches.map((m) => m.map((t) => t.id)), p.partial.map((t) => t.id)]).toEqual([[[a.id]], [b.id]]);
  });
});

describe('transfers between accounts with different confirmed dates (Phase 4A.5.9 audit)', () => {
  const two = () => {
    const w = new W();
    const c = w.acct('Checking', 'checking', 100000);
    const s = w.acct('Savings', 'savings', 50000);
    w.at('2026-09-10');
    w.adjust(s, 50000); // savings confirmed Sep 10 (matches), checking only Sep 1
    w.at('2026-09-12');
    return { w, c, s };
  };
  it('dated Sep 8: savings side is history, checking side counts; editing the amount keeps each side\'s state; deleting removes both', () => {
    const { w, c, s } = two();
    const legs = w.add({ kind: 'transfer', accountId: c, toAccountId: s, date: '2026-09-08', amountCents: 10000, merchant: 'Move', categoryId: null });
    expect([w.rec(c), w.rec(s), w.sts()]).toEqual([90000, 50000, 90000]);
    w.data = applyOps(w.data, updateTransaction(w.ctx(), legs[0]!.id, { kind: 'transfer', accountId: c, toAccountId: s, date: '2026-09-08', amountCents: 15000, merchant: 'Move', categoryId: null }).ops);
    expect([w.rec(c), w.rec(s), w.data.transactions.filter((t) => t.transferGroupId).map((t) => [t.amountCents, !!t.includedInBalance])]).toEqual([85000, 50000, [[-15000, false], [15000, true]]]);
    w.data = applyOps(w.data, deleteTransaction(w.ctx(), legs[1]!.id));
    expect([w.rec(c), w.rec(s), w.data.transactions.filter((t) => t.transferGroupId).length]).toEqual([100000, 50000, 0]);
  });
  it('pending, then posted: never history on either side (pending items can\'t be in a posted balance); both sides count once', () => {
    const { w, c, s } = two();
    const legs = w.add({ kind: 'transfer', accountId: c, toAccountId: s, date: '2026-09-08', amountCents: 10000, merchant: 'Move', categoryId: null, status: 'pending' });
    expect([w.rec(c), w.rec(s), w.sts()]).toEqual([90000, 60000, 90000]);
    w.post(legs[0]!.id);
    expect([w.rec(c), w.rec(s), w.sts(), w.data.transactions.filter((t) => t.includedInBalance).length]).toEqual([90000, 60000, 90000, 0]);
  });
  it('a posted transfer with a history side edited to pending: refused unless that side is explicitly unticked (the screens do)', () => {
    const { w, c, s } = two();
    const legs = w.add({ kind: 'transfer', accountId: c, toAccountId: s, date: '2026-09-08', amountCents: 10000, merchant: 'Move', categoryId: null });
    const base: TxInput = { kind: 'transfer', accountId: c, toAccountId: s, date: '2026-09-08', amountCents: 10000, merchant: 'Move', categoryId: null, status: 'pending' };
    expect(errorOf(() => updateTransaction(w.ctx(), legs[0]!.id, base))).toMatchObject({ field: 'includedInBalance' });
    w.data = applyOps(w.data, updateTransaction(w.ctx(), legs[0]!.id, { ...base, includedInBalance: false, toIncludedInBalance: false }).ops);
    expect([w.rec(c), w.rec(s)]).toEqual([90000, 60000]);
  });
});
