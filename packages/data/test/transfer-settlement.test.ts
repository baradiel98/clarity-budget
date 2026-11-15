import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNobleProvider } from '@clarity/security/noble';
import { canIAfford, computeSafeToSpend } from '@clarity/engine';
import { snapshotOf } from '@clarity/import';
import {
  applyOps, adjustBalance, commitImport, deleteTransaction, describeImportResult, describeImportUndo, engineInput, importUndoProblem, MemoryAdapter, StaleDataError,
  transferSettlement, updateTransaction, WorkspaceStore,
} from '../src';
import { Book, errorOf, row, statuses } from './fixtures/settlement-harness';

/**
 * Phase 4A.5.14: independent transfer settlement and reconciliation integrity. One test (or group) per Phase 4A.5.13
 * audit finding (D1–D9) plus the cases the phase asked for. Truth = each bank's own ledger; every expected value is
 * worked out by hand in the comments. Checking and Savings opened Sep 1 at $1,000.00 each; today Sep 12, 2026.
 */
const two = () => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', 100000);
  const s = b.acct('Savings', 'savings', 100000);
  b.at('2026-09-12');
  return { b, c, s };
};

describe('D1: posting one transfer leg never posts the other', () => {
  it('checking → savings $100 (pending at both); the checking statement links its leg → savings still pending; "Sent · awaiting deposit"', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    const rv = b.review(c, [['2026-09-11', 'ONLINE TRANSFER TO SAV', -10000, 90000]]);
    expect(b.live(rv, 'ONLINE TRANSFER TO SAV').map((m) => [m.txId, m.status])).toEqual([[t.out.id, 'pending']]);
    const res = b.commit(rv, { 'ONLINE TRANSFER TO SAV': t.out.id });
    // checking bank: 1,000 − 100 = 900 posted; savings bank: still 1,000 (the deposit hasn't posted there)
    expect(statuses(b, t.out.id, t.in.id)).toEqual(['confirmed', 'pending']);
    expect([b.posted(c), b.posted(s), b.rec(s), b.tx(t.out.id).postedDate]).toEqual([90000, 100000, 110000, '2026-09-11']);
    expect(res.recon!.differenceCents).toBe(0);
    expect(transferSettlement(b.tx(t.out.id), b.data.transactions, b.data.accounts)).toBe('Sent · awaiting deposit in Savings');
    expect(transferSettlement(b.tx(t.in.id), b.data.transactions, b.data.accounts)).toBe('Sent from Checking · awaiting deposit');
    // a savings statement that ends before the deposit posts agrees with Clarity (was: −$100 and an offered adjustment)
    expect(b.commit(b.review(s, [['2026-09-12', 'INTEREST', 100, 100100]]), { INTEREST: 'none' }).recon!.differenceCents).toBe(0); // the pending $100 is listed for the $1 row too (any amount): "different"
  });
  it('marking one leg posted (transaction list or Update balance) posts that leg only', () => {
    const { b, c, s } = two();
    const t = b.transfer(s, c, '2026-09-10', 10000);
    b.post(t.out.id);
    expect(statuses(b, t.out.id, t.in.id)).toEqual(['confirmed', 'pending']);
    b.post(t.in.id);
    expect(statuses(b, t.out.id, t.in.id)).toEqual(['confirmed', 'confirmed']);
    expect(transferSettlement(b.tx(t.in.id), b.data.transactions, b.data.accounts)).toBeNull();
  });
  it('the receiving side first: the savings statement links its leg; checking still pending ("Received · not yet posted by Checking"); its debit still counts', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    b.commit(b.review(s, [['2026-09-11', 'DEPOSIT FROM CHK', 10000, 110000]]), { 'DEPOSIT FROM CHK': t.in.id });
    expect(statuses(b, t.out.id, t.in.id)).toEqual(['pending', 'confirmed']);
    expect(transferSettlement(b.tx(t.in.id), b.data.transactions, b.data.accounts)).toBe('Received · not yet posted by Checking');
    // Safe to Spend: checking 1,000 − 100 pending debit = 900 (savings isn't spendable)
    expect([b.posted(c), b.posted(s), b.sts()]).toEqual([100000, 110000, 90000]);
  });
  it('audit A1b: the deposit posts 9 days after the transfer (8–11 days apart): its leg is still pending, so it is listed and linked; no second transfer', () => {
    for (const days of [8, 9, 10, 11]) {
      const { b, c, s } = two();
      const t = b.transfer(c, s, '2026-09-02', 10000);
      b.commit(b.review(c, [['2026-09-03', 'TRANSFER OUT', -10000, 90000]]), { 'TRANSFER OUT': t.out.id });
      const d = `2026-09-${String(2 + days).padStart(2, '0')}`;
      b.at('2026-09-20');
      const rv = b.review(s, [[d, 'TRANSFER IN', 10000, 110000]]);
      expect(b.live(rv, 'TRANSFER IN').map((m) => [m.txId, m.basis])).toEqual([[t.in.id, days > 10 ? 'stale' : 'pending']]);
      b.commit(rv, { 'TRANSFER IN': t.in.id });
      expect([b.posted(c), b.posted(s), b.transfers(), b.data.transactions.length], `${days} days`).toEqual([90000, 110000, 1, 2]);
    }
  });
  it('both sides imported in either order, and each statement re-imported: one transfer, both linked, nothing added', () => {
    for (const first of ['checking', 'savings'] as const) {
      const { b, c, s } = two();
      const t = b.transfer(c, s, '2026-09-10', 10000);
      const chk = (): Parameters<Book['review']>[1] => [['2026-09-11', 'TO SAVINGS', -10000, 90000]];
      const sav = (): Parameters<Book['review']>[1] => [['2026-09-12', 'FROM CHECKING', 10000, 110000]];
      const doC = () => b.commit(b.review(c, chk()), { 'TO SAVINGS': t.out.id });
      const doS = () => b.commit(b.review(s, sav()), { 'FROM CHECKING': t.in.id });
      if (first === 'checking') { doC(); doS(); } else { doS(); doC(); }
      for (const [acct, lines] of [[c, chk()], [s, sav()]] as const) {
        const again = b.review(acct, lines);
        expect(again.preview.candidates.map((x) => [x.duplicate?.level, x.include])).toEqual([['exact', false]]);
        b.commit(again);
      }
      expect([b.posted(c), b.posted(s), b.transfers(), b.data.transactions.length, statuses(b, t.out.id, t.in.id)]).toEqual([90000, 110000, 1, 2, ['confirmed', 'confirmed']]);
    }
  });
  it('a row imported as a NEW transfer posts this account\'s leg only; the other account\'s leg awaits its bank — unless that account\'s confirmed balance already includes it', () => {
    const { b, c, s } = two();
    const r1 = b.commit(b.review(c, [['2026-09-10', 'ONLINE TRANSFER', -10000, 90000]]), { 'ONLINE TRANSFER': 'auto' }, { other: { 'ONLINE TRANSFER': s } });
    const [out, inc] = [r1.txs.find((t) => t.amountCents < 0)!, r1.txs.find((t) => t.amountCents > 0)!];
    expect([out.status, inc.status, r1.batch.counts.awaiting, b.sts()]).toEqual(['confirmed', 'pending', 1, 90000]);
    // Savings confirmed its balance on Sep 11 (Update balance, matched): a row dated Sep 10 is already in it
    const x = two();
    x.b.data = applyOps(x.b.data, adjustBalance(x.b.ctx(), x.s, 100000, 'Matched', '2026-09-11').ops);
    const r2 = x.b.commit(x.b.review(x.c, [['2026-09-10', 'ONLINE TRANSFER', -10000, 90000]]), { 'ONLINE TRANSFER': 'auto' }, { other: { 'ONLINE TRANSFER': x.s } });
    const inc2 = r2.txs.find((t) => t.amountCents > 0)!;
    expect([inc2.status, inc2.includedInBalance, x.b.rec(x.s)]).toEqual(['confirmed', true, 100000]);
  });
});

