import { describe, expect, it } from 'vitest';
import { accountBalance, balanceAsOfDate, buildDashboard, canIAfford, computeSafeToSpend, historyStatus, pendingCreditTotal, postedBalance } from '@clarity/engine';
import { parseBalanceEntry, parseSignedAmountInput, type Account, type Transaction, type WorkspaceData } from '@clarity/shared';
import {
  addTransaction, adjustBalance, applyOps, archiveAccount, CommandError, createAccount, defaultSettings, deleteTransaction, emptyWorkspace, engineInput,
  markTransactionPosted, previewBalanceUpdate, updateTransaction, type Ctx, type TxInput,
} from '../src';

/**
 * Phase 4A.5.8: corrections for the Phase 4A.5.7 audit findings D1–D9. Every expected value is worked out by hand in the
 * comments (never computed with the code under test). Reserve $0, nothing scheduled unless stated, so Safe to Spend is
 * the spendable money: spendable accounts' recorded balances − pending credits − card debt owed now.
 */
const NOW = Date.UTC(2026, 10, 13, 12);
let seq = 0;
class W {
  data: WorkspaceData = emptyWorkspace(defaultSettings(NOW));
  today = '2026-11-13';
  ctx = (): Ctx => ({ data: this.data, now: NOW, today: this.today, newId: (p) => `${p}_${++seq}` });
  at(d: string) { this.today = d; return this; }
  acct(name: string, type: Account['type'], cents: number, extra: Partial<Account> = {}) {
    const r = createAccount(this.ctx(), { name, type, currentBalanceCents: cents });
    this.data = applyOps(this.data, Object.keys(extra).length ? [...r.ops, { t: 'put', table: 'accounts', value: { ...r.account, ...extra } }] : r.ops);
    return r.account.id;
  }
  add(i: TxInput) { const r = addTransaction(this.ctx(), i); this.data = applyOps(this.data, r.ops); return r.txs; }
  upd(id: string, i: TxInput) { this.data = applyOps(this.data, updateTransaction(this.ctx(), id, i).ops); }
  del(id: string) { this.data = applyOps(this.data, deleteTransaction(this.ctx(), id)); }
  post(id: string) { this.data = applyOps(this.data, markTransactionPosted(this.ctx(), id)); }
  adjust(id: string, entered: number, opts: { unrelatedToPending?: boolean } = {}) { const r = adjustBalance(this.ctx(), id, entered, 'Matched bank', this.today, opts); this.data = applyOps(this.data, r.ops); return r.tx; }
  a(id: string) { return this.data.accounts.find((x) => x.id === id)!; }
  tx(id: string) { return this.data.transactions.find((x) => x.id === id)!; }
  rec(id: string) { return accountBalance(this.a(id), this.data.transactions, this.today); }
  posted(id: string) { return postedBalance(this.a(id), this.data.transactions, this.today); }
  sts() { return computeSafeToSpend(engineInput(this.data, this.today)).cents; }
  warnings() { return buildDashboard(engineInput(this.data, this.today)).warnings.map((w) => w.title); }
  n() { return this.data.transactions.length; }
}
const exp = (accountId: string, date: string, cents: number, extra: Partial<TxInput> = {}): TxInput => ({ kind: 'expense', accountId, date, amountCents: cents, merchant: 'Shop', categoryId: null, ...extra });
const inc = (accountId: string, date: string, cents: number, extra: Partial<TxInput> = {}): TxInput => ({ kind: 'income', accountId, date, amountCents: cents, merchant: 'Deposit', categoryId: null, ...extra });
const xfer = (from: string, to: string, date: string, cents: number, extra: Partial<TxInput> = {}): TxInput => ({ kind: 'transfer', accountId: from, toAccountId: to, date, amountCents: cents, merchant: 'Move', categoryId: null, ...extra });
const P = { status: 'pending' as const };
const errorOf = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof CommandError ? e.issues[0]! : e; } };

