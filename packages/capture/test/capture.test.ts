import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDashboard, budgetSummary } from '@clarity/engine';
import { MemoryAdapter, WorkspaceStore, addTransaction, addTransactions, createAccount, engineInput, onboard, updateSettings } from '@clarity/data';
import { createNobleProvider } from '@clarity/security/noble';
import type { EncryptedRow } from '@clarity/security';
import type { WorkspaceData } from '@clarity/shared';
import { captureTotals, findDates, interpretLocal, parseDrafts, reviewDraft, toTxInput, type CaptureContext, type CaptureDraft } from '../src';

const noble = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
const TODAY = '2026-11-13'; // a Friday
const NOW = Date.UTC(2026, 10, 13, 15);

async function workspace(opts: { card?: boolean; savings?: boolean } = {}) {
  const adapter = new MemoryAdapter();
  const { store } = await WorkspaceStore.create(adapter, noble, 'correct horse battery', { withRecoveryKey: false, now: NOW });
  // Accounts opened on Nov 1, so purchases from the last few days count in their balances.
  const OPENED = '2026-11-01';
  await store.apply(onboard(store.ctx(NOW, OPENED), { checkingBalanceCents: 200000 }));
  if (opts.savings !== false) await store.apply(createAccount(store.ctx(NOW, OPENED), { name: 'Savings', type: 'savings', currentBalanceCents: 50000 }).ops);
  if (opts.card !== false) await store.apply(createAccount(store.ctx(NOW, OPENED), { name: 'Chase Visa', type: 'credit_card', currentBalanceCents: 30000 }).ops);
  return { store, adapter };
}
const ctxOf = (d: WorkspaceData): CaptureContext => ({ today: TODAY, currency: d.settings.baseCurrency, categories: d.categories, accounts: d.accounts, defaultAccountId: d.settings.defaultAccountId, transactions: d.transactions });
const run = (text: string, d: WorkspaceData) => interpretLocal(text, ctxOf(d));
const codes = (dr: CaptureDraft, d: WorkspaceData) => reviewDraft(dr, ctxOf(d)).map((i) => `${i.code}${i.blocking ? '!' : ''}`);
const acctId = (d: WorkspaceData, name: string) => d.accounts.find((a) => a.name === name)!.id;