describe('D2: an incoming transfer still pending is not spendable', () => {
  it('savings → checking $100 pending: Safe to Spend $1,000 (not $1,100); "Can I afford $1,050?" is not yes; it counts once checking posts it', () => {
    const { b, c, s } = two();
    const t = b.transfer(s, c, '2026-09-10', 10000);
    expect(b.sts()).toBe(100000);
    const i = engineInput(b.data, b.today);
    expect(canIAfford(i, { amountCents: 105000, accountId: c, date: b.today }).verdict).not.toBe('yes');
    expect(computeSafeToSpend(i).explanation.lines.some((l) => /Checking: pending credit not yet available/.test(l.label))).toBe(true);
    b.commit(b.review(s, [['2026-09-11', 'TO CHECKING', -10000, 90000]]), { 'TO CHECKING': t.out.id }); // savings side posts
    expect(b.sts()).toBe(100000); // still not at checking's bank
    b.commit(b.review(c, [['2026-09-12', 'FROM SAVINGS', 10000, 110000]]), { 'FROM SAVINGS': t.in.id });
    expect(b.sts()).toBe(110000);
  });
  it('a pending outgoing transfer still reduces the sender at once: checking → savings $300 pending → $700', () => {
    const { b, c, s } = two();
    b.transfer(c, s, '2026-09-10', 30000);
    expect(b.sts()).toBe(70000);
  });
  it('negative savings (−$50) with $100 on its way in: the $50 is still owed until it posts ($850); then $900', () => {
    const b = new Book();
    const c = b.acct('Checking', 'checking', 100000);
    const s = b.acct('Savings', 'savings', -5000);
    b.at('2026-09-12');
    const t = b.transfer(c, s, '2026-09-10', 10000);
    expect(b.sts()).toBe(85000); // 1,000 − 100 − 50
    b.post(t.in.id);
    expect(b.sts()).toBe(90000); // 1,000 − 100; savings +50
  });
  it('negative checking (−$50) with $100 on its way in from savings: still −$50 until it posts; then $50', () => {
    const b = new Book();
    const c = b.acct('Checking', 'checking', -5000);
    const s = b.acct('Savings', 'savings', 100000);
    b.at('2026-09-12');
    const t = b.transfer(s, c, '2026-09-10', 10000);
    expect(b.sts()).toBe(-5000);
    b.post(t.in.id);
    expect(b.sts()).toBe(5000);
  });
  it('a cash account (spendable) receiving a pending transfer: not counted until posted', () => {
    const b = new Book();
    const c = b.acct('Checking', 'checking', 100000);
    const w = b.acct('Wallet', 'cash', 0);
    b.at('2026-09-12');
    const t = b.transfer(c, w, '2026-09-10', 10000);
    expect(b.sts()).toBe(90000);
    b.post(t.in.id);
    expect(b.sts()).toBe(100000);
  });
  it('an archived account overdrawn by $50 with $100 pending in: the $50 is still owed ($950); posted → $1,000', () => {
    const { b, c, s } = two();
    const old = b.acct('Old checking', 'checking', -5000);
    const t = b.transfer(s, old, '2026-09-12', 10000); // Old was added today (Sep 12)
    b.data = applyOps(b.data, [{ t: 'put', table: 'accounts', value: { ...b.a(old), archived: true } }]);
    expect(b.sts()).toBe(95000);
    b.post(t.in.id);
    expect(b.sts()).toBe(100000);
    void c;
  });
  it('different confirmed balance dates: savings confirmed Sep 11; a pending transfer in dated Sep 10 stays pending and unspendable on both sides of that date', () => {
    const { b, c, s } = two();
    b.data = applyOps(b.data, adjustBalance(b.ctx(), s, 100000, 'Matched', '2026-09-11').ops);
    const t = b.transfer(s, c, '2026-09-10', 10000);
    expect([b.tx(t.in.id).includedInBalance, b.tx(t.out.id).includedInBalance, b.sts()]).toEqual([undefined, undefined, 100000]);
  });
});