describe('D1/D4: signed balances on every account type; the sign is never dropped', () => {
  it('parsing keeps the minus sign; cards are an amount plus Owed / In credit; invalid input gets a message', () => {
    expect(parseSignedAmountInput('-50')).toBe(-5000);
    expect(parseSignedAmountInput('−50.00')).toBe(-5000);
    expect(parseSignedAmountInput('-$1,250.10')).toBe(-125010);
    expect(parseSignedAmountInput('5-0')).toBeNull();
    expect(parseBalanceEntry('-50', 'USD')).toEqual({ ok: true, cents: -5000 });
    expect(parseBalanceEntry('abc', 'USD')).toEqual({ ok: false, message: 'Enter a balance like 1250.00, or -50.00 if the account is overdrawn.' });
    expect(parseBalanceEntry('50', 'USD', 'owed')).toEqual({ ok: true, cents: 5000 });
    expect(parseBalanceEntry('50', 'USD', 'credit')).toEqual({ ok: true, cents: -5000 });
    expect(parseBalanceEntry('-50', 'USD', 'owed')).toEqual({ ok: false, message: 'Enter the amount without a sign, then choose Owed or In credit.' });
  });

  it('checking at −$50: recorded −$50, Safe to Spend −$50, short warning; update to −$120 then +$30', () => {
    const w = new W();
    const c = w.acct('Checking', 'checking', -5000);
    expect([w.a(c).openingBalanceCents, w.rec(c), w.sts()]).toEqual([-5000, -5000, -5000]);
    expect(w.warnings()).toContain('Short by $50.00');
    expect(w.adjust(c, -12000)!.amountCents).toBe(-7000); // −120 − (−50)
    expect([w.rec(c), w.sts()]).toEqual([-12000, -12000]);
    expect(w.adjust(c, 3000)!.amountCents).toBe(15000); // 30 − (−120)
    expect([w.rec(c), w.sts()]).toEqual([3000, 3000]);
    expect(w.warnings().some((t) => /Short by/.test(t))).toBe(false);
  });

  it('savings at −$50 (not spendable) next to $500 checking: recorded −$50; Safe to Spend $500 (documented Phase 4A.4.4 rule); update to −$20', () => {
    const w = new W();
    w.acct('Checking', 'checking', 50000);
    const s = w.acct('Savings', 'savings', -5000);
    expect([w.rec(s), w.sts()]).toEqual([-5000, 50000]);
    expect(w.adjust(s, -2000)!.amountCents).toBe(3000);
    expect([w.rec(s), w.sts()]).toEqual([-2000, 50000]);
  });

  it('cash at −$50 next to $500 checking: Safe to Spend $450 and the wallet is named as overdrawn; update to $10 clears it', () => {
    const w = new W();
    w.acct('Checking', 'checking', 50000);
    const k = w.acct('Wallet', 'cash', -5000);
    expect([w.rec(k), w.sts()]).toEqual([-5000, 45000]);
    expect(w.warnings()).toContain('Wallet is overdrawn: −$50.00 today');
    expect(w.adjust(k, 1000)!.amountCents).toBe(6000);
    expect([w.rec(k), w.sts()]).toEqual([1000, 51000]);
    expect(w.warnings()).not.toContain('Wallet is overdrawn: −$50.00 today');
  });

  it('card owing $50: stored −$50, Safe to Spend $450; update to $20 IN CREDIT (entered as −20 owed): +$70; Safe to Spend $500', () => {
    const w = new W();
    w.acct('Checking', 'checking', 50000);
    const v = w.acct('Visa', 'credit_card', 5000);
    expect([w.a(v).openingBalanceCents, w.sts()]).toEqual([-5000, 45000]);
    expect(w.warnings()).toContain('$50.00 on Visa with no payment scheduled');
    expect(w.adjust(v, -2000)!.amountCents).toBe(7000); // bank +20 − Clarity −50
    expect([w.rec(v), w.sts()]).toEqual([2000, 50000]); // a credit is not spendable, and nothing is owed
  });

  it('card $50 IN CREDIT: stored +$50 (never turned into $50 owed), Safe to Spend $500; update to $30 owed: −$80; Safe to Spend $470', () => {
    const w = new W();
    w.acct('Checking', 'checking', 50000);
    const v = w.acct('Visa', 'credit_card', -5000);
    expect([w.a(v).openingBalanceCents, w.rec(v), w.sts()]).toEqual([5000, 5000, 50000]);
    expect(w.adjust(v, 5000 * -1)).toBeNull(); // entering the same credit again is an exact match (Phase 4A.5.7 D4: was −$100)
    expect(w.adjust(v, 3000)!.amountCents).toBe(-8000); // −30 − (+50)
    expect([w.rec(v), w.sts()]).toEqual([-3000, 47000]);
  });
});

