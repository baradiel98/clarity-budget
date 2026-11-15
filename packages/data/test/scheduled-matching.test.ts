import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNobleProvider } from '@clarity/security/noble';
import { expandOccurrences, occurrenceEligible, suggestOccurrenceLink } from '@clarity/engine';
import type { ID, RecurringAmount, RecurringKind, Schedule } from '@clarity/shared';
import { addTransaction, applyOps, buildDemoWorkspace, commitImport, createAccount, createRecurring, deleteRecurring, MemoryAdapter, setOccurrenceException, StaleDataError, updateRecurring, updateTransaction, WorkspaceStore } from '../src';
import { Book, errorOf, row, type Line } from './fixtures/settlement-harness';

/**
 * Phase 4A.9: linking an imported (or entered) transaction to a scheduled item. Checking $1,000; no card; today Sat
 * Sep 12, 2026; no income scheduled, so Safe to Spend = Checking − every scheduled bill up to Oct 31. Expected values are
 * worked out by hand:
 * - Rent $300 due Sep 15 and Oct 15: Safe to Spend 1,000 − 600 = $400.
 * - a $300 row that IS the Sep 15 rent, linked: Checking 700 − Oct 15 rent 300 = $400.
 * - a $300 row that is something else (unlinked, correctly): 700 − 600 = $100.
 * - the same unrelated row wrongly linked to the rent (the defect): 700 − 300 = $400, overstated by $300.
 */
const setup = () => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', 100000);
  b.at('2026-09-12');
  return { b, c };
};
const rec = (b: Book, acct: ID, name: string, kind: RecurringKind, schedule: Schedule, amount: RecurringAmount, toAccountId?: ID) => {
  const r = createRecurring(b.ctx(), { name, kind, accountId: acct, categoryId: null, schedule, amount, ...(toAccountId ? { toAccountId } : {}) });
  b.data = applyOps(b.data, r.ops);
  return r.item.id;
};
const monthly = (day: number): Schedule => ({ freq: 'monthly', interval: 1, day: day as never, anchor: '2026-01-01' });
const occ = (b: Book) => expandOccurrences(b.data.recurring, b.data.exceptions, b.data.transactions, { from: '2026-09-01', to: '2026-10-31', today: b.today });
const status = (b: Book, name: string, date: string) => occ(b).find((o) => o.name === name && o.originalDate === date)?.status;
const same = (b: Book) => JSON.stringify([b.data.transactions, b.data.importBatches, b.data.recurring, b.data.exceptions]);
/** Commit with the review's own defaults: a link only where the review pre-selects it (strong). */
const commitDefaults = (b: Book, rv: ReturnType<Book['review']>, decide: Record<string, string> = {}, extra: { other?: Record<string, ID>; link?: Record<string, boolean> } = {}) => {
  const decisions = b.decisions(rv, decide, extra.other).map((d) => ({ ...d, linkOccurrence: extra.link?.[d.candidate.rawDescription] ?? !!d.candidate.occurrenceMatch?.strong }));
  return b.commit(rv, {}, { decisions });
};
const rent = (b: Book, c: ID) => rec(b, c, 'Rent', 'bill', monthly(15), { type: 'fixed', cents: 30000 });