describe('D3: undo reverses only its own leg and its own changes', () => {
  it('both legs linked by two imports; undo the savings import → only the savings leg is pending again; the checking link stays; then undo checking → as before any import', () => {
    const { b, c, s } = two();
    const t = b.transfer(s, c, '2026-09-10', 10000);
    const r1 = b.commit(b.review(s, [['2026-09-11', 'TO CHECKING', -10000, 90000]]), { 'TO CHECKING': t.out.id });
    const r2 = b.commit(b.review(c, [['2026-09-12', 'FROM SAVINGS', 10000, 110000]]), { 'FROM SAVINGS': t.in.id });
    expect(describeImportUndo(b.data, r1.batch.id)).toBe('Import undone. Removed 0 imported transactions; “Transfer” in Savings is pending again and no longer linked to the statement; the other side in Checking is unchanged (posted).');
    b.undo(r1.batch.id);
    expect([statuses(b, t.out.id, t.in.id), !!b.tx(t.out.id).statementMatch, b.tx(t.in.id).statementMatch?.importBatchId, b.posted(c), b.posted(s)]).toEqual([['pending', 'confirmed'], false, r2.batch.id, 110000, 100000]);
    // the checking statement still recognises its row (no re-link, no duplicate)
    expect(b.review(c, [['2026-09-12', 'FROM SAVINGS', 10000, 110000]]).preview.candidates[0]!.duplicate?.level).toBe('exact');
    b.undo(r2.batch.id);
    expect([statuses(b, t.out.id, t.in.id), b.posted(c), b.posted(s), b.sts()]).toEqual([['pending', 'pending'], 100000, 100000, 100000]);
  });
  it('a later posting decision on the other leg is kept: checking linked; the user marks the savings leg posted by hand; undo checking → checking pending, savings still posted', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    const r = b.commit(b.review(c, [['2026-09-11', 'TO SAVINGS', -10000, 90000]]), { 'TO SAVINGS': t.out.id });
    b.post(t.in.id);
    b.undo(r.batch.id);
    expect(statuses(b, t.out.id, t.in.id)).toEqual(['pending', 'confirmed']);
  });
  it('a later edit is kept: the linked item\'s description edited after the import; undo keeps the new description and restores only the status', () => {
    const { b, c } = two();
    const p = b.add({ kind: 'expense', accountId: c, date: '2026-09-09', amountCents: 5000, merchant: 'Dinner', categoryId: null, status: 'pending' })[0]!;
    const r = b.commit(b.review(c, [['2026-09-10', 'BISTRO 22', -5000, 95000]]), { 'BISTRO 22': p.id });
    b.data = applyOps(b.data, updateTransaction(b.ctx(), p.id, { kind: 'expense', accountId: c, date: '2026-09-09', amountCents: 5000, merchant: 'Bistro dinner', categoryId: null, status: 'confirmed' }).ops);
    b.undo(r.batch.id);
    expect([b.tx(p.id).status, b.tx(p.id).merchant, !!b.tx(p.id).statementMatch]).toEqual(['pending', 'Bistro dinner', false]);
  });
  it('undo is refused (nothing changed) when a later import linked something this import created; allowed after that one is undone', () => {
    const { b, c, s } = two();
    const r1 = b.commit(b.review(c, [['2026-09-10', 'ONLINE TRANSFER', -10000, 90000]]), { 'ONLINE TRANSFER': 'auto' }, { other: { 'ONLINE TRANSFER': s } });
    const inc = r1.txs.find((t) => t.amountCents > 0)!;
    const r2 = b.commit(b.review(s, [['2026-09-11', 'FROM CHECKING', 10000, 110000]]), { 'FROM CHECKING': inc.id });
    expect(importUndoProblem(b.data, r1.batch.id)).toMatch(/now linked to a row of a later import \(statement\.csv\)\. Undo that import first\./);
    const before = b.data;
    expect(errorOf(() => b.undo(r1.batch.id))).toMatchObject({ field: 'undo' });
    expect(b.data).toBe(before);
    b.undo(r2.batch.id);
    b.undo(r1.batch.id);
    expect([b.data.transactions.length, b.posted(c), b.posted(s)]).toEqual([0, 100000, 100000]);
  });
});