describe('D3/D9: "already included" is enforced in the data layer', () => {
  const opened = () => { const w = new W(); const c = w.acct('Checking', 'checking', 80000); return { w, c }; };
  it('refused on a pending credit or debit (audit AI1/AI2: was $800 spendable with the pending deposit hidden)', () => {
    const { w, c } = opened();
    expect(errorOf(() => w.add(inc(c, '2026-11-13', 30000, { ...P, includedInBalance: true })))).toMatchObject({ field: 'includedInBalance', message: expect.stringMatching(/pending transaction can't already be in Checking's posted balance/) });
    expect(errorOf(() => w.add(exp(c, '2026-11-13', 10000, { ...P, includedInBalance: true })))).toMatchObject({ field: 'includedInBalance' });
    expect(w.n()).toBe(0);
  });
  it('refused on a future date, after the balance date, or before the opening date (audit AI7b: a flag after the balance date was silently honoured)', () => {
    const { w, c } = opened();
    w.at('2026-11-15');
    expect(errorOf(() => w.add(exp(c, '2026-11-20', 5000, { includedInBalance: true })))).toMatchObject({ message: expect.stringMatching(/future-dated/) });
    expect(errorOf(() => w.add(exp(c, '2026-11-14', 5000, { includedInBalance: true })))).toMatchObject({ message: "This is dated after Checking's confirmed balance (Nov 13), so it can't already be included in it." });
    expect(errorOf(() => w.add(exp(c, '2026-11-10', 5000, { includedInBalance: true })))).toMatchObject({ message: expect.stringMatching(/before Checking was added/) });
  });
  it('posted credit or debit on the opening day: valid; recorded as history with the date (AI3/AI4: $800)', () => {
    const { w, c } = opened();
    const [a] = w.add(inc(c, '2026-11-13', 30000, { includedInBalance: true }));
    const [b] = w.add(exp(c, '2026-11-13', 5000, { includedInBalance: true }));
    expect([w.rec(c), w.sts(), w.n()]).toEqual([80000, 80000, 2]);
    expect(w.tx(a!.id)).toMatchObject({ includedInBalance: true, includedAsOf: '2026-11-13' });
    expect(historyStatus(w.a(c), w.tx(b!.id), '2026-11-13')).toEqual({ kind: 'included', asOf: '2026-11-13' });
  });
  it('an included item edited to pending without a decision is refused; with an explicit untick it becomes a pending debit, still counted; id kept', () => {
    const { w, c } = opened();
    const [t] = w.add(exp(c, '2026-11-13', 5000, { includedInBalance: true }));
    expect(errorOf(() => w.upd(t!.id, exp(c, '2026-11-13', 5000, P)))).toMatchObject({ field: 'includedInBalance' });
    w.upd(t!.id, exp(c, '2026-11-13', 5000, { ...P, includedInBalance: false }));
    expect([w.tx(t!.id).status, w.tx(t!.id).includedInBalance, w.rec(c), w.sts(), w.n()]).toEqual(['pending', undefined, 75000, 75000, 1]);
  });
  it('toggling on and off keeps one transaction with the same id; editing the amount keeps the inclusion and its date (AI8/AI9)', () => {
    const { w, c } = opened();
    const [t] = w.add(exp(c, '2026-11-13', 5000, { includedInBalance: false }));
    for (let k = 0; k < 4; k++) { w.upd(t!.id, exp(c, '2026-11-13', 5000, { includedInBalance: true })); expect(w.rec(c)).toBe(80000); w.upd(t!.id, exp(c, '2026-11-13', 5000, { includedInBalance: false })); expect(w.rec(c)).toBe(75000); }
    w.upd(t!.id, exp(c, '2026-11-13', 5000, { includedInBalance: true }));
    w.upd(t!.id, exp(c, '2026-11-13', 9000)); // amount edited by a caller that omits the flag: inherited
    expect([w.n(), w.data.transactions[0]!.id, w.rec(c), w.tx(t!.id).includedAsOf]).toEqual([1, t!.id, 80000, '2026-11-13']);
  });
  it('the engine ignores an invalid flag that bypassed the data layer: a pending item is still pending; a future one is still in the forecast', () => {
    const w = new W().at('2026-11-01');
    const c = w.acct('Checking', 'checking', 80000);
    w.at('2026-11-13');
    const bad = (t: Partial<Transaction>): Transaction => ({ id: `bad${++seq}`, accountId: c, kind: 'expense', merchant: 'x', categoryId: null, notes: '', status: 'confirmed', provenance: { source: 'manual' }, createdAt: NOW, updatedAt: NOW, date: '2026-11-13', amountCents: -1, ...t }) as Transaction;
    w.data = { ...w.data, transactions: [bad({ date: '2026-11-12', amountCents: 30000, kind: 'income', status: 'pending', includedInBalance: true }), bad({ date: '2026-11-20', amountCents: -10000, includedInBalance: true })] };
    // recorded: 800 + 300 (pending, flag ignored) = 1,100; pending credit 300 not spendable; Nov 20 −100 planned: low 700
    expect([w.rec(c), pendingCreditTotal(w.a(c), w.data.transactions, w.today), w.sts()]).toEqual([110000, 30000, 70000]);
  });
});

