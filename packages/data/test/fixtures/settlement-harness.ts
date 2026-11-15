import { accountBalance, computeSafeToSpend, postedBalance } from '@clarity/engine';
import { buildPreview, csvParser, findMatchCandidates, guessMapping, reconcilePreview, suggestSignConvention, type ImportCandidate } from '@clarity/import';
import type { ID, Transaction, WorkspaceData } from '@clarity/shared';
import {
  addTransaction, applyOps, CommandError, commitImport, createAccount, defaultSettings, emptyWorkspace, engineInput, isLinkChoice, markTransactionPosted, matchDecision,
  postedByMatchOf, undoImportBatch, type Ctx, type TxInput,
} from '../../src';

/**
 * Phase 4A.5.14 test harness: a workspace driven through the same commands the apps use. A review is built from a
 * statement file; `commit` sends the decisions the way both review screens do (matchDecision over the candidates the
 * user sees NOW, i.e. recomputed from the current data). Expected values are written by hand in the tests.
 */
export const NOW = Date.UTC(2026, 8, 12, 12);
export const H = 'Date,Description,Amount,Balance\n';
let seq = 0;

/** A statement line: date (YYYY-MM-DD), description, signed amount in cents, running balance in cents. */
export type Line = [string, string, number, number];
export const csvOf = (lines: Line[]) => H + lines.map(([d, desc, a, b]) => `${d},${desc},${(a / 100).toFixed(2)},${(b / 100).toFixed(2)}`).join('\n') + '\n';

/** A row's decision: a transaction id ("it's this one"), 'none' ("different transaction"), 'skip' (leave it out), or 'auto' (import as suggested). */
export type Decide = Record<string, string>;