describe('D4: old pending transactions stay discoverable', () => {
  it('a check entered Sep 2, cashed Sep 17 (15 days): listed as a stale candidate with its age; nothing chosen; linked → $800 once (was $600)', () => {
    const b = new Book();
    const c = b.acct('Checking', 'checking', 100000);
    b.at('2026-09-02');
    const chk = b.add({ kind: 'expense', accountId: c, date: '2026-09-02', amountCents: 20000, merchant: 'Check #101', categoryId: null, status: 'pending' })[0]!;
    b.at('2026-09-20');
    const rv = b.review(c, [['2026-09-17', 'CHECK 101', -20000, 80000]]);
    const r = row(rv, 'CHECK 101');
    expect([r.include, r.matchCandidates.map((m) => [m.txId, m.basis, m.ageDays, m.differenceCents])]).toEqual([false, [[chk.id, 'stale', 15, 0]]]);
    expect(errorOf(() => b.commit(rv, { 'CHECK 101': 'auto' }))).toMatchObject({ field: 'match' }); // never imported silently
    b.commit(rv, { 'CHECK 101': chk.id });
    expect([b.rec(c), b.posted(c), b.sts(), b.data.transactions.length]).toEqual([80000, 80000, 80000, 1]);
  });
  it('a stale candidate of a different amount is listed with the difference; "different" must include it', () => {
    const b = new Book();
    const c = b.acct('Checking', 'checking', 100000);
    b.at('2026-09-02');
    const old = b.add({ kind: 'expense', accountId: c, date: '2026-09-02', amountCents: 4000, merchant: 'Hold', categoryId: null, status: 'pending' })[0]!;
    b.at('2026-09-25');
    const rv = b.review(c, [['2026-09-24', 'GROCERY', -6500, 93500]]);
    expect(b.live(rv, 'GROCERY').map((m) => [m.txId, m.basis, m.differenceCents])).toEqual([[old.id, 'stale', -2500]]);
    const res = b.commit(rv, { GROCERY: 'none' });
    expect([res.txs.length, res.txs[0]!.provenance.separateFrom, b.tx(old.id).status]).toEqual([1, [old.id], 'pending']);
  });
});