describe('D2: Update balance never counts a pending item twice', () => {
  const base = () => { const w = new W().at('2026-11-01'); const c = w.acct('Checking', 'checking', 50000); w.at('2026-11-13'); return { w, c }; };
  it('exact match: a $300 deposit cleared at the bank → refused with the item named; mark posted → reconciles with no adjustment ($800 once)', () => {
    const { w, c } = base();
    const [dep] = w.add(inc(c, '2026-11-12', 30000, { ...P, merchant: 'Store return', kind: 'refund' }));
    expect(w.sts()).toBe(50000);
    const p = previewBalanceUpdate(w.data, c, 80000, w.today);
    expect([p.postedCents, p.differenceCents, p.matches.map((m) => m.map((t) => t.id))]).toEqual([50000, 30000, [[dep!.id]]]);
    const e = errorOf(() => w.adjust(c, 80000));
    expect(e).toMatchObject({ field: 'pending_match', message: expect.stringMatching(/\+\$300\.00\) matches pending item: Store return \+\$300\.00 on Nov 12/) });
    expect(w.n()).toBe(1); // nothing recorded
    w.post(dep!.id);
    expect(w.tx(dep!.id)).toMatchObject({ id: dep!.id, status: 'confirmed', amountCents: 30000 });
    expect(w.adjust(c, 80000)).toBeNull();
    expect([w.rec(c), w.sts(), w.n(), w.a(c).balanceConfirmedDate]).toEqual([80000, 80000, 1, '2026-11-13']);
  });
  it('confirmed unrelated: the adjustment is recorded with the explanation and the deposit stays pending (and still not spendable)', () => {
    const { w, c } = base();
    const [dep] = w.add(inc(c, '2026-11-12', 30000, { ...P, merchant: 'Store return', kind: 'refund' }));
    const adj = w.adjust(c, 80000, { unrelatedToPending: true })!;
    expect(adj).toMatchObject({ amountCents: 30000, notes: 'Confirmed not related to pending item (kept pending): Store return +$300.00 on Nov 12' });
    expect(w.tx(dep!.id).status).toBe('pending');
    expect([w.rec(c), w.sts()]).toEqual([110000, 80000]); // 500 + 300 adj + 300 pending; spendable excludes the pending 300
  });
  it('partial: a $350 difference with one $300 pending item is not a match; recorded normally', () => {
    const { w, c } = base();
    w.add(inc(c, '2026-11-12', 30000, P));
    expect(previewBalanceUpdate(w.data, c, 85000, w.today).matches).toEqual([]);
    expect(w.adjust(c, 85000)!.amountCents).toBe(35000);
  });
  it('two pending deposits of the same amount: two separate matches, neither assumed; posting either one reconciles', () => {
    const { w, c } = base();
    const [a] = w.add(inc(c, '2026-11-11', 30000, { ...P, merchant: 'A' }));
    const [b] = w.add(inc(c, '2026-11-12', 30000, { ...P, merchant: 'B' }));
    const m = previewBalanceUpdate(w.data, c, 80000, w.today).matches.map((x) => x.map((t) => t.id));
    expect(m).toEqual([[a!.id], [b!.id]]);
    w.post(b!.id);
    expect(w.adjust(c, 80000)).toBeNull();
    expect([w.rec(c), w.sts()]).toEqual([110000, 80000]); // 500 + 300 posted + 300 still pending (A); spendable 800
  });
  it('a combination: $100 + $200 pending deposits match a $300 difference together', () => {
    const { w, c } = base();
    const [a] = w.add(inc(c, '2026-11-11', 10000, P));
    const [b] = w.add(inc(c, '2026-11-12', 20000, P));
    expect(previewBalanceUpdate(w.data, c, 80000, w.today).matches.map((x) => x.map((t) => t.id))).toEqual([[a!.id, b!.id]]);
    w.post(a!.id);
    expect(previewBalanceUpdate(w.data, c, 80000, w.today).differenceCents).toBe(20000); // 800 − 600, matches B
    w.post(b!.id);
    expect(w.adjust(c, 80000)).toBeNull();
  });
  it('a pending purchase that cleared (negative difference): −$120 matches; posting it reconciles; Safe to Spend $380 throughout', () => {
    const { w, c } = base();
    const [p] = w.add(exp(c, '2026-11-12', 12000, P));
    expect(w.sts()).toBe(38000);
    expect(errorOf(() => w.adjust(c, 38000))).toMatchObject({ field: 'pending_match' });
    w.post(p!.id);
    expect(w.adjust(c, 38000)).toBeNull();
    expect([w.rec(c), w.sts(), w.n()]).toEqual([38000, 38000, 1]);
  });
  it('a coincidental amount: an unrelated $120 fee equals a pending purchase; confirmed unrelated → one −$120 adjustment, the purchase stays pending', () => {
    const { w, c } = base();
    const [p] = w.add(exp(c, '2026-11-12', 12000, P));
    const adj = w.adjust(c, 38000, { unrelatedToPending: true })!;
    expect(adj.amountCents).toBe(-12000);
    expect([w.tx(p!.id).status, w.rec(c), w.sts()]).toEqual(['pending', 26000, 26000]); // 500 − 120 fee − 120 pending purchase
  });
  it('mixed signs and a negative balance: −$50 posted, +$300 pending deposit and −$100 pending purchase; bank −$50 + 300 − 100 = $150 matches both together', () => {
    const w = new W().at('2026-11-01');
    const c = w.acct('Checking', 'checking', -5000);
    w.at('2026-11-13');
    const [d] = w.add(inc(c, '2026-11-12', 30000, P));
    const [p] = w.add(exp(c, '2026-11-12', 10000, P));
    expect(previewBalanceUpdate(w.data, c, 15000, w.today).matches.map((x) => x.map((t) => t.id).sort())).toEqual([[d!.id, p!.id].sort()]);
    expect(previewBalanceUpdate(w.data, c, 25000, w.today).matches.map((x) => x.map((t) => t.id))).toEqual([[d!.id]]); // only the deposit cleared
    expect(w.sts()).toBe(-15000); // −50 − 100 pending purchase; the pending deposit is not spendable
  });
  it('a card: $400 owed, a $200 pending refund cleared at the bank (now $200 owed) → matches; post it → reconciles; Safe to Spend $300', () => {
    const w = new W().at('2026-11-01');
    w.acct('Checking', 'checking', 50000);
    const v = w.acct('Visa', 'credit_card', 40000);
    w.at('2026-11-13');
    const [r] = w.add({ kind: 'refund', accountId: v, date: '2026-11-12', amountCents: 20000, merchant: 'Return', categoryId: null, status: 'pending' });
    expect(w.sts()).toBe(10000); // 500 − (400 owed; the pending refund doesn't reduce it)
    expect(errorOf(() => w.adjust(v, 20000))).toMatchObject({ field: 'pending_match' });
    w.post(r!.id);
    expect(w.adjust(v, 20000)).toBeNull();
    expect(w.sts()).toBe(30000);
  });
  it('archived and foreign-currency accounts reconcile by the same rules; the EUR account never changes Safe to Spend', () => {
    const w = new W().at('2026-11-01');
    w.acct('Checking', 'checking', 50000);
    const o = w.acct('Old', 'checking', 10000);
    const e = w.acct('Euro', 'checking', 20000, { currency: 'EUR' });
    w.at('2026-11-13');
    w.data = applyOps(w.data, archiveAccount(w.ctx(), o));
    const [d] = w.add(inc(e, '2026-11-12', 30000, P));
    expect(errorOf(() => w.adjust(e, 50000))).toMatchObject({ field: 'pending_match' });
    w.post(d!.id);
    expect(w.adjust(e, 50000)).toBeNull();
    expect(w.adjust(o, 5000)!.amountCents).toBe(-5000);
    expect(w.sts()).toBe(50000);
  });
});

