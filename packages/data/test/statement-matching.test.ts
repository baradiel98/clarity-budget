import { describe, expect, it } from 'vitest';
import { accountBalance, computeSafeToSpend } from '@clarity/engine';
import { buildPreview, csvParser, findMatchCandidates, guessMapping, reconcilePreview, snapshotOf, suggestSignConvention, type CandidateSnapshot, type ImportCandidate } from '@clarity/import';
import type { WorkspaceData } from '@clarity/shared';
import {
  addTransaction, adjustBalance, applyOps, CommandError, commitImport, createAccount, defaultSettings, deleteTransaction, emptyWorkspace, engineInput,
  archiveAccount, describeImportUndo, markTransactionPosted, undoImportBatch, updateTransaction, type Ctx, type TxInput,
} from '../src';

/**
 * (Harness shared with import-reconciliation.test.ts.) Phase 4A.5.9: statement import uses the same posted-balance convention as onboarding, a new account and Update
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
  /**
   * `decide`: the user's explicit decision for rows that could be an existing transaction (Phase 4A.5.12):
   * a transaction id = "it's this one"; true = the single same-amount candidate (the test fails if there isn't
   * exactly one); false = "a different transaction" (every candidate shown was reviewed).
   */
  review(accountId: string, csv: string, pick?: (c: ImportCandidate) => boolean, decide: Record<string, boolean | string> = {}) {
    const table = csvParser.parse(csv);
    const g = guessMapping(table);
    const base = { hasHeader: g.hasHeader, columns: g.columns!, dateFormat: g.dateFormats[0]!, decimalSeparator: g.decimalSeparator };
    const settings = { ...base, signConvention: suggestSignConvention(table, base, this.a(accountId)).convention };
    const preview = buildPreview(table, settings, { account: this.a(accountId), accounts: this.data.accounts, transactions: this.data.transactions, recurring: [], exceptions: [], importBatches: this.data.importBatches, fileHash: csv, today: this.today });
    const live = (c: ImportCandidate) => findMatchCandidates(c, this.a(accountId), this.data.transactions, { alsoIds: c.matchCandidates.map((m) => m.txId) });
    const decided = (c: ImportCandidate) => decide[c.rawDescription] !== undefined && (c.matchCandidates.length > 0 || live(c).length > 0);
    // like the review screens: the decision carries what the user sees now (the live candidate's snapshot)
    const matchOf = (c: ImportCandidate): { txId: string; snapshot?: CandidateSnapshot; fee?: { feeCents: number } } | { none: true; seen: CandidateSnapshot[] } => {
      const v = decide[c.rawDescription]!;
      const snap = (id: string) => { const m = live(c).find((x) => x.txId === id); return m ? { snapshot: snapshotOf(m), ...(m.feeOption ? { fee: { feeCents: m.feeOption.feeCents } } : {}) } : {}; };
      if (typeof v === 'string') return { txId: v, ...snap(v) };
      if (v === false) return { none: true, seen: live(c).map(snapshotOf) };
      const exact = live(c).filter((m) => m.differenceCents === 0);
      if (exact.length !== 1) throw new Error(`test setup: ${c.rawDescription} has ${exact.length} same-amount candidates`);
      return { txId: exact[0]!.txId, ...snap(exact[0]!.txId) };
    };
    const chosen = () => preview.candidates.filter((c) => decided(c) || (pick ?? ((x: ImportCandidate) => x.include))(c));
    // rows confirmed as an existing transaction aren't added; that transaction counts as posted
    const sameIds = () => chosen().filter((c) => decided(c) && 'txId' in matchOf(c)).map((c) => { const m = matchOf(c) as { txId: string; fee?: unknown }; return m.fee ? { txId: m.txId, effectCents: c.amountCents } : m.txId; });
    const recon = () => reconcilePreview(preview, chosen().filter((c) => !(decided(c) && 'txId' in matchOf(c))), { account: this.a(accountId), transactions: this.data.transactions, postedByMatch: sameIds() })!;
    return { preview, settings, chosen, recon, decide, decided, matchOf };
  }
  commit(accountId: string, r: ReturnType<W['review']>, opts: { applyAdjustment?: boolean; unrelated?: boolean; other?: Record<string, string> } = {}) {
    const res = commitImport(this.ctx(), {
      accountId, fileName: 'statement.csv', fileHash: String(++seq), parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: r.settings,
      decisions: r.chosen().map((c) => ({ candidate: c, kind: opts.other?.[c.rawDescription] ? 'transfer' : c.kind, categoryId: null, merchant: c.merchant, linkOccurrence: false, ...(opts.other?.[c.rawDescription] ? { otherAccountId: opts.other[c.rawDescription]! } : {}), ...(r.decided(c) ? { match: r.matchOf(c) } : {}) })),
      totalRows: 0, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: r.recon(), applyAdjustment: opts.applyAdjustment ?? true, adjustmentUnrelatedToPending: opts.unrelated,
      knownDuplicateIds: r.preview.candidates.flatMap((c) => (c.duplicate?.level === 'exact' ? [c.duplicate.txId] : [])),
    });
    this.data = applyOps(this.data, res.ops);
    return res;
  }
}
const setup = () => { const w = new W(); const c = w.acct('Checking', 'checking', 100000); w.at('2026-09-12'); return { w, c }; };
const pendingDeposit = (w: W, c: string, cents: number, date = '2026-09-05', merchant = 'Store return') => w.add({ kind: 'income', accountId: c, date, amountCents: cents, merchant, categoryId: null, status: 'pending' })[0]!;
const pendingPurchase = (w: W, c: string, cents: number, date = '2026-09-05', merchant = 'Groceries run') => w.add({ kind: 'expense', accountId: c, date, amountCents: cents, merchant, categoryId: null, status: 'pending' })[0]!;
const errorOf = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof CommandError ? e.issues[0]! : e; } };