describe('the suggestion: amount and date alone never link', () => {
  it('exact amount and date, unrelated payee ("TARGET 0912" $300 vs Rent $300 due Sep 15): shown, not selected; imported unlinked → $100', () => {
    const { b, c } = setup();
    rent(b, c);
    expect(b.sts()).toBe(40000);
    const rv = b.review(c, [['2026-09-12', 'TARGET 0912', -30000, 70000]], undefined, { schedules: true });
    expect(row(rv, 'TARGET 0912').occurrenceMatch).toMatchObject({ name: 'Rent', originalDate: '2026-09-15', strong: false, evidence: null });
    commitDefaults(b, rv);
    // Checking 700; Sep 15 and Oct 15 rent still due → 100; the rent is still unpaid
    expect([b.sts(), status(b, 'Rent', '2026-09-15'), b.data.transactions[0]!.occurrenceRef]).toEqual([10000, 'expected', undefined]);
  });

  it('a genuine match ("ACH RENT OAKWOOD" $300, Sep 14): strong (the name is in the description), selected → linked → $400', () => {
    const { b, c } = setup();
    rent(b, c);
    const rv = b.review(c, [['2026-09-14', 'ACH RENT OAKWOOD', -30000, 70000]], undefined, { schedules: true });
    expect(row(rv, 'ACH RENT OAKWOOD').occurrenceMatch).toMatchObject({ name: 'Rent', strong: true, evidence: 'name' });
    commitDefaults(b, rv);
    expect([b.sts(), status(b, 'Rent', '2026-09-15')]).toEqual([40000, 'confirmed']);
  });

  it('the user rejects a strong suggestion: imported independent; the rent stays due → $100', () => {
    const { b, c } = setup();
    rent(b, c);
    const rv = b.review(c, [['2026-09-14', 'ACH RENT OAKWOOD', -30000, 70000]], undefined, { schedules: true });
    commitDefaults(b, rv, {}, { link: { 'ACH RENT OAKWOOD': false } });
    expect([b.sts(), status(b, 'Rent', '2026-09-15')]).toEqual([10000, 'expected']);
  });

  it('exact amount and payee but 14 days before the due date: not eligible, no suggestion', () => {
    const { b, c } = setup();
    rent(b, c);
    const rv = b.review(c, [['2026-09-01', 'ACH RENT OAKWOOD', -30000, 70000]], undefined, { schedules: true });
    expect(row(rv, 'ACH RENT OAKWOOD').occurrenceMatch).toBeNull();
  });

  it('similar payee, different amount: a fixed $300 rent isn\'t suggested for $250; a variable electric estimate ($90) is for $100 with its name', () => {
    const { b, c } = setup();
    rent(b, c);
    rec(b, c, 'Electric', 'bill', monthly(16), { type: 'variable', cents: 9000 });
    const rv = b.review(c, [['2026-09-14', 'ACH RENT OAKWOOD', -25000, 75000], ['2026-09-14', 'CITY ELECTRIC CO', -10000, 65000]], undefined, { schedules: true });
    expect(row(rv, 'ACH RENT OAKWOOD').occurrenceMatch).toBeNull();
    expect(row(rv, 'CITY ELECTRIC CO').occurrenceMatch).toMatchObject({ name: 'Electric', strong: true });
  });

  it('no scheduled item fits: no suggestion; imported normally', () => {
    const { b, c } = setup();
    rent(b, c);
    const rv = b.review(c, [['2026-09-12', 'COFFEE', -500, 99500]], undefined, { schedules: true });
    expect(row(rv, 'COFFEE').occurrenceMatch).toBeNull();
    commitDefaults(b, rv);
    // 995 − 600 = 395
    expect(b.sts()).toBe(39500);
  });

  it('two bills with the same amount (Water $80, Internet $80, due Sep 14): "PAYMENT 0912" is ambiguous (not selected); "COMCAST INTERNET" is Internet (strong)', () => {
    const { b, c } = setup();
    rec(b, c, 'Water', 'bill', monthly(14), { type: 'fixed', cents: 8000 });
    rec(b, c, 'Internet', 'bill', monthly(14), { type: 'fixed', cents: 8000 });
    const rv = b.review(c, [['2026-09-12', 'PAYMENT 0912', -8000, 92000], ['2026-09-12', 'COMCAST INTERNET', -8000, 84000]], undefined, { schedules: true });
    expect(row(rv, 'PAYMENT 0912').occurrenceMatch).toMatchObject({ strong: false, ambiguous: true });
    expect(row(rv, 'COMCAST INTERNET').occurrenceMatch).toMatchObject({ name: 'Internet', strong: true, ambiguous: false });
    commitDefaults(b, rv);
    // Checking 1,000 − 160 = 840; Water Sep 14 + Oct 14 = 160, Internet Oct 14 = 80 → 840 − 240 = 600
    expect([b.sts(), status(b, 'Internet', '2026-09-14'), status(b, 'Water', '2026-09-14')]).toEqual([60000, 'confirmed', 'expected']);
  });

  it('two bills with similar names ("Phone - Mike", "Phone - Ana", $50): "VERIZON PHONE" is ambiguous; "VERIZON PHONE MIKE" is Mike\'s', () => {
    const { b, c } = setup();
    rec(b, c, 'Phone - Mike', 'bill', monthly(14), { type: 'fixed', cents: 5000 });
    rec(b, c, 'Phone - Ana', 'bill', monthly(14), { type: 'fixed', cents: 5000 });
    const rv = b.review(c, [['2026-09-12', 'VERIZON PHONE', -5000, 95000], ['2026-09-12', 'VERIZON PHONE MIKE', -5000, 90000]], undefined, { schedules: true });
    expect(row(rv, 'VERIZON PHONE').occurrenceMatch?.strong).toBe(false);
    expect(row(rv, 'VERIZON PHONE MIKE').occurrenceMatch).toMatchObject({ name: 'Phone - Mike', strong: true });
  });

  it('a recurring bill with two occurrences equally close (every 6 days: Sep 15, Sep 21; a Sep 18 payment): not selected; one clearly closer is', () => {
    const { b, c } = setup();
    rec(b, c, 'Gym', 'bill', { freq: 'every_n_days', interval: 6, anchor: '2026-09-03' }, { type: 'fixed', cents: 2000 });
    expect(occ(b).filter((o) => o.name === 'Gym').slice(0, 2).map((o) => o.originalDate)).toEqual(['2026-09-15', '2026-09-21']);
    const tie = suggestOccurrenceLink({ accountId: c, date: '2026-09-18', amountCents: -2000, merchant: 'GYM CLUB', kind: 'expense' }, occ(b), b.data.transactions);
    expect([tie?.strong, tie?.ambiguous]).toEqual([false, true]);
    const closer = suggestOccurrenceLink({ accountId: c, date: '2026-09-14', amountCents: -2000, merchant: 'GYM CLUB', kind: 'expense' }, occ(b), b.data.transactions);
    expect([closer?.occurrence.originalDate, closer?.strong]).toEqual(['2026-09-15', true]);
  });

  it('a one-time planned payment ("Car repair" $450 on Sep 16): strong with its name; weak for an unrelated $450', () => {
    const { b, c } = setup();
    rec(b, c, 'Car repair', 'bill', { freq: 'once', date: '2026-09-16' }, { type: 'fixed', cents: 45000 });
    const rv = b.review(c, [['2026-09-15', 'JOE CAR REPAIR', -45000, 55000]], undefined, { schedules: true });
    expect(row(rv, 'JOE CAR REPAIR').occurrenceMatch).toMatchObject({ name: 'Car repair', strong: true });
    const rv2 = b.review(c, [['2026-09-15', 'BEST BUY 4411', -45000, 55000]], undefined, { schedules: true });
    expect(row(rv2, 'BEST BUY 4411').occurrenceMatch?.strong).toBe(false);
    commitDefaults(b, rv);
    // Checking 550; nothing else due → 550
    expect([b.sts(), status(b, 'Car repair', '2026-09-16')]).toEqual([55000, 'confirmed']);
  });

  it('the same payee linked to this item before is evidence ("history")', () => {
    const { b, c } = setup();
    const id = rent(b, c);
    b.data = applyOps(b.data, addTransaction(b.ctx(), { kind: 'expense', accountId: c, date: '2026-08-15', amountCents: 30000, merchant: 'OAKWOOD MGMT', categoryId: null, occurrenceRef: { recurringId: id, originalDate: '2026-08-15' } }).ops);
    const s = suggestOccurrenceLink({ accountId: c, date: '2026-09-14', amountCents: -30000, merchant: 'OAKWOOD MGMT', kind: 'expense' }, occ(b), b.data.transactions);
    expect([s?.occurrence.originalDate, s?.evidence, s?.strong]).toEqual(['2026-09-15', 'history', true]);
  });

  it('kinds must fit: a refund, a transfer to a card, or income never settles a bill', () => {
    const { b, c } = setup();
    const v = b.acct('Visa', 'credit_card', 0);
    rent(b, c);
    const o = occ(b).find((x) => x.name === 'Rent')!;
    const base = { accountId: c, date: '2026-09-14', amountCents: -30000, merchant: 'RENT' };
    expect([occurrenceEligible({ ...base, kind: 'expense' }, o), occurrenceEligible({ ...base, kind: 'transfer', toAccountId: v }, o), occurrenceEligible({ ...base, amountCents: 30000, kind: 'refund' }, o)]).toEqual([true, false, false]);
  });
});