describe('D5: transfer inclusion is decided per account; money is never created or lost', () => {
  it('new account (opened today after sending $200) → older account: only the new account\'s side is history (audit TR1: old account lost the $200)', () => {
    const w = new W().at('2026-11-01');
    const old = w.acct('Old checking', 'checking', 100000);
    w.at('2026-11-13');
    const nw = w.acct('New savings', 'savings', 50000);
    // same day as the new account's balance: offered unticked; the user ticks it for the new account's side only
    const legs = w.add(xfer(nw, old, '2026-11-13', 20000, { includedInBalance: true }));
    // the bank: old 1,000 + 200 = 1,200; new 500 (already after the move). Both legs kept.
    expect([w.rec(old), w.rec(nw), w.n()]).toEqual([120000, 50000, 2]);
    expect(legs.map((l) => [l.accountId, !!l.includedInBalance])).toEqual([[nw, true], [old, false]]);
    expect(legs.every((l) => l.transferGroupId === legs[0]!.transferGroupId)).toBe(true);
  });
  it('older account → new account (opened today at $800 including the $300, ticked for the new side): the older side counts, the new side is history (TR2)', () => {
    const w = new W().at('2026-11-01');
    const sav = w.acct('Savings', 'savings', 100000);
    w.at('2026-11-13');
    const chk = w.acct('New checking', 'checking', 80000);
    w.add(xfer(sav, chk, '2026-11-13', 30000, { toIncludedInBalance: true }));
    expect([w.rec(sav), w.rec(chk), w.sts()]).toEqual([70000, 80000, 80000]);
  });
  it('two accounts with different confirmed dates: a transfer dated between them is history for one side only; one dated after both counts on both', () => {
    const w = new W().at('2026-11-01');
    const a = w.acct('A', 'checking', 100000);
    const b = w.acct('B', 'checking', 20000);
    w.at('2026-11-10');
    expect(w.adjust(a, 90000)!.amountCents).toBe(-10000); // A confirmed Nov 10
    w.at('2026-11-13');
    w.add(xfer(a, b, '2026-11-08', 5000)); // A's Nov 10 balance already has it; B's (Nov 1) doesn't
    expect([w.rec(a), w.rec(b)]).toEqual([90000, 25000]);
    w.add(xfer(a, b, '2026-11-12', 5000)); // after both dates: counted on both
    expect([w.rec(a), w.rec(b), w.sts()]).toEqual([85000, 30000, 115000]);
  });
  it('same day as both balances, nothing ticked: both sides counted (the default only applies BEFORE the confirmed date)', () => {
    const w = new W();
    const a = w.acct('A', 'checking', 50000);
    const b = w.acct('B', 'savings', 0);
    w.add(xfer(a, b, '2026-11-13', 10000));
    expect([w.rec(a), w.rec(b), w.sts()]).toEqual([40000, 10000, 40000]);
  });
  it('explicit choices are respected per side; a pending transfer is never history; untick → both sides counted', () => {
    const w = new W();
    const a = w.acct('A', 'checking', 50000);
    const b = w.acct('B', 'savings', 0);
    w.add(xfer(a, b, '2026-11-13', 10000, { includedInBalance: false, toIncludedInBalance: false }));
    expect([w.rec(a), w.rec(b)]).toEqual([40000, 10000]);
    expect(errorOf(() => w.add(xfer(a, b, '2026-11-13', 10000, { ...P, includedInBalance: true })))).toMatchObject({ field: 'includedInBalance' });
    w.add(xfer(a, b, '2026-11-13', 5000, P)); // default: pending → neither side history
    expect([w.rec(a), w.rec(b), w.sts()]).toEqual([35000, 15000, 35000]);
  });
  it('from an overdrawn checking account (−$50) to savings: both sides counted after the balance date; −$50 − $100 = −$150', () => {
    const w = new W().at('2026-11-01');
    const c = w.acct('Checking', 'checking', -5000);
    const s = w.acct('Savings', 'savings', 0);
    w.at('2026-11-13');
    w.add(xfer(c, s, '2026-11-12', 10000));
    expect([w.rec(c), w.rec(s), w.sts()]).toEqual([-15000, 10000, -15000]);
  });
  it('different currencies: refused, as before (no transfer leg is created)', () => {
    const w = new W();
    const u = w.acct('USD', 'checking', 50000);
    const e = w.acct('EUR', 'checking', 0, { currency: 'EUR' });
    expect(errorOf(() => w.add(xfer(u, e, '2026-11-13', 1000)))).toMatchObject({ message: expect.stringMatching(/between currencies/) });
    expect(w.n()).toBe(0);
  });
});