/**
 * Phase 4A.5.12: the six Phase 4A.5.11 audit findings (F1–F6) and the matching rules. Truth = the bank; values by hand.
 * Checking opened Sep 1 at $1,000.00; today Sep 12, 2026.
 */
const cnt = (w: W, cents: number) => w.data.transactions.filter((t) => t.amountCents === cents).length;
const cands = (r: ReturnType<W['review']>, raw: string) => r.preview.candidates.find((x) => x.rawDescription === raw)!.matchCandidates;
const transferSetup = (opts: { legStatus?: 'pending' | 'confirmed'; date?: string } = {}) => {
  const { w, c } = setup();
  w.at('2026-09-01');
  const s = w.acct('Savings', 'savings', 50000);
  w.at('2026-09-12');
  const legs = w.add({ kind: 'transfer', accountId: c, toAccountId: s, date: opts.date ?? '2026-09-05', amountCents: 10000, merchant: 'To savings', categoryId: null, ...(opts.legStatus === 'pending' ? { status: 'pending' as const } : {}) });
  return { w, c, s, legs };
};

describe('F1/F2: every same-amount candidate is listed; the user chooses; file order decides nothing', () => {
  it('F1: two pending $300 (A Sep 5, B Sep 8), one row Sep 9 → both listed, B (closest) first; nothing chosen automatically', () => {
    const { w, c } = setup();
    const a = pendingDeposit(w, c, 30000, '2026-09-05', 'Refund A');
    const b = pendingDeposit(w, c, 30000, '2026-09-08', 'Refund B');
    const r = w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1300.00\n');
    const row = r.preview.candidates[0]!;
    expect([row.include, row.duplicate, row.matchCandidates.map((m) => [m.txId, m.daysApart, m.differenceCents, m.status])]).toEqual([false, null, [[b.id, 1, 0, 'pending'], [a.id, 4, 0, 'pending']]]);
    expect(errorOf(() => w.commit(c, w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1300.00\n', () => true)))).toMatchObject({ field: 'match' });
  });
  it('F1 (audit C1x): the row is really B; the user picks B → B posted, A still pending: $1,300 (was $1,600)', () => {
    const { w, c } = setup();
    const a = pendingDeposit(w, c, 30000, '2026-09-05', 'Refund A');
    const b = pendingDeposit(w, c, 30000, '2026-09-08', 'Refund B');
    w.commit(c, w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1300.00\n', undefined, { 'AMAZON REFUND': b.id }));
    expect([w.data.transactions.find((t) => t.id === a.id)!.status, w.data.transactions.find((t) => t.id === b.id)!.status, cnt(w, 30000), w.sts()]).toEqual(['pending', 'confirmed', 2, 130000]);
  });
  it('the user may pick the NON-closest candidate (A) when that is the truth; B stays pending', () => {
    const { w, c } = setup();
    const a = pendingDeposit(w, c, 30000, '2026-09-05', 'Refund A');
    const b = pendingDeposit(w, c, 30000, '2026-09-08', 'Refund B');
    w.commit(c, w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1300.00\n', undefined, { 'AMAZON REFUND': a.id }));
    expect([w.data.transactions.find((t) => t.id === a.id)!.statementMatch?.rawDescription, w.data.transactions.find((t) => t.id === b.id)!.status, w.sts()]).toEqual(['AMAZON REFUND', 'pending', 130000]);
  });
  it('"Different" must cover every candidate: seen only A while B is also a candidate → refused; seen both → imported, both kept', () => {
    const { w, c } = setup();
    const a = pendingDeposit(w, c, 30000, '2026-09-05', 'Refund A');
    const b = pendingDeposit(w, c, 30000, '2026-09-08', 'Refund B');
    const r = w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1300.00\n');
    const base = { accountId: c, fileName: 'f', fileHash: 'x', parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: r.settings, totalRows: 0, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: null, applyAdjustment: false };
    const row = r.preview.candidates[0]!;
    expect(errorOf(() => commitImport(w.ctx(), { ...base, decisions: [{ candidate: row, kind: 'income', categoryId: null, merchant: row.merchant, linkOccurrence: false, match: { none: true, seen: [a.id] } }] }))).toMatchObject({ field: 'match', message: expect.stringMatching(/“Refund B” \(Sep 8, \+\$300\.00\) could also be this row and wasn't reviewed/) });
    w.data = applyOps(w.data, commitImport(w.ctx(), { ...base, decisions: [{ candidate: row, kind: 'income', categoryId: null, merchant: row.merchant, linkOccurrence: false, match: { none: true, seen: [a.id, b.id] } }] }).ops);
    const imported = w.data.transactions.find((t) => t.provenance.source === 'import')!;
    expect([imported.provenance.separateFrom, cnt(w, 30000), w.sts()]).toEqual([[b.id, a.id], 3, 130000]); // 1,000 + 300 imported; both pending excluded
  });
  it('F2 (audit C7o): oldest-first file, unrelated Zelle $300 Sep 6 and the refund clearing Sep 9 → both rows list the refund; truthful answers → $1,600 (was $1,900)', () => {
    for (const order of ['oldest', 'newest'] as const) {
      const { w, c } = setup();
      const d = pendingDeposit(w, c, 30000, '2026-09-05', 'Store return');
      const lines = ['09/06/2026,ZELLE FROM SAM,300.00,1300.00', '09/09/2026,AMAZON REFUND,300.00,1600.00'];
      const csv = H + (order === 'oldest' ? lines : [...lines].reverse()).join('\n') + '\n';
      const r = w.review(c, csv);
      expect([cands(r, 'ZELLE FROM SAM').map((m) => m.txId), cands(r, 'AMAZON REFUND').map((m) => m.txId)]).toEqual([[d.id], [d.id]]);
      w.commit(c, w.review(c, csv, undefined, { 'ZELLE FROM SAM': false, 'AMAZON REFUND': d.id }));
      expect([w.data.transactions.find((t) => t.id === d.id)!.status, cnt(w, 30000), w.sts()]).toEqual(['confirmed', 2, 160000]);
    }
  });
  it('one pending transaction can be chosen by only one row', () => {
    const { w, c } = setup();
    const d = pendingDeposit(w, c, 30000);
    const r = w.review(c, H + '09/09/2026,REFUND X,300.00,1600.00\n09/08/2026,REFUND Y,300.00,1300.00\n', undefined, { 'REFUND X': d.id, 'REFUND Y': d.id });
    expect(errorOf(() => w.commit(c, r))).toMatchObject({ field: 'match', message: expect.stringMatching(/already chosen for another row/) });
  });
  it('not candidates: another account, another currency (its own account), the opposite direction, dated before the account was opened, more than 3 days after the row', () => {
    const { w, c } = setup();
    w.at('2026-09-01');
    const s = w.acct('Savings', 'savings', 0);
    w.at('2026-09-12');
    pendingDeposit(w, s, 30000);
    pendingPurchase(w, c, 30000);
    pendingDeposit(w, c, 30000, '2026-08-25', 'Too early'); // before the account was opened (Sep 1): not in its balance (an older one inside the account period is a stale candidate: see Phase 4A.5.14 D4)
    pendingDeposit(w, c, 30000, '2026-09-20', 'Too late'); // row is 11 days before (> 3)
    expect(cands(w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1300.00\n'), 'AMAZON REFUND')).toEqual([]);
  });
});

describe('F3/F6: a pending item that cleared for a different amount is listed with the difference; never merged or changed automatically', () => {
  it('F3 (audit C6d): pending $300 deposit, statement $290 → listed (difference −$10); "it\'s this one" posts the $300 once and the −$10 shows in the balance check; recorded as an adjustment → $1,290 (was $1,590)', () => {
    const { w, c } = setup();
    const d = pendingDeposit(w, c, 30000);
    const csv = H + '09/08/2026,AMAZON REFUND,290.00,1290.00\n';
    expect(cands(w.review(c, csv), 'AMAZON REFUND').map((m) => [m.txId, m.differenceCents])).toEqual([[d.id, -1000]]);
    const r = w.review(c, csv, undefined, { 'AMAZON REFUND': d.id });
    expect(r.recon().differenceCents).toBe(-1000); // 1,290 − (1,000 + 300)
    w.commit(c, r, { applyAdjustment: true });
    const t = w.data.transactions.find((x) => x.id === d.id)!;
    expect([t.amountCents, t.status, cnt(w, 29000), w.rec(c), w.sts()]).toEqual([30000, 'confirmed', 0, 129000, 129000]); // amount never changed automatically
    w.post(d.id);
    expect(w.sts()).toBe(129000);
  });
  it('F3: the user says they are separate events (a $290 deposit and a $300 one still to come): both kept; $1,290 now, $1,590 once the $300 posts', () => {
    const { w, c } = setup();
    const d = pendingDeposit(w, c, 30000);
    w.commit(c, w.review(c, H + '09/08/2026,PAYROLL,290.00,1290.00\n', undefined, { PAYROLL: false }));
    expect([cnt(w, 29000), w.sts()]).toEqual([1, 129000]);
    w.post(d.id);
    expect(w.sts()).toBe(159000);
  });
  it('F6: pending $50 dinner clears as $60 with tip → listed (difference −$10); "it\'s this one" + adjustment → $940 (was $890, counted twice)', () => {
    const { w, c } = setup();
    const p = pendingPurchase(w, c, 5000, '2026-09-05', 'Dinner');
    const r = w.review(c, H + '09/07/2026,BISTRO 22,-60.00,940.00\n', undefined, { 'BISTRO 22': p.id });
    expect([cands(r, 'BISTRO 22').map((m) => m.differenceCents), r.recon().differenceCents]).toEqual([[-1000], -1000]);
    w.commit(c, r, { applyAdjustment: true });
    expect([cnt(w, -5000), cnt(w, -6000), w.rec(c), w.sts()]).toEqual([1, 0, 94000, 94000]);
  });
  it('a refund cleared for less (partial refund $80 of $100) and a deposit with a $2 fee are listed the same way', () => {
    const { w, c } = setup();
    const ref = w.add({ kind: 'refund', accountId: c, date: '2026-09-05', amountCents: 10000, merchant: 'Return', categoryId: null, status: 'pending' })[0]!;
    const dep = pendingDeposit(w, c, 50000, '2026-09-06', 'Wire in');
    const r = w.review(c, H + '09/08/2026,REFUND 1,80.00,1080.00\n09/09/2026,WIRE 99,498.00,1578.00\n');
    expect([cands(r, 'REFUND 1').map((m) => [m.txId, m.differenceCents]), cands(r, 'WIRE 99').map((m) => [m.txId, m.differenceCents])]).toEqual([[[ref.id, -2000], [dep.id, -42000]], [[dep.id, -200], [ref.id, 39800]]]);
  });
  it('a coincidental similar amount (unrelated $55 lunch near a pending $50 dinner): listed, the user says different → both counted: $895', () => {
    const { w, c } = setup();
    pendingPurchase(w, c, 5000, '2026-09-05', 'Dinner');
    w.commit(c, w.review(c, H + '09/06/2026,TACO PLACE,-55.00,945.00\n', undefined, { 'TACO PLACE': false }));
    expect(w.sts()).toBe(89500); // 1,000 − 55 − 50 (the dinner is still pending, a debit: counted)
  });
});

describe('F4/F5: a statement row from the other account is linked to the existing transfer, never a second one', () => {
  it('F4 (audit D4): a posted transfer (Sep 5); the savings statement shows +$100 on Sep 8 → the savings leg is listed; linked → savings $600 (was $700, money created)', () => {
    const { w, c, s, legs } = transferSetup();
    const r = w.review(s, H + '09/08/2026,DEPOSIT 7781,100.00,600.00\n');
    const leg = legs.find((l) => l.accountId === s)!;
    expect(cands(r, 'DEPOSIT 7781').map((m) => [m.txId, m.basis, m.status, m.kind])).toEqual([[leg.id, 'transfer', 'confirmed', 'transfer']]);
    w.commit(s, w.review(s, H + '09/08/2026,DEPOSIT 7781,100.00,600.00\n', undefined, { 'DEPOSIT 7781': leg.id }));
    expect([w.rec(c), w.rec(s), w.rec(c) + w.rec(s), w.data.transactions.length]).toEqual([90000, 60000, 150000, 2]);
  });
  it('F5 (audit D2x): savings side linked first, then the checking row "ONLINE TRANSFER" → its leg is listed; linked → no second transfer: $900 / $600 (was $800 / $700)', () => {
    const { w, c, s, legs } = transferSetup({ legStatus: 'pending' });
    w.commit(s, w.review(s, H + '09/08/2026,DEPOSIT FROM CHK,100.00,600.00\n', undefined, { 'DEPOSIT FROM CHK': true }));
    const chkLeg = legs.find((l) => l.accountId === c)!;
    const r = w.review(c, H + '09/08/2026,ONLINE TRANSFER,-100.00,900.00\n');
    // Phase 4A.5.14: linking the savings leg never posts the checking leg: it is still pending until its own statement
    expect(cands(r, 'ONLINE TRANSFER').map((m) => [m.txId, m.status])).toEqual([[chkLeg.id, 'pending']]);
    w.commit(c, w.review(c, H + '09/08/2026,ONLINE TRANSFER,-100.00,900.00\n', undefined, { 'ONLINE TRANSFER': chkLeg.id }));
    expect([w.rec(c), w.rec(s), w.data.transactions.length, w.data.transactions.filter((t) => t.statementMatch).length]).toEqual([90000, 60000, 2, 2]);
  });
  it('the transfer window (Phase 4A.5.14: 10 days, like pending items): 8 days after a posted leg is listed normally; 9 days with a different amount is listed (fee check); the same amount older than 10 days is listed as stale', () => {
    const { w, s } = transferSetup({ date: '2026-09-03' });
    expect(cands(w.review(s, H + '09/11/2026,DEPOSIT,100.00,600.00\n'), 'DEPOSIT').map((m) => m.basis)).toEqual(['transfer']);
    expect(cands(w.review(s, H + '09/12/2026,DEPOSIT,95.00,595.00\n'), 'DEPOSIT').map((m) => [m.basis, m.differenceCents])).toEqual([['transfer', -500]]);
    w.at('2026-09-20');
    expect(cands(w.review(s, H + '09/15/2026,DEPOSIT,100.00,600.00\n'), 'DEPOSIT').map((m) => [m.basis, m.ageDays])).toEqual([['stale', 12]]);
    expect(cands(w.review(s, H + '09/15/2026,DEPOSIT,95.00,595.00\n'), 'DEPOSIT')).toEqual([]);
  });
  it('re-importing both statements adds nothing; undo of one side removes only its link; re-import offers it again', () => {
    const { w, c, s, legs } = transferSetup();
    const savLeg = legs.find((l) => l.accountId === s)!, chkLeg = legs.find((l) => l.accountId === c)!;
    const sCsv = H + '09/08/2026,DEPOSIT 7781,100.00,600.00\n', cCsv = H + '09/08/2026,WEB XFER 7781,-100.00,900.00\n';
    const resS = w.commit(s, w.review(s, sCsv, undefined, { 'DEPOSIT 7781': savLeg.id }));
    w.commit(c, w.review(c, cCsv, undefined, { 'WEB XFER 7781': chkLeg.id }));
    for (const [acct, csv] of [[s, sCsv], [c, cCsv]] as const) {
      const again = w.review(acct, csv);
      expect([again.preview.candidates[0]!.duplicate?.level, again.preview.candidates[0]!.matchCandidates, again.preview.candidates[0]!.include]).toEqual(['exact', [], false]);
      w.commit(acct, again);
    }
    expect([w.rec(c), w.rec(s), w.data.transactions.length]).toEqual([90000, 60000, 2]);
    w.data = applyOps(w.data, undoImportBatch(w.ctx(), resS.batch.id));
    const sl = w.data.transactions.find((t) => t.id === savLeg.id)!;
    expect([sl.status, sl.statementMatch, w.rec(s)]).toEqual(['confirmed', undefined, 60000]); // it was posted before the import
    expect(cands(w.review(s, sCsv), 'DEPOSIT 7781').map((m) => m.txId)).toEqual([savLeg.id]);
  });
  it('editing a linked transfer keeps each leg\'s link; deleting it removes both legs and nothing else', () => {
    const { w, c, s, legs } = transferSetup();
    w.commit(s, w.review(s, H + '09/08/2026,DEPOSIT 7781,100.00,600.00\n', undefined, { 'DEPOSIT 7781': legs.find((l) => l.accountId === s)!.id }));
    w.data = applyOps(w.data, updateTransaction(w.ctx(), legs[0]!.id, { kind: 'transfer', accountId: c, toAccountId: s, date: '2026-09-05', amountCents: 10000, merchant: 'Savings top-up', categoryId: null }).ops);
    expect(w.data.transactions.find((t) => t.accountId === s)!.statementMatch?.rawDescription).toBe('DEPOSIT 7781');
    const other = pendingDeposit(w, c, 2000, '2026-09-10', 'Other');
    w.data = applyOps(w.data, deleteTransaction(w.ctx(), legs[0]!.id));
    expect(w.data.transactions.map((t) => t.id)).toEqual([other.id]);
  });
  it('a transfer into an archived account: its statement row is linked the same way', () => {
    const { w, c, s, legs } = transferSetup();
    w.data = applyOps(w.data, archiveAccount(w.ctx(), s));
    w.commit(s, w.review(s, H + '09/08/2026,DEPOSIT 7781,100.00,600.00\n', undefined, { 'DEPOSIT 7781': legs.find((l) => l.accountId === s)!.id }));
    expect([w.rec(c), w.rec(s), w.data.transactions.length]).toEqual([90000, 60000, 2]);
  });
  it('different currencies: no transfer exists between them (refused, as before), so a row in the other account has no transfer candidate', () => {
    const { w, c } = setup();
    w.at('2026-09-01');
    const e = w.acct('Euro', 'checking', 0);
    w.data = applyOps(w.data, [{ t: 'put', table: 'accounts', value: { ...w.a(e), currency: 'EUR' } }]);
    w.at('2026-09-12');
    expect(errorOf(() => w.add({ kind: 'transfer', accountId: c, toAccountId: e, date: '2026-09-05', amountCents: 10000, merchant: 'x', categoryId: null }))).toMatchObject({ message: expect.stringMatching(/between currencies/) });
    expect(cands(w.review(e, H + '09/08/2026,DEPOSIT,100.00,100.00\n'), 'DEPOSIT')).toEqual([]);
  });
});

describe('one coherent workflow: stale reviews, other actions, repeated actions', () => {
  it('a candidate marked posted elsewhere after the review was built stays listed (now "posted"); choosing it links it, nothing added; $1,290', () => {
    const { w, c } = setup();
    const d = pendingDeposit(w, c, 30000);
    const r = w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1290.00\n09/06/2026,COFFEE,-10.00,990.00\n', undefined, { 'AMAZON REFUND': d.id });
    w.post(d.id); // e.g. through Update balance or the transaction list
    const live = findMatchCandidates(r.preview.candidates[0]!, w.a(c), w.data.transactions, { alsoIds: r.preview.candidates[0]!.matchCandidates.map((m) => m.txId) });
    expect(live.map((m) => [m.txId, m.status])).toEqual([[d.id, 'confirmed']]);
    w.commit(c, r);
    expect([cnt(w, 30000), w.rec(c), w.sts(), w.data.transactions.find((t) => t.id === d.id)!.statementMatch?.previousStatus]).toEqual([1, 129000, 129000, 'confirmed']);
  });
  it('a NEW pending item that appeared after the review was built: a "different" decision that didn\'t see it is refused (review again)', () => {
    const { w, c } = setup();
    const d = pendingDeposit(w, c, 30000);
    const r = w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1300.00\n', undefined, { 'AMAZON REFUND': false });
    const row = r.preview.candidates[0]!;
    const seen = r.matchOf(row);
    pendingDeposit(w, c, 30000, '2026-09-08', 'New one');
    expect(errorOf(() => commitImport(w.ctx(), { accountId: c, fileName: 'f', fileHash: 'x', parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: r.settings, totalRows: 0, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: null, applyAdjustment: false, decisions: [{ candidate: row, kind: 'income', categoryId: null, merchant: row.merchant, linkOccurrence: false, match: seen }] }))).toMatchObject({ message: expect.stringMatching(/“New one”.*wasn't reviewed; review it again/) });
    void d;
  });
  it('committing the same "it\'s this one" decision twice never links or adds twice', () => {
    const { w, c } = setup();
    const d = pendingDeposit(w, c, 30000);
    const r = w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1300.00\n', undefined, { 'AMAZON REFUND': d.id });
    w.commit(c, r);
    // Phase 4A.5.14: refused before anything else: the row is already in Clarity (linked by the first commit)
    expect(errorOf(() => w.commit(c, r))).toMatchObject({ field: 'stale', message: expect.stringMatching(/already in Clarity as “Store return”.*added or linked after this review was opened/) });
    expect([cnt(w, 30000), w.sts()]).toEqual([1, 130000]);
  });
  it('undo says exactly what it reverted', () => {
    const { w, c } = setup();
    const d = pendingDeposit(w, c, 30000);
    const res = w.commit(c, w.review(c, H + '09/09/2026,AMAZON REFUND,300.00,1290.00\n09/06/2026,COFFEE,-10.00,990.00\n', undefined, { 'AMAZON REFUND': d.id }));
    expect(describeImportUndo(w.data, res.batch.id)).toBe('Import undone. Removed 1 imported transaction; “Store return” in Checking is pending again and no longer linked to the statement.');
  });
});

describe('randomized: a truthful user, repeated and similar amounts, transfers; compared with the bank', () => {
  /**
   * Each run: pending deposits/purchases (amounts from a small set, so they collide), some clearing at the bank on a
   * later day, sometimes for a different amount (tip/fee); unrelated statement rows that may share amounts; sometimes a
   * posted transfer to savings that appears on the checking statement. The simulated user knows the truth: for every
   * row with candidates, they pick the transaction it really is (if listed) or "different"; they record the remaining
   * statement difference as an adjustment; then they mark posted whatever the bank cleared. The ledger is the bank:
   * opening + every cleared amount + unrelated rows; uncleared pending debits are still counted, credits are not.
   * Counted separately: correct, incorrect, and ambiguous (the row listed more than one candidate).
   */
  it('400 runs: no incorrect result', () => {
    const tally = { runs: 0, correct: 0, incorrect: 0, ambiguousRows: 0, differentAmountRows: 0, transferRows: 0 };
    for (let n = 0; n < 400; n++) {
      let st = (n * 2654435761 + 11) >>> 0;
      const r = () => { st = (st * 1664525 + 1013904223) >>> 0; return st / 2 ** 32; };
      const { w, c } = setup();
      w.at('2026-09-01');
      const s = w.acct('Savings', 'savings', 0);
      w.at('2026-09-12');
      const amounts = [10000, 20000, 30000];
      type Item = { id: string; cents: number; cleared: boolean; clearedCents: number; rowDay: number };
      const items: Item[] = [];
      for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
        const cents = (r() < 0.5 ? 1 : -1) * amounts[Math.floor(r() * 3)]!;
        const day = 2 + Math.floor(r() * 5);
        const t = w.add({ kind: cents > 0 ? 'income' : 'expense', accountId: c, date: `2026-09-0${day}`, amountCents: Math.abs(cents), merchant: `P${k}`, categoryId: null, status: 'pending' })[0]!;
        const tweak = r() < 0.25 ? Math.sign(cents) * (r() < 0.5 ? -500 : 500) : 0;
        items.push({ id: t.id, cents, cleared: r() < 0.65, clearedCents: cents + tweak, rowDay: Math.min(11, day + Math.floor(r() * 4)) });
      }
      const transfer = r() < 0.3 ? w.add({ kind: 'transfer', accountId: c, toAccountId: s, date: '2026-09-04', amountCents: 10000, merchant: 'To savings', categoryId: null }) : null;
      type Row = { day: number; cents: number; desc: string; source: string | null };
      const rows: Row[] = items.filter((i) => i.cleared).map((i, k) => ({ day: i.rowDay, cents: i.clearedCents, desc: `BANK ${k}`, source: i.id }));
      for (let k = 0; k < Math.floor(r() * 3); k++) rows.push({ day: 2 + Math.floor(r() * 9), cents: (r() < 0.5 ? 1 : -1) * amounts[Math.floor(r() * 3)]!, desc: `OTHER ${k}`, source: null });
      if (transfer) rows.push({ day: 7, cents: -10000, desc: 'XFER OUT', source: transfer.find((l) => l.accountId === c)!.id });
      if (!rows.length) continue;
      const ascending = r() < 0.5;
      rows.sort((a, b) => (ascending ? a.day - b.day : b.day - a.day));
      void ascending;
      // running balance in the file's chronological order, read the way the import reads it: oldest-first unless the
      // first row is later than the last (a file whose rows all share one date is read oldest-first)
      let bal = 100000;
      const chronological = rows[0]!.day <= rows[rows.length - 1]!.day ? rows : [...rows].reverse();
      const balOf = new Map(chronological.map((x) => [x.desc, (bal += x.cents)]));
      const csv = H + rows.map((x) => `09/${String(x.day).padStart(2, '0')}/2026,${x.desc},${(x.cents / 100).toFixed(2)},${(balOf.get(x.desc)! / 100).toFixed(2)}`).join('\n') + '\n';
      const first = w.review(c, csv);
      const decide: Record<string, string | false> = {};
      for (const cand of first.preview.candidates) {
        if (!cand.matchCandidates.length) continue;
        if (cand.matchCandidates.length > 1) tally.ambiguousRows++;
        if (cand.matchCandidates.some((m) => m.differenceCents !== 0)) tally.differentAmountRows++;
        if (cand.matchCandidates.some((m) => m.basis === 'transfer')) tally.transferRows++;
        const src = rows.find((x) => x.desc === cand.rawDescription)!.source;
        decide[cand.rawDescription] = src && cand.matchCandidates.some((m) => m.txId === src) ? src : false;
      }
      w.commit(c, w.review(c, csv, undefined, decide), { applyAdjustment: true, unrelated: true });
      for (const i of items) if (i.cleared && w.data.transactions.find((t) => t.id === i.id)?.status === 'pending') w.post(i.id);
      const transferIn = transfer ? -10000 : 0; // posted transfer to savings, counted once on checking
      const bank = 100000 + rows.filter((x) => x.source !== (transfer?.find((l) => l.accountId === c)?.id ?? '-')).reduce((a, x) => a + x.cents, 0) + transferIn;
      const expected = bank + items.filter((i) => !i.cleared && i.cents < 0).reduce((a, i) => a + i.cents, 0);
      tally.runs++;
      if (w.sts() === expected && (!transfer || w.rec(s) === 10000)) tally.correct++; else { tally.incorrect++; if (process.env.DBG && tally.incorrect <= 2) console.log('BAD', n, JSON.stringify({ expected, actual: w.sts(), sav: w.rec(s), items, rows, decide, txs: w.data.transactions.map((t) => [t.merchant, t.amountCents, t.status, t.kind, t.date, !!t.includedInBalance]) })); }
    }
    expect(tally.incorrect).toBe(0);
    expect(tally.correct).toBe(tally.runs);
    for (const k of ['ambiguousRows', 'differentAmountRows', 'transferRows'] as const) expect(tally[k], k).toBeGreaterThan(20);
    console.log('statement-matching randomized:', JSON.stringify(tally));
  });
});