describe('D5: editing a linked or imported transaction never lets the same row in again', () => {
  it('a linked dinner edited ($50 → $55, date, description); re-importing the statement adds nothing', () => {
    const { b, c } = two();
    const p = b.add({ kind: 'expense', accountId: c, date: '2026-09-08', amountCents: 5000, merchant: 'Dinner', categoryId: null, status: 'pending' })[0]!;
    const lines: Parameters<Book['review']>[1] = [['2026-09-09', 'DINNER PLACE', -6000, 94000]];
    b.commit(b.review(c, lines), { 'DINNER PLACE': p.id });
    b.data = applyOps(b.data, updateTransaction(b.ctx(), p.id, { kind: 'expense', accountId: c, date: '2026-09-07', amountCents: 5500, merchant: 'Dinner with Sam', categoryId: null, status: 'confirmed' }).ops);
    const again = b.review(c, lines);
    expect(again.preview.candidates.map((x) => [x.duplicate?.level, x.include])).toEqual([['exact', false]]);
    expect(b.data.transactions.length).toBe(1);
  });
  it('an imported transaction edited (amount and date): re-importing finds it', () => {
    const { b, c } = two();
    const lines: Parameters<Book['review']>[1] = [['2026-09-09', 'HARDWARE STORE', -4200, 95800]];
    const r = b.commit(b.review(c, lines));
    b.data = applyOps(b.data, updateTransaction(b.ctx(), r.txs[0]!.id, { kind: 'expense', accountId: c, date: '2026-09-08', amountCents: 4000, merchant: 'Hardware', categoryId: null }).ops);
    expect(b.review(c, lines).preview.candidates[0]!.duplicate?.level).toBe('exact');
  });
  it('a linked transaction can\'t be made pending again by editing (undo the import instead)', () => {
    const { b, c } = two();
    const p = b.add({ kind: 'expense', accountId: c, date: '2026-09-08', amountCents: 5000, merchant: 'Dinner', categoryId: null, status: 'pending' })[0]!;
    b.commit(b.review(c, [['2026-09-09', 'DINNER PLACE', -5000, 95000]]), { 'DINNER PLACE': p.id });
    expect(errorOf(() => updateTransaction(b.ctx(), p.id, { kind: 'expense', accountId: c, date: '2026-09-08', amountCents: 5000, merchant: 'Dinner', categoryId: null, status: 'pending' }))).toMatchObject({ field: 'status', message: expect.stringMatching(/linked to a statement row .* undo that import/) });
  });
});