describe('D6 (owner decision: strictly before): a transaction dated before the latest confirmed balance date is history only by default', () => {
  const setup = () => { const w = new W().at('2026-11-01'); const c = w.acct('Checking', 'checking', 100000); return { w, c }; };
  it('entered after the Nov 20 update: dated Nov 18 → history ("as of Nov 20"); dated Nov 21 → counted (audit X7: was $850)', () => {
    const { w, c } = setup();
    w.at('2026-11-20');
    expect(w.adjust(c, 90000)!.amountCents).toBe(-10000);
    w.at('2026-11-22');
    const [old] = w.add(exp(c, '2026-11-18', 5000));
    expect([w.rec(c), w.tx(old!.id).includedAsOf]).toEqual([90000, '2026-11-20']);
    expect(historyStatus(w.a(c), w.tx(old!.id), balanceAsOfDate(w.a(c), w.data.transactions))).toEqual({ kind: 'included', asOf: '2026-11-20' });
    w.add(exp(c, '2026-11-21', 5000));
    expect([w.rec(c), w.sts(), w.n()]).toEqual([85000, 85000, 3]);
  });
  it('entered before the update: counted, and the update includes it; it stays counted afterwards, even when edited', () => {
    const { w, c } = setup();
    w.at('2026-11-19');
    const [t] = w.add(exp(c, '2026-11-18', 5000));
    expect(w.rec(c)).toBe(95000);
    w.at('2026-11-20');
    expect(w.adjust(c, 95000)).toBeNull(); // matches: confirmed, no adjustment
    w.at('2026-11-22');
    w.upd(t!.id, exp(c, '2026-11-18', 6000));
    expect([w.rec(c), w.tx(t!.id).includedInBalance]).toEqual([94000, undefined]);
  });
  it('an explicit untick keeps a backdated item counted; repeated updates move the date per account only', () => {
    const { w, c } = setup();
    const s = w.acct('Savings', 'savings', 30000);
    w.at('2026-11-20');
    w.adjust(c, 100000);
    w.at('2026-11-22');
    w.add(exp(c, '2026-11-18', 5000, { includedInBalance: false }));
    expect(w.rec(c)).toBe(95000);
    w.add(exp(s, '2026-11-18', 1000)); // Savings was confirmed Nov 1 only → counted
    expect(w.rec(s)).toBe(29000);
    w.at('2026-11-25');
    w.adjust(c, 95000);
    w.at('2026-11-26');
    w.add(exp(c, '2026-11-24', 2000)); // before the Nov 25 confirmation → history
    expect([w.rec(c), balanceAsOfDate(w.a(c), w.data.transactions), balanceAsOfDate(w.a(s), w.data.transactions)]).toEqual([95000, '2026-11-25', '2026-11-01']);
  });
  it('a backdated item entered pending is not history; posting it later counts it once', () => {
    const { w, c } = setup();
    w.at('2026-11-20');
    w.adjust(c, 100000);
    w.at('2026-11-22');
    const [t] = w.add(exp(c, '2026-11-18', 5000, P));
    expect([w.rec(c), w.sts()]).toEqual([95000, 95000]);
    w.post(t!.id);
    expect([w.rec(c), w.sts(), w.n()]).toEqual([95000, 95000, 1]);
  });
  it('editing and deleting a history-only item never changes the balance; the label follows the stored date', () => {
    const { w, c } = setup();
    w.at('2026-11-20');
    w.adjust(c, 100000);
    w.at('2026-11-22');
    const [t] = w.add(exp(c, '2026-11-18', 5000));
    w.upd(t!.id, exp(c, '2026-11-17', 7000));
    expect([w.rec(c), w.tx(t!.id).includedAsOf, w.n()]).toEqual([100000, '2026-11-20', 1]);
    w.at('2026-11-25');
    w.adjust(c, 100000);
    expect(historyStatus(w.a(c), w.tx(t!.id), balanceAsOfDate(w.a(c), w.data.transactions))).toEqual({ kind: 'included', asOf: '2026-11-20' });
    w.del(t!.id);
    expect([w.rec(c), w.n()]).toEqual([100000, 0]);
  });
  it('dated ON the confirmed date: counted by default (a same-day purchase after reconciling); ticking it makes it history', () => {
    const { w, c } = setup();
    w.at('2026-11-20');
    w.adjust(c, 100000);
    const [t] = w.add(exp(c, '2026-11-20', 650));
    expect([w.rec(c), w.tx(t!.id).includedInBalance]).toEqual([99350, undefined]);
    const [u] = w.add(exp(c, '2026-11-20', 1000, { includedInBalance: true }));
    expect([w.rec(c), w.tx(u!.id).includedAsOf]).toEqual([99350, '2026-11-20']);
  });
  it('onboarding then a coffee the same day: counted ($1,000 − $6.50); the opening balance date is a confirmed date too', () => {
    const w = new W();
    const c = w.acct('Checking', 'checking', 100000);
    w.add(exp(c, '2026-11-13', 650));
    expect([w.rec(c), w.sts()]).toEqual([99350, 99350]);
  });
  it('before the opening date: labelled as already in the opening balance', () => {
    const { w, c } = setup();
    w.at('2026-11-13');
    const [t] = w.add(exp(c, '2026-10-20', 5000));
    expect([w.rec(c), historyStatus(w.a(c), w.tx(t!.id), '2026-11-01')]).toEqual([100000, { kind: 'before_opening', asOf: '2026-11-01' }]);
  });
});