describe('the original discrepancy (sample data, Phase 4A.8 report)', () => {
  it('"PAYMENT TO STORE CARD −$100" is not offered against the Electricity bill (estimated $91.40, Nov 18): Safe to Spend stays $2,177.17', () => {
    const NOW = Date.UTC(2026, 10, 13, 15);
    const b = new Book();
    b.data = buildDemoWorkspace('2026-11-13', NOW);
    b.today = '2026-11-13';
    const r = createAccount(b.ctx(), { name: 'Store card', type: 'credit_card', currentBalanceCents: 25000 });
    b.data = applyOps(b.data, r.ops);
    const chk = b.data.accounts.find((a) => a.name === 'Everyday Checking')!.id;
    const elec = expandOccurrences(b.data.recurring, b.data.exceptions, b.data.transactions, { from: '2026-11-01', to: '2026-11-30', today: b.today }).find((o) => o.name === 'Electricity')!;
    expect([elec.date, elec.amountCents, elec.amountBasis, b.sts()]).toEqual(['2026-11-18', 9140, 'history_average', 217717]);
    const lines: Line[] = [['2026-11-12', 'PAYMENT TO STORE CARD', -10000, 277123], ['2026-11-13', 'RETURNED PAYMENT', 10000, 287123]];
    const rv = b.review(chk, lines, undefined, { schedules: true });
    // before 4A.9 this row was offered Electricity (amount within 25% of $91.40, 6 days before it) and it was ticked
    expect(row(rv, 'PAYMENT TO STORE CARD').occurrenceMatch).toBeNull();
    commitDefaults(b, rv, { 'PAYMENT TO STORE CARD': 'auto', 'RETURNED PAYMENT': `row:${row(rv, 'RETURNED PAYMENT').statementReturnOf![0]!.paymentRow}` }, { other: { 'PAYMENT TO STORE CARD': r.account.id } });
    // Checking −100 + 100; Store card still owes 250; Electricity still due → $2,177.17 (it was $2,268.57)
    const after = expandOccurrences(b.data.recurring, b.data.exceptions, b.data.transactions, { from: '2026-11-01', to: '2026-11-30', today: b.today }).find((o) => o.name === 'Electricity')!;
    expect([b.sts(), after.status]).toEqual([217717, 'estimated']);
    // the pre-4A.8 shape (the row imported as an expense with no payee named): still only a suggestion, not selected
    const rv2 = b.review(chk, [['2026-11-12', 'ONLINE PMT 7781', -10000, 277123]], undefined, { schedules: true });
    expect(row(rv2, 'ONLINE PMT 7781').occurrenceMatch).toMatchObject({ name: 'Electricity', strong: false });
  });
});