describe('D6: transfer fees and different amounts on transfer legs', () => {
  it('$100 sent, $95 received, the $5 fee confirmed: transfer $95 + fee $5 in checking; checking −$100 in total, savings +$95; one transfer', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    b.commit(b.review(c, [['2026-09-10', 'WIRE OUT', -10000, 90000]]), { 'WIRE OUT': t.out.id });
    const rv = b.review(s, [['2026-09-11', 'WIRE IN', 9500, 109500]]);
    const m = b.live(rv, 'WIRE IN')[0]!;
    expect([m.txId, m.differenceCents, m.feeOption]).toEqual([t.in.id, -500, { feeCents: 500, chargedToAccountId: c, principalCents: 9500 }]);
    const res = b.commit(rv, { 'WIRE IN': t.in.id });
    expect(res.recon!.differenceCents).toBe(0); // 1,000 + 95
    const fee = b.data.transactions.find((x) => x.transferFeeOf === t.out.transferGroupId)!;
    expect([b.tx(t.out.id).amountCents, b.tx(t.in.id).amountCents, fee.amountCents, fee.accountId, fee.kind, fee.status]).toEqual([-9500, 9500, -500, c, 'expense', 'confirmed']);
    expect([b.posted(c), b.posted(s), b.transfers(), b.data.transactions.length, res.batch.counts.fees]).toEqual([90000, 109500, 1, 3, 1]);
    // re-importing either statement adds nothing (the checking row is still recognised: −$95 + −$5 = −$100)
    expect(b.review(c, [['2026-09-10', 'WIRE OUT', -10000, 90000]]).preview.candidates[0]!.duplicate?.level).toBe('exact');
    expect(b.review(s, [['2026-09-11', 'WIRE IN', 9500, 109500]]).preview.candidates[0]!.duplicate?.level).toBe('exact');
    // undo the savings import: the fee is removed and the transfer is $100 again; the checking link is untouched
    expect(describeImportUndo(b.data, res.batch.id)).toMatch(/the \$5\.00 transfer fee is removed and the transfer is \$100\.00 again/);
    b.undo(res.batch.id);
    expect([b.tx(t.out.id).amountCents, b.tx(t.in.id).amountCents, b.tx(t.in.id).status, b.tx(t.out.id).status, b.data.transactions.length, b.posted(c)]).toEqual([-10000, 10000, 'pending', 'confirmed', 2, 90000]);
  });
  it('$95 received without a confirmed fee: linking is refused; leaving it out changes nothing; nothing is invented', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    const rv = b.review(s, [['2026-09-11', 'WIRE IN', 9500, 109500]]);
    const decisions = b.decisions(rv, { 'WIRE IN': t.in.id });
    const noFee = decisions.map((d) => ({ ...d, match: { txId: t.in.id, snapshot: (d.match as { snapshot: ReturnType<typeof snapshotOf> }).snapshot } }));
    expect(errorOf(() => b.commit(rv, {}, { decisions: noFee }))).toMatchObject({ field: 'match', message: expect.stringMatching(/Confirm the \$5\.00 transfer fee, or leave the row out/) });
    b.commit(rv, { 'WIRE IN': 'skip' });
    expect([b.tx(t.in.id).status, b.tx(t.in.id).amountCents, b.data.transactions.length, b.posted(s)]).toEqual(['pending', 10000, 2, 100000]);
  });
  it('the savings side first with a fee, then checking −$100: the checking leg (−$95) and its fee (−$5) are one candidate of exactly −$100; linking posts both', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    b.commit(b.review(s, [['2026-09-11', 'WIRE IN', 9500, 109500]]), { 'WIRE IN': t.in.id });
    const fee = b.data.transactions.find((x) => x.transferFeeOf)!;
    expect([fee.status, b.sts()]).toEqual(['pending', 90000]); // pending debits count: 1,000 − 95 − 5
    const rv = b.review(c, [['2026-09-12', 'WIRE OUT', -10000, 90000]]);
    expect(b.live(rv, 'WIRE OUT').map((m) => [m.txId, m.amountCents, m.feeCents, m.differenceCents])).toEqual([[t.out.id, -10000, -500, 0]]);
    b.commit(rv, { 'WIRE OUT': t.out.id });
    expect([b.tx(fee.id).status, b.tx(t.out.id).status, b.posted(c), b.posted(s)]).toEqual(['confirmed', 'confirmed', 90000, 109500]);
  });
  it('the sending bank took $105 for a $100 transfer: a $5 fee in checking, the transfer stays $100; savings +$100 links exactly', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    b.commit(b.review(c, [['2026-09-10', 'WIRE OUT', -10500, 89500]]), { 'WIRE OUT': t.out.id });
    b.commit(b.review(s, [['2026-09-11', 'WIRE IN', 10000, 110000]]), { 'WIRE IN': t.in.id });
    expect([b.tx(t.out.id).amountCents, b.posted(c), b.posted(s), b.data.transactions.length]).toEqual([-10000, 89500, 110000, 3]);
  });
  it('more arrived than was sent ($105 for $100): can\'t be a fee, so the leg can\'t be linked; the row stays unresolved unless the user says it\'s different', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    const rv = b.review(s, [['2026-09-11', 'DEPOSIT', 10500, 110500]]);
    expect(b.live(rv, 'DEPOSIT').map((m) => [m.txId, m.differenceCents, m.feeOption])).toEqual([[t.in.id, 500, null]]);
    expect(errorOf(() => b.commit(rv, { DEPOSIT: t.in.id }))).toMatchObject({ field: 'match', message: expect.stringMatching(/can't be a transfer fee/) });
  });
  it('audit B7: a POSTED transfer leg of $100 and a savings row of $95: listed with the difference (fee check); with the fee confirmed, no second transfer', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-08', 10000, 'confirmed');
    const rv = b.review(s, [['2026-09-10', 'INCOMING XFER', 9500, 109500]]);
    expect(b.live(rv, 'INCOMING XFER').map((m) => [m.txId, m.basis, m.differenceCents])).toEqual([[t.in.id, 'transfer', -500]]);
    b.commit(rv, { 'INCOMING XFER': t.in.id });
    expect([b.transfers(), b.posted(c), b.posted(s), b.rec(c) + b.rec(s)]).toEqual([1, 90000, 109500, 199500]);
  });
  it('undo of a fee import is refused when the transfer was edited after it (its amount can\'t be restored safely)', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    const r = b.commit(b.review(s, [['2026-09-11', 'WIRE IN', 9500, 109500]]), { 'WIRE IN': t.in.id });
    b.data = applyOps(b.data, updateTransaction(b.ctx(), t.out.id, { kind: 'transfer', accountId: c, toAccountId: s, date: '2026-09-10', amountCents: 9000, merchant: 'Transfer', categoryId: null, status: 'pending', toStatus: 'confirmed' }).ops);
    expect(errorOf(() => b.undo(r.batch.id))).toMatchObject({ field: 'undo', message: expect.stringMatching(/was edited after this import confirmed its fee/) });
  });
  it('deleting a transfer deletes its confirmed fee with it', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    b.commit(b.review(s, [['2026-09-11', 'WIRE IN', 9500, 109500]]), { 'WIRE IN': t.in.id });
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), t.out.id));
    expect(b.data.transactions).toEqual([]);
  });
});