describe('found while testing: editing a balance adjustment', () => {
  it('is refused, so a +$40 adjustment can never become a −$40 expense (it could before: an $80 swing)', () => {
    const w = new W();
    const c = w.acct('Checking', 'checking', 50000);
    const adj = w.adjust(c, 54000)!;
    expect(adj.amountCents).toBe(4000);
    expect(errorOf(() => w.upd(adj.id, exp(c, '2026-11-13', 4000)))).toMatchObject({ message: 'Balance adjustments can’t be edited. Delete it, or use Update balance again.' });
    expect([w.rec(c), w.tx(adj.id).kind]).toEqual([54000, 'adjustment']);
    w.del(adj.id);
    expect(w.rec(c)).toBe(50000);
  });
});

describe('D8: a matching Update balance records the confirmed date without a transaction', () => {
  it('repeated matching updates on Nov 20 and Nov 25: no transactions, the date moves, the posted balance is unchanged', () => {
    const w = new W().at('2026-11-01');
    const c = w.acct('Checking', 'checking', 100000);
    w.add(exp(c, '2026-11-05', 2000));
    w.at('2026-11-20');
    const r = adjustBalance(w.ctx(), c, 98000, 'x');
    expect([r.tx, r.reconciled, r.ops.length]).toEqual([null, true, 1]);
    w.data = applyOps(w.data, r.ops);
    expect([w.a(c).balanceConfirmedDate, w.n(), w.posted(c)]).toEqual(['2026-11-20', 1, 98000]);
    w.at('2026-11-25');
    w.adjust(c, 98000);
    expect([w.a(c).balanceConfirmedDate, balanceAsOfDate(w.a(c), w.data.transactions), w.n()]).toEqual(['2026-11-25', '2026-11-25', 1]);
    expect(w.data.transactions.some((t) => t.amountCents === 0)).toBe(false);
  });
});