export class Book {
  data: WorkspaceData = emptyWorkspace(defaultSettings(NOW));
  today = '2026-09-01';
  ctx = (): Ctx => ({ data: this.data, now: NOW + seq, today: this.today, newId: (p) => `${p}_${++seq}` });
  at(d: string) { this.today = d; return this; }
  acct(name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', cents: number) { const r = createAccount(this.ctx(), { name, type, currentBalanceCents: cents }); this.data = applyOps(this.data, r.ops); return r.account.id; }
  add(i: TxInput) { const r = addTransaction(this.ctx(), i); this.data = applyOps(this.data, r.ops); return r.txs; }
  transfer(from: ID, to: ID, date: string, cents: number, status: 'pending' | 'confirmed' = 'pending', toStatus = status) {
    const legs = this.add({ kind: 'transfer', accountId: from, toAccountId: to, date, amountCents: cents, merchant: 'Transfer', categoryId: null, status, toStatus });
    return { out: legs.find((l) => l.amountCents < 0)!, in: legs.find((l) => l.amountCents > 0)! };
  }
  post(id: ID) { this.data = applyOps(this.data, markTransactionPosted(this.ctx(), id)); }
  tx(id: ID) { return this.data.transactions.find((t) => t.id === id)!; }
  a(id: ID) { return this.data.accounts.find((x) => x.id === id)!; }
  rec(id: ID) { return accountBalance(this.a(id), this.data.transactions, this.today); }
  posted(id: ID, asOf = this.today) { return postedBalance(this.a(id), this.data.transactions, asOf); }
  sts() { return computeSafeToSpend(engineInput(this.data, this.today)).cents; }
  transfers() { return new Set(this.data.transactions.filter((t) => t.transferGroupId).map((t) => t.transferGroupId)).size; }

  review(accountId: ID, lines: Line[], convention?: 'as_is' | 'invert') {
    const csv = csvOf(lines);
    const table = csvParser.parse(csv);
    const g = guessMapping(table);
    const base = { hasHeader: g.hasHeader, columns: g.columns!, dateFormat: g.dateFormats[0]!, decimalSeparator: g.decimalSeparator };
    const settings = { ...base, signConvention: convention ?? suggestSignConvention(table, base, this.a(accountId)).convention };
    const preview = buildPreview(table, settings, { account: this.a(accountId), accounts: this.data.accounts, transactions: this.data.transactions, recurring: [], exceptions: [], importBatches: this.data.importBatches, fileHash: csv, today: this.today });
    return { accountId, preview, settings };
  }
  /** Live candidates of a row, as the review screens show them. */
  live(rv: ReturnType<Book['review']>, raw: string) {
    const c = row(rv, raw);
    return findMatchCandidates(c, this.a(rv.accountId), this.data.transactions, { alsoIds: c.matchCandidates.map((m) => m.txId), accounts: this.data.accounts });
  }
  /** The decisions the screens would send; rows not in `decide` follow the review's default (include or not). */
  decisions(rv: ReturnType<Book['review']>, decide: Decide, other: Record<string, ID> = {}) {
    return rv.preview.candidates
      .filter((c) => (decide[c.rawDescription] ? decide[c.rawDescription] !== 'skip' : c.include))
      .map((c) => {
        const v = decide[c.rawDescription];
        const live = findMatchCandidates(c, this.a(rv.accountId), this.data.transactions, { alsoIds: c.matchCandidates.map((m) => m.txId), accounts: this.data.accounts });
        const match = v && v !== 'auto' ? matchDecision(v, live) : undefined;
        const o = other[c.rawDescription];
        return { candidate: c, kind: o ? ('transfer' as const) : (c.kind as 'expense' | 'income' | 'refund' | 'transfer'), categoryId: null, merchant: c.merchant, linkOccurrence: false, ...(o ? { otherAccountId: o } : {}), ...(match ? { match } : {}) };
      });
  }
  commit(rv: ReturnType<Book['review']>, decide: Decide = {}, opts: { other?: Record<string, ID>; applyAdjustment?: boolean; decisions?: ReturnType<Book['decisions']> } = {}) {
    const decisions = opts.decisions ?? this.decisions(rv, decide, opts.other);
    const links = decisions.filter((d) => d.match && 'txId' in d.match && isLinkChoice((d.match as { txId: ID }).txId, findMatchCandidates(d.candidate, this.a(rv.accountId), this.data.transactions, { alsoIds: d.candidate.matchCandidates.map((m) => m.txId), accounts: this.data.accounts }))).map((d) => postedByMatchOf((d.match as { txId: ID }).txId, findMatchCandidates(d.candidate, this.a(rv.accountId), this.data.transactions, { alsoIds: d.candidate.matchCandidates.map((m) => m.txId), accounts: this.data.accounts }), d.candidate.amountCents));
    const recon = reconcilePreview(rv.preview, decisions.filter((d) => !(d.match && 'txId' in d.match && isLinkChoice((d.match as { txId: ID }).txId, findMatchCandidates(d.candidate, this.a(rv.accountId), this.data.transactions, { alsoIds: d.candidate.matchCandidates.map((m) => m.txId), accounts: this.data.accounts })))).map((d) => d.candidate), { account: this.a(rv.accountId), transactions: this.data.transactions, postedByMatch: links });
    const res = commitImport(this.ctx(), {
      accountId: rv.accountId, fileName: 'statement.csv', fileHash: String(++seq), parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: rv.settings, decisions,
      totalRows: rv.preview.candidates.length, excludedCount: rv.preview.candidates.length - decisions.length, duplicateCount: 0, errorCount: 0, reconciliation: recon, applyAdjustment: opts.applyAdjustment ?? false,
      knownDuplicateIds: rv.preview.candidates.flatMap((c) => (c.duplicate?.level === 'exact' ? [c.duplicate.txId] : [])),
    });
    this.data = applyOps(this.data, res.ops);
    return { ...res, recon };
  }
  undo(batchId: ID) { this.data = applyOps(this.data, undoImportBatch(this.ctx(), batchId)); }
}

export const row = (rv: { preview: { candidates: ImportCandidate[] } }, raw: string) => rv.preview.candidates.find((c) => c.rawDescription === raw)!;
export const errorOf = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof CommandError ? e.issues[0]! : (e as Error); } };
export const statuses = (b: Book, ...ids: ID[]) => ids.map((id) => b.tx(id).status);
export type { Transaction };