describe('Clarity Capture: reading what people write', () => {
  it('1. one expense', async () => {
    const { store } = await workspace();
    const [t] = run('I spent $12.50 at Chipotle today', store.data).drafts;
    expect(t).toMatchObject({ kind: 'expense', amountCents: 1250, merchant: 'Chipotle', date: TODAY, dateSource: 'words', categoryId: 'cat_dining', accountId: acctId(store.data, 'Checking') });
  });

  it('2. several expenses in one message, with the date carried forward', async () => {
    const { store } = await workspace();
    const { drafts } = run('Yesterday I spent $45 at Walmart on groceries, $18 at Starbucks for coffee, and today I paid $65 for gas at Shell.', store.data);
    expect(drafts.map((x) => [x.kind, x.merchant, x.amountCents, x.date, x.categoryId, x.dateSource])).toEqual([
      ['expense', 'Walmart', 4500, '2026-11-12', 'cat_groceries', 'words'],
      ['expense', 'Starbucks', 1800, '2026-11-12', 'cat_coffee', 'carried'],
      ['expense', 'Shell', 6500, TODAY, 'cat_fuel', 'words'],
    ]);
    expect(captureTotals(drafts)).toEqual({ out: 12800, in: 0, moved: 0 });
    for (const x of drafts) expect(codes(x, store.data).filter((c) => c.endsWith('!'))).toEqual([]);
  });

  it('3. many date forms resolve against today (never assumed silently)', async () => {
    const { store } = await workspace();
    const d = run('Last Friday $30 at Target, two days ago $12 for lunch, on October 15 $200 at Costco, and 3 days ago $9 at CVS', store.data).drafts;
    expect(d.map((x) => x.date)).toEqual(['2026-11-06', '2026-11-11', '2026-10-15', '2026-11-10']);
    expect(findDates('last night', TODAY)[0]!.date).toBe('2026-11-12');
    expect(findDates('this morning', TODAY)[0]!.date).toBe(TODAY);
    expect(findDates('October 15, 2025', TODAY)[0]!.date).toBe('2025-10-15');
    expect(findDates('on Friday', TODAY)[0]!.date).toBe(TODAY);
    expect(findDates('the day before yesterday', TODAY)[0]!.date).toBe('2026-11-11');
    expect(findDates('February 30', TODAY)[0]!.date).toBeNull();
    const vague = run('Last week $40 at Target', store.data).drafts[0]!;
    expect(vague.date).toBeNull();
    expect(codes(vague, store.data)).toContain('date_missing!');
    const ambiguous = run('$20 at Target on 10/11', store.data).drafts[0]!;
    expect(ambiguous.date).toBe('2026-10-11');
    expect(codes(ambiguous, store.data)).toContain('date_ambiguous!');
  });

  it('4. income: paycheck and money from a sale', async () => {
    const { store } = await workspace();
    const [pay] = run('Received my paycheck of $1,850 today.', store.data).drafts;
    expect(pay).toMatchObject({ kind: 'income', amountCents: 185000, merchant: 'Paycheck', categoryId: 'cat_paycheck', date: TODAY });
    const [sale] = run('Received $200 from selling my old phone', store.data).drafts;
    expect(sale).toMatchObject({ kind: 'income', amountCents: 20000, merchant: 'Sold old phone', categoryId: 'cat_other_income' });
  });

  it('5. refunds reduce spending, they are not income', async () => {
    const { store } = await workspace();
    const [r] = run('Received a $25 refund from Amazon today', store.data).drafts;
    expect(r).toMatchObject({ kind: 'refund', amountCents: 2500, merchant: 'Amazon', categoryId: 'cat_shopping' });
  });

  it('6. transfers between accounts are never income or spending', async () => {
    const { store } = await workspace();
    const [t] = run('Transferred $300 from checking to savings today', store.data).drafts;
    expect(t).toMatchObject({ kind: 'transfer', role: 'transfer', accountId: acctId(store.data, 'Checking'), toAccountId: acctId(store.data, 'Savings'), categoryId: null });
    expect(captureTotals([t!])).toEqual({ out: 0, in: 0, moved: 30000 });
    const [s] = run('Put $100 into savings today', store.data).drafts;
    expect(s).toMatchObject({ kind: 'transfer', role: 'savings', toAccountId: acctId(store.data, 'Savings') });
  });

  it('7. credit card payments are transfers to the card (no double counting); missing card asks', async () => {
    const { store } = await workspace();
    for (const text of ['Paid my credit card 300 today', 'Paid $500 toward my credit card today', 'Paid $50 on the Chase Visa today']) {
      const [p] = run(text, store.data).drafts;
      expect(p).toMatchObject({ kind: 'transfer', role: 'card_payment', toAccountId: acctId(store.data, 'Chase Visa'), accountId: acctId(store.data, 'Checking') });
    }
    // a purchase made WITH the card is an expense on the card, not a payment
    const [buy] = run('Spent $40 at Target with my credit card today', store.data).drafts;
    expect(buy).toMatchObject({ kind: 'expense', accountId: acctId(store.data, 'Chase Visa') });
    const noCard = await workspace({ card: false });
    const [p] = run('Paid my credit card 300 today', noCard.store.data).drafts;
    expect(p!.toAccountId).toBeNull();
    expect(codes(p!, noCard.store.data)).toContain('to_account_missing!');
  });

  it('8. split purchases: one transaction, parts must add up exactly', async () => {
    const { store } = await workspace();
    const [c] = run('I spent $120 at Costco today: $70 groceries, $30 household supplies, and $20 personal care.', store.data).drafts;
    expect(c).toMatchObject({ kind: 'expense', merchant: 'Costco', amountCents: 12000, categoryId: null });
    expect(c!.splits.map((s) => [s.label, s.amountCents, s.categoryId])).toEqual([
      ['groceries', 7000, 'cat_groceries'],
      ['household supplies', 3000, null], // no such category: never invented, the user chooses
      ['personal care', 2000, 'cat_personal'],
    ]);
    expect(codes(c!, store.data)).toContain('split_category_missing!');
    const fixed = { ...c!, splits: c!.splits.map((s) => ({ ...s, categoryId: s.categoryId ?? 'cat_shopping' })) };
    const input = toTxInput(fixed, ctxOf(store.data))!;
    expect(input.splits!.reduce((a, s) => a + s.amountCents, 0)).toBe(12000);
    const wrong = { ...fixed, splits: [...fixed.splits.slice(0, 2), { ...fixed.splits[2]!, amountCents: 2500 }] };
    expect(codes(wrong, store.data)).toContain('splits_mismatch!');
    expect(toTxInput(wrong, ctxOf(store.data))).toBeNull();
  });

  it('9. ambiguous descriptions: defaults are labelled, nothing important is invented', async () => {
    const { store } = await workspace();
    const [w] = run('I spent 50 at Walmart.', store.data).drafts;
    expect(w).toMatchObject({ amountCents: 5000, currency: 'USD', currencyWritten: false, date: TODAY, dateSource: 'none', accountSource: 'default' });
    expect(codes(w!, store.data)).toEqual(expect.arrayContaining(['date_assumed!', 'account_default']));
    const [p] = run('I paid 200.', store.data).drafts;
    expect(p).toMatchObject({ merchant: '', categoryId: null, kindUnclear: true });
    expect(codes(p!, store.data)).toEqual(expect.arrayContaining(['kind_unclear!', 'merchant_missing!']));
    const [eur] = run('€20 at Zara today', store.data).drafts;
    expect(codes(eur!, store.data)).toContain('currency_other!');
    const [visa] = run('Spent $15 at Target with my Amex today', store.data).drafts; // no Amex account
    expect(codes(visa!, store.data)).toContain('account_unknown!');
  });

  it('10. approximate amounts must be confirmed', async () => {
    const { store } = await workspace();
    const [a] = run('I spent around $100 at the grocery store yesterday', store.data).drafts;
    expect(a).toMatchObject({ amountCents: 10000, approximate: true, categoryId: 'cat_groceries' });
    expect(codes(a!, store.data)).toContain('amount_approx!');
    expect(codes({ ...a!, acknowledged: ['amount_approx'] }, store.data)).not.toContain('amount_approx!');
  });

  it('11. missing merchant: a description is used and labelled, or the user is asked', async () => {
    const { store } = await workspace();
    const [c] = run('$15 for coffee today', store.data).drafts;
    expect(c).toMatchObject({ merchant: 'Coffee', merchantSource: 'description', categoryId: 'cat_coffee' });
    expect(codes(c!, store.data)).toContain('merchant_description');
  });

  it('12. possible duplicates are shown, never dropped automatically', async () => {
    const { store } = await workspace();
    await store.apply(addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: acctId(store.data, 'Checking'), date: '2026-11-12', amountCents: 1800, merchant: 'Starbucks', categoryId: 'cat_coffee' }).ops);
    const [d] = run('Yesterday $18 at Starbucks', store.data).drafts;
    expect(codes(d!, store.data)).toContain('duplicate!');
    expect(toTxInput(d!, ctxOf(store.data))).toBeNull();
    expect(toTxInput({ ...d!, acknowledged: ['duplicate'] }, ctxOf(store.data))).not.toBeNull();
  });

  it('13. category corrections are remembered through history (merchant memory)', async () => {
    const { store } = await workspace();
    const [first] = run('$30 at Walmart today', store.data).drafts;
    expect(first!.categoryId).toBe('cat_shopping'); // built-in rule
    // the user corrects it to Groceries and approves
    await store.apply(addTransactions(store.ctx(NOW, TODAY), [toTxInput({ ...first!, categoryId: 'cat_groceries' }, ctxOf(store.data))!]).ops);
    const [next] = run('$12 at walmart today', store.data).drafts;
    expect(next).toMatchObject({ merchant: 'Walmart', categoryId: 'cat_groceries', categorySource: 'memory' });
    // explicit words still win over memory
    expect(run('$12 at Walmart on clothes today', store.data).drafts[0]!.categoryId).toBe('cat_shopping');
  });

  it('14 & 17. edits before approval are what gets saved', async () => {
    const { store } = await workspace();
    const [d] = run('Yesterday I spent $45 at Walmart on groceries', store.data).drafts;
    const edited = { ...d!, date: '2026-11-10', amountCents: 4725, merchant: 'Walmart Supercenter', categoryId: 'cat_shopping', accountId: acctId(store.data, 'Chase Visa') };
    expect(toTxInput(edited, ctxOf(store.data))).toMatchObject({ kind: 'expense', date: '2026-11-10', amountCents: 4725, merchant: 'Walmart Supercenter', categoryId: 'cat_shopping', accountId: acctId(store.data, 'Chase Visa'), provenance: { source: 'capture', rawDescription: 'Yesterday I spent $45 at Walmart on groceries' } });
  });

  it('15–16. invalid interpreter output is rejected; unknown ids are never trusted', async () => {
    const { store } = await workspace();
    const ctx = ctxOf(store.data);
    expect(parseDrafts(null, ctx).ok).toBe(false);
    expect(parseDrafts({ drafts: 'nope' }, ctx).ok).toBe(false);
    expect(parseDrafts({ drafts: [{ kind: 'gift', amountCents: 100 }] }, ctx)).toEqual({ ok: false, error: 'Item 1 has an unknown type.' });
    expect(parseDrafts({ drafts: [{ kind: 'expense', amountCents: 12.5 }] }, ctx)).toEqual({ ok: false, error: 'Item 1 has an invalid amount.' });
    expect(parseDrafts({ drafts: [{ kind: 'expense', amountCents: 100, date: '2026-02-30' }] }, ctx)).toEqual({ ok: false, error: 'Item 1 has an invalid date.' });
    const r = parseDrafts({ drafts: [{ kind: 'expense', amountCents: 100, date: TODAY, merchant: 'X', categoryId: 'cat_made_up', accountId: 'acct_made_up' }] }, ctx);
    expect(r.ok && r.drafts[0]).toMatchObject({ categoryId: null, accountId: null });
    // the local interpreter's own output passes the same gate unchanged
    const local = run('Yesterday I spent $45 at Walmart on groceries', store.data);
    const parsed = parseDrafts(local, ctx);
    expect(parsed.ok && parsed.drafts).toEqual(local.drafts);
  });

  it('everyday phrasings', async () => {
    const { store } = await workspace();
    const one = (t: string) => run(t, store.data).drafts.map((x) => [x.merchant, x.amountCents, x.date, x.categoryId]);
    expect(one('walmart 45 groceries yesterday')).toEqual([['Walmart', 4500, '2026-11-12', 'cat_groceries']]);
    expect(one('Coffee $4.50 this morning')).toEqual([['Coffee', 450, TODAY, 'cat_coffee']]);
    expect(one('spent 23.40 on uber last night')).toEqual([['Uber', 2340, '2026-11-12', 'cat_transport']]);
    expect(one('Paid rent $1,400 on the 1st')).toEqual([['Rent', 140000, '2026-11-01', 'cat_housing']]);
    expect(one('lunch with Sarah $32 at Chipotle today')).toEqual([['Chipotle', 3200, TODAY, 'cat_dining']]);
    expect(one('Target $23.10 and Trader Joes $41 on Monday')).toEqual([['Target', 2310, '2026-11-09', 'cat_shopping'], ["Trader Joe's", 4100, '2026-11-09', 'cat_groceries']]);
    expect(one('Dinner at Olive Garden for $64.80 yesterday')).toEqual([['Olive Garden', 6480, '2026-11-12', 'cat_dining']]);
    expect(one('Paid $120 electric bill today')).toEqual([['Electric bill', 12000, TODAY, 'cat_utilities']]);
    expect(one('Bought shoes at Nike for $90 on Nov 2')).toEqual([['Nike', 9000, '2026-11-02', 'cat_shopping']]);
  });

  it('text without any amount is reported, not dropped', async () => {
    const { store } = await workspace();
    const r = run('Went to the store. Spent $5 at CVS today.', store.data);
    expect(r.notUnderstood).toEqual(['Went to the store.']);
    expect(r.drafts).toHaveLength(1);
  });
});