describe('commitImport validates every link itself', () => {
  const rentRow: Line = ['2026-09-14', 'ACH RENT OAKWOOD', -30000, 70000];
  it('the scheduled item already paid since the review (Mark paid): refused, nothing changes', () => {
    const { b, c } = setup();
    const id = rent(b, c);
    const rv = b.review(c, [rentRow], undefined, { schedules: true });
    b.data = applyOps(b.data, addTransaction(b.ctx(), { kind: 'expense', accountId: c, date: '2026-09-13', amountCents: 30000, merchant: 'Rent', categoryId: null, occurrenceRef: { recurringId: id, originalDate: '2026-09-15' } }).ops);
    const before = same(b);
    expect(errorOf(() => commitDefaults(b, rv))).toMatchObject({ field: 'stale', message: expect.stringMatching(/“Rent” due Sep 15 is already recorded by another transaction/) });
    expect(same(b)).toBe(before);
    // and a fresh review doesn't offer it any more
    expect(row(b.review(c, [rentRow], undefined, { schedules: true }), 'ACH RENT OAKWOOD').occurrenceMatch).toBeNull();
  });
  it('the item changed (amount), was skipped, or deleted after the review: refused, nothing changes', () => {
    for (const change of ['amount', 'skip', 'delete'] as const) {
      const { b, c } = setup();
      const id = rent(b, c);
      const rv = b.review(c, [rentRow], undefined, { schedules: true });
      if (change === 'amount') b.data = applyOps(b.data, updateRecurring(b.ctx(), id, { name: 'Rent', kind: 'bill', accountId: c, categoryId: null, schedule: monthly(15), amount: { type: 'fixed', cents: 32000 } }));
      if (change === 'skip') b.data = applyOps(b.data, setOccurrenceException(b.ctx(), occ(b).find((o) => o.originalDate === '2026-09-15')!, 'skip'));
      if (change === 'delete') b.data = applyOps(b.data, deleteRecurring(b.ctx(), id));
      const before = same(b);
      expect(errorOf(() => commitDefaults(b, rv)), change).toMatchObject({ message: expect.stringMatching(change === 'amount' ? /can't be the payment of “Rent”/ : change === 'skip' ? /was skipped/ : /no longer exists/) });
      expect(same(b), change).toBe(before);
    }
  });
  it('a direct call linking an ineligible row (a refund, or a transfer to a card) or two rows to one occurrence is refused', () => {
    const { b, c } = setup();
    const v = b.acct('Visa', 'credit_card', 0);
    rent(b, c);
    const rv = b.review(c, [rentRow, ['2026-09-14', 'RENT AGAIN', -30000, 40000]], undefined, { schedules: true });
    const m = row(rv, 'ACH RENT OAKWOOD').occurrenceMatch!;
    const base = b.decisions(rv, { 'RENT AGAIN': 'skip' });
    const before = same(b);
    // forged: the rent link on a transfer to Visa
    expect(errorOf(() => b.commit(rv, {}, { decisions: base.map((d) => ({ ...d, kind: 'transfer' as const, otherAccountId: v, linkOccurrence: true })) }))?.message).toMatch(/can't be the payment of “Rent”/);
    // forged: both rows linked to the same occurrence
    const both = b.decisions(rv, {}).map((d) => ({ ...d, candidate: { ...d.candidate, occurrenceMatch: m }, linkOccurrence: true }));
    expect(errorOf(() => b.commit(rv, {}, { decisions: both }))?.message).toMatch(/already linked to another row of this statement/);
    expect(same(b)).toBe(before);
  });
  it('two tabs link the same rent: the second commit is refused by storage; the rent is recorded once', async () => {
    const { b, c } = setup();
    rent(b, c);
    const adapter = new MemoryAdapter();
    const provider = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
    const { store: init } = await WorkspaceStore.create(adapter, provider, 'correct horse battery', { withRecoveryKey: false, now: 1 });
    await init.apply([...b.data.accounts.map((a) => ({ t: 'put' as const, table: 'accounts' as const, value: a })), ...b.data.recurring.map((r) => ({ t: 'put' as const, table: 'recurring' as const, value: r }))]);
    const tabA = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const tabB = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const opsFor = (store: WorkspaceStore, line: Line) => {
      const x = new Book(); x.data = store.data; x.today = b.today;
      const rv = x.review(c, [line], undefined, { schedules: true });
      const decisions = x.decisions(rv, {}).map((d) => ({ ...d, linkOccurrence: true }));
      return commitImport(store.ctx(5, b.today), { accountId: c, fileName: 's.csv', fileHash: line[1], parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: rv.settings, decisions, totalRows: 1, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: null, applyAdjustment: false }).ops;
    };
    const a = opsFor(tabA, rentRow); const bOps = opsFor(tabB, ['2026-09-14', 'RENT OAKWOOD ONLINE', -30000, 70000]);
    await tabA.apply(a);
    await expect(tabB.apply(bOps)).rejects.toBeInstanceOf(StaleDataError);
    const stored = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    expect(stored.data.transactions.filter((t) => t.occurrenceRef?.originalDate === '2026-09-15').length).toBe(1);
  });
  it('undo of the import removes the link (the rent is due again → $400 → 1,000 − 600); re-importing offers it again', () => {
    const { b, c } = setup();
    rent(b, c);
    const res = commitDefaults(b, b.review(c, [rentRow], undefined, { schedules: true }));
    expect(b.sts()).toBe(40000);
    b.undo(res.batch.id);
    expect([b.sts(), status(b, 'Rent', '2026-09-15'), b.data.transactions.length]).toEqual([40000, 'expected', 0]);
    const again = b.review(c, [rentRow], undefined, { schedules: true });
    expect(row(again, 'ACH RENT OAKWOOD').occurrenceMatch).toMatchObject({ strong: true });
    commitDefaults(b, again);
    expect([b.sts(), status(b, 'Rent', '2026-09-15')]).toEqual([40000, 'confirmed']);
  });
  it('the pairing rules of 4A.8 are unaffected by a scheduled-item link on the payment row', () => {
    const { b, c } = setup();
    const v = b.acct('Visa', 'credit_card', 50000);
    rec(b, c, 'Visa payment', 'transfer', monthly(15), { type: 'fixed', cents: 20000 }, v);
    const rv = b.review(c, [['2026-09-14', 'VISA PAYMENT', -20000, 80000], ['2026-09-14', 'RETURNED PAYMENT', 20000, 100000]], undefined, { schedules: true });
    expect(row(rv, 'VISA PAYMENT').occurrenceMatch).toMatchObject({ name: 'Visa payment', strong: true });
    commitDefaults(b, rv, { 'VISA PAYMENT': 'auto', 'RETURNED PAYMENT': `row:${row(rv, 'RETURNED PAYMENT').statementReturnOf![0]!.paymentRow}` }, { other: { 'VISA PAYMENT': v } });
    // the scheduled Sep 15 Visa payment is recorded by the payment row (and its return is recorded too)
    expect([status(b, 'Visa payment', '2026-09-15'), b.data.transactions.filter((t) => t.returnOf).length, b.rec(c)]).toEqual(['confirmed', 2, 100000]);
  });
});

describe('manual entry and later linking (data commands)', () => {
  it('imported independently, later linked by hand (Edit) → the rent is recorded once → $400; linking it again from another transaction is refused', () => {
    const { b, c } = setup();
    const id = rent(b, c);
    commitDefaults(b, b.review(c, [['2026-09-14', 'CHECK 5561', -30000, 70000]], undefined, { schedules: true }));
    expect(b.sts()).toBe(10000);
    const t = b.data.transactions[0]!;
    b.data = applyOps(b.data, updateTransaction(b.ctx(), t.id, { kind: 'expense', accountId: c, date: t.date, amountCents: 30000, merchant: t.merchant, categoryId: null, occurrenceRef: { recurringId: id, originalDate: '2026-09-15' } }).ops);
    expect([b.sts(), status(b, 'Rent', '2026-09-15')]).toEqual([40000, 'confirmed']);
    const before = same(b);
    expect(errorOf(() => addTransaction(b.ctx(), { kind: 'expense', accountId: c, date: '2026-09-15', amountCents: 30000, merchant: 'Rent', categoryId: null, occurrenceRef: { recurringId: id, originalDate: '2026-09-15' } }))).toMatchObject({ field: 'occurrence', message: expect.stringMatching(/Rent due Sep 15 is already recorded by .*A scheduled payment is settled by one transaction/) });
    expect(same(b)).toBe(before);
  });
  it('a link to a deleted item, or to an item scheduled from another account, is refused', () => {
    const { b, c } = setup();
    const s = b.acct('Savings', 'savings', 0);
    const id = rent(b, c);
    expect(errorOf(() => addTransaction(b.ctx(), { kind: 'expense', accountId: s, date: '2026-09-15', amountCents: 30000, merchant: 'Rent', categoryId: null, occurrenceRef: { recurringId: id, originalDate: '2026-09-15' } }))?.message).toMatch(/scheduled from Checking, not this account/);
    b.data = applyOps(b.data, deleteRecurring(b.ctx(), id));
    expect(errorOf(() => addTransaction(b.ctx(), { kind: 'expense', accountId: c, date: '2026-09-15', amountCents: 30000, merchant: 'Rent', categoryId: null, occurrenceRef: { recurringId: id, originalDate: '2026-09-15' } }))?.message).toMatch(/no longer exists/);
  });
});