describe('D8: what an import did is reported exactly', () => {
  it('a linked pending leg and a new row: "1 new transaction imported · 1 existing transaction linked (1 marked posted) · 1 transfer awaiting the other bank"', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-10', 10000);
    const r = b.commit(b.review(c, [['2026-09-09', 'COFFEE', -500, 99500], ['2026-09-11', 'TO SAVINGS', -10000, 89500]]), { COFFEE: 'none', 'TO SAVINGS': t.out.id });
    expect(r.batch.counts).toMatchObject({ imported: 1, matched: 1, markedPosted: 1, awaiting: 1 });
    expect(describeImportResult(r.batch)).toBe('1 new transaction imported · 1 existing transaction linked (1 marked posted) · 1 transfer awaiting the other bank');
  });
  it('linking only: "0 new transactions imported · 1 existing transaction linked" (never "Imported 1 transaction")', () => {
    const { b, c, s } = two();
    const t = b.transfer(c, s, '2026-09-08', 10000, 'confirmed');
    const r = b.commit(b.review(s, [['2026-09-10', 'DEPOSIT', 10000, 110000]]), { DEPOSIT: t.in.id });
    expect(describeImportResult(r.batch)).toBe('0 new transactions imported · 1 existing transaction linked');
  });
});

describe('D9: stale and concurrent commits never overwrite reconciliation state', () => {
  it('a candidate edited after the review opened: "it\'s this one" with the old snapshot is refused; so is "different"', () => {
    const { b, c } = two();
    const p = b.add({ kind: 'refund', accountId: c, date: '2026-09-08', amountCents: 30000, merchant: 'Refund', categoryId: null, status: 'pending' })[0]!;
    const rv = b.review(c, [['2026-09-09', 'AMAZON REFUND', 30000, 130000]]);
    const link = b.decisions(rv, { 'AMAZON REFUND': p.id });
    const none = b.decisions(rv, { 'AMAZON REFUND': 'none' });
    b.data = applyOps(b.data, updateTransaction(b.ctx(), p.id, { kind: 'refund', accountId: c, date: '2026-09-08', amountCents: 50000, merchant: 'Refund', categoryId: null, status: 'pending' }).ops);
    expect(errorOf(() => b.commit(rv, {}, { decisions: link }))).toMatchObject({ field: 'stale' });
    expect(errorOf(() => b.commit(rv, {}, { decisions: none }))).toMatchObject({ field: 'stale' });
    expect([b.tx(p.id).status, b.data.transactions.length]).toEqual(['pending', 1]);
  });
  it('"different" committed after another import linked the candidate is refused (the row is the linked one: no duplicate)', () => {
    const { b, c } = two();
    const p = b.add({ kind: 'refund', accountId: c, date: '2026-09-08', amountCents: 30000, merchant: 'Refund', categoryId: null, status: 'pending' })[0]!;
    const rvA = b.review(c, [['2026-09-09', 'REFUND A', 30000, 130000]]);
    const rvB = b.review(c, [['2026-09-09', 'REFUND B', 30000, 130000]]);
    const noneB = b.decisions(rvB, { 'REFUND B': 'none' });
    b.commit(rvA, { 'REFUND A': p.id });
    expect(errorOf(() => b.commit(rvB, {}, { decisions: noneB }))).toMatchObject({ field: 'stale' });
    expect([b.data.transactions.length, b.posted(c)]).toEqual([1, 130000]);
  });
});