describe('Clarity Capture: approving', () => {
  it('18 & 20. batch approval saves everything at once and updates balances, budget and Safe to Spend; drafts alone change nothing', async () => {
    const { store } = await workspace();
    await store.apply([{ t: 'put', table: 'categories', value: { ...store.data.categories.find((c) => c.id === 'cat_groceries')!, budgetCents: 40000 } }]);
    const before = buildDashboard(engineInput(store.data, TODAY));
    const { drafts } = run('Yesterday I spent $45 at Walmart on groceries, $18 at Starbucks for coffee, and today I paid $65 for gas at Shell. Transferred $300 from checking to savings today.', store.data);
    // drafts exist, nothing changed yet
    expect(buildDashboard(engineInput(store.data, TODAY)).balances.availableCashCents).toBe(before.balances.availableCashCents);
    const inputs = drafts.map((d) => toTxInput(d, ctxOf(store.data))!);
    expect(inputs.every(Boolean)).toBe(true);
    await store.apply(addTransactions(store.ctx(NOW, TODAY), inputs).ops);
    const after = buildDashboard(engineInput(store.data, TODAY));
    expect(store.data.transactions.filter((t) => t.provenance.source === 'capture')).toHaveLength(5); // 3 expenses + 2 transfer legs
    // $128 of spending, plus $300 moved to savings (set aside: savings is not spendable by default).
    // The transfer is not spending: the budget and reports never see it.
    expect(before.balances.availableCashCents).toBe(200000);
    expect(after.balances.availableCashCents).toBe(200000 - 12800 - 30000);
    expect(after.safeToSpend.cents).toBe(before.safeToSpend.cents - 12800 - 30000);
    const budget = budgetSummary(store.data.categories, store.data.transactions, '2026-11-01', '2026-11-30');
    expect(budget.rows.find((r) => r.categoryId === 'cat_groceries')!.spentCents).toBe(4500);
  });

  it('a batch with one invalid item saves nothing', async () => {
    const { store } = await workspace();
    const ok = toTxInput(run('$10 at CVS today', store.data).drafts[0]!, ctxOf(store.data))!;
    expect(() => addTransactions(store.ctx(NOW, TODAY), [ok, { ...ok, amountCents: 0 }])).toThrow(/Item 2/);
    expect(store.data.transactions.filter((t) => t.provenance.source === 'capture')).toHaveLength(0);
  });

  it('19. a storage failure during approval saves nothing and leaves memory unchanged', async () => {
    const { store, adapter } = await workspace();
    const inputs = run('$10 at CVS today, $20 at Target today', store.data).drafts.map((d) => toTxInput({ ...d, acknowledged: [] }, ctxOf(store.data))!);
    const before = JSON.stringify(store.data.transactions);
    const original = adapter.writeRows.bind(adapter);
    adapter.writeRows = async (_rows: EncryptedRow[]) => { throw new Error('disk full'); };
    await expect(store.apply(addTransactions(store.ctx(NOW, TODAY), inputs).ops)).rejects.toThrow('disk full');
    expect(JSON.stringify(store.data.transactions)).toBe(before);
    adapter.writeRows = original;
    await store.apply(addTransactions(store.ctx(NOW, TODAY), inputs).ops);
    expect(store.data.transactions.filter((t) => t.provenance.source === 'capture')).toHaveLength(2);
  });

  it('says when a date is before the account was added (history: no balance change)', async () => {
    const { store } = await workspace();
    const [d] = run('Spent $10 at CVS on October 20', store.data).drafts;
    expect(codes(d!, store.data)).toContain('before_tracking');
    const one = await workspace({ card: false, savings: false });
    expect(codes(run('$10 at CVS today', one.store.data).drafts[0]!, one.store.data)).not.toContain('account_default');
  });

  it('uses the default account setting when nothing is said', async () => {
    const { store } = await workspace();
    await store.apply(updateSettings(store.ctx(NOW, TODAY), { defaultAccountId: acctId(store.data, 'Chase Visa') }));
    expect(run('$9 at CVS today', store.data).drafts[0]!.accountId).toBe(acctId(store.data, 'Chase Visa'));
  });
});