describe('reconciliation: Safe to Spend, "Why this number?" and affordability agree after an Update balance', () => {
  it('$500, pending deposit $300, posted purchase $45; after a −$20 adjustment: recorded 735, spendable 435; afford 435 yes, 435.01 not', () => {
    const w = new W().at('2026-11-01');
    const c = w.acct('Checking', 'checking', 50000);
    w.at('2026-11-13');
    w.add(inc(c, '2026-11-12', 30000, P));
    w.add(exp(c, '2026-11-12', 4500));
    expect(w.adjust(c, 43500)!.amountCents).toBe(-2000); // bank posted 435 vs Clarity posted 455
    const i = engineInput(w.data, w.today);
    const s = computeSafeToSpend(i);
    expect([w.rec(c), s.cents]).toEqual([73500, 43500]);
    expect(s.explanation.lines[0]!.cents).toBe(73500);
    expect(s.explanation.lines.find((l) => /pending credit not yet available/.test(l.label))!.cents).toBe(-30000);
    expect(s.explanation.lines.find((l) => l.label === 'Safe to Spend')!.cents).toBe(43500);
    expect(canIAfford(i, { amountCents: 43500, accountId: c, date: w.today }).verdict).toBe('yes');
    expect(canIAfford(i, { amountCents: 43501, accountId: c, date: w.today }).verdict).not.toBe('yes');
  });
});