describe('two tabs on one storage (Phase 4A.5.14 commit-time concurrency)', () => {
  it('a commit decided on data another tab changed is refused before anything is written; the latest data is loaded', async () => {
    const { b, c } = two();
    const p = b.add({ kind: 'refund', accountId: c, date: '2026-09-08', amountCents: 30000, merchant: 'Refund', categoryId: null, status: 'pending' })[0]!;
    const adapter = new MemoryAdapter();
    const provider = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
    const { store: setup } = await WorkspaceStore.create(adapter, provider, 'correct horse battery', { withRecoveryKey: false, now: 1 });
    await setup.apply([...b.data.accounts.map((a) => ({ t: 'put' as const, table: 'accounts' as const, value: a })), ...b.data.transactions.map((t) => ({ t: 'put' as const, table: 'transactions' as const, value: t }))]);
    const tabA = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const tabB = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const review = (store: WorkspaceStore, raw: string) => { const x = new Book(); x.data = store.data; x.today = b.today; return { x, rv: x.review(c, [['2026-09-09', raw, 30000, 130000]]) }; };
    const a = review(tabA, 'REFUND A');
    const bb = review(tabB, 'REFUND B');
    const opsA = commitImport(tabA.ctx(1, b.today), { accountId: c, fileName: 'a.csv', fileHash: 'a', parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: a.rv.settings, decisions: a.x.decisions(a.rv, { 'REFUND A': p.id }), totalRows: 1, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: null, applyAdjustment: false }).ops;
    await tabA.apply(opsA);
    // tab B still shows the refund as pending and unlinked; its own commit passes ITS data checks...
    const opsB = commitImport(tabB.ctx(2, b.today), { accountId: c, fileName: 'b.csv', fileHash: 'b', parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: bb.rv.settings, decisions: bb.x.decisions(bb.rv, { 'REFUND B': p.id }), totalRows: 1, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: null, applyAdjustment: false }).ops;
    // ...but storage refuses it: another tab wrote first
    await expect(tabB.apply(opsB)).rejects.toBeInstanceOf(StaleDataError);
    const stored = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const linked = stored.data.transactions.find((t) => t.id === p.id)!;
    expect([linked.statementMatch?.rawDescription, stored.data.importBatches.length, stored.data.transactions.length]).toEqual(['REFUND A', 1, 1]);
    // tab B now has the latest data: a fresh review sees the row as already linked
    expect(tabB.data.transactions.find((t) => t.id === p.id)!.statementMatch?.rawDescription).toBe('REFUND A');
    // two tabs importing the same plain row: the second is refused the same way (no duplicate)
    const plain = (store: WorkspaceStore) => { const x = new Book(); x.data = store.data; x.today = b.today; const rv = x.review(c, [['2026-09-10', 'COFFEE', -500, 129500]]); return commitImport(store.ctx(3, b.today), { accountId: c, fileName: 'c.csv', fileHash: 'c', parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: rv.settings, decisions: x.decisions(rv, {}), totalRows: 1, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: null, applyAdjustment: false }).ops; };
    const tabC = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const opsC = plain(tabC);
    await tabB.apply(plain(tabB));
    await expect(tabC.apply(opsC)).rejects.toBeInstanceOf(StaleDataError);
    const final = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    expect(final.data.transactions.filter((t) => t.amountCents === -500).length).toBe(1);
  });
});
