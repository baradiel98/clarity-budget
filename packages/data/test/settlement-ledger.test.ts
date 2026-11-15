import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { addDays } from '@clarity/shared';
import type { ID, Transaction } from '@clarity/shared';
import { applyOps, CommandError, importUndoProblem, markTransactionPosted, updateTransaction } from '../src';
import { Book, type Line } from './fixtures/settlement-harness';

/**
 * Phase 4A.5.14: randomized settlement against an independent model of the two banks.
 *
 * The banks (built here, never from Clarity's calculations): each transfer has an instruction date d; the sending bank
 * posts it d+0..2 days later, the receiving bank d+0..11 days later (deliberately asymmetric), sometimes $3 or $5 less
 * arrives (a transfer fee charged by the sending bank). Card purchases recorded pending clear 0–18 days later (stale
 * ones beyond the 10-day window), sometimes with a tip. Unrelated rows with repeated amounts appear on both statements.
 *
 * The user (truthful): records every transfer and purchase as pending on its date; sometimes marks a transfer leg
 * posted by hand on the day its bank posts it; imports cumulative statements (Sep 1 → that day) for each account on
 * random days, in random order (so statements are re-imported and overlap); for each row picks the transaction it
 * really is when Clarity lists it (confirming a fee when asked), says "different" for unrelated rows, and edits a
 * purchase to the bank's amount after linking it with a tip; sometimes undoes an import (and later imports again);
 * sometimes commits a review after something it relied on changed (as another tab would): that must be refused.
 *
 * Checked after EVERY action: Safe to Spend (= checking's money: everything recorded, minus credits still pending);
 * no second transfer, ever; legs cancel; fees only where the bank charged one and of that amount. Right after each
 * import: that account's posted balance as of the statement date equals the bank's. At the end: both accounts equal
 * their banks, and every leg is posted exactly when its own bank posted it (by a statement or by hand).
 */
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
interface Post { acct: 'C' | 'S'; date: string; cents: number; desc: string; ref: string | null }
interface Rec { ref: string; d: string; kind: 'transfer' | 'card'; from: 'C' | 'S'; to: 'C' | 'S'; cents: number; fee: number; posts: Post[]; manual: boolean }

const RUNS = 250;
it(`${RUNS} randomized asymmetric settlements equal the banks after every action`, () => {
  const tally = { runs: 0, correct: 0, steps: 0, imports: 0, rows: 0, ambiguous: 0, stale: 0, fees: 0, transferRows: 0, notListed: 0, undos: 0, staleCommitsRefused: 0, manualPosts: 0, edits: 0 };
  const mismatches: string[] = [];
  for (let seed = 1; seed <= RUNS; seed++) {
    const r = rng(seed * 7919);
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    const b = new Book();
    const id = { C: b.acct('Checking', 'checking', 500000), S: b.acct('Savings', 'savings', 500000) } as const;
    const recs: Rec[] = [];
    const nX = 1 + Math.floor(r() * 4);
    for (let k = 0; k < nX; k++) {
      const d = addDays('2026-09-02', Math.floor(r() * 14));
      const cents = pick([10000, 10000, 5000, 10050]);
      const from = r() < 0.5 ? 'C' : 'S';
      const to = from === 'C' ? 'S' : 'C';
      const fee = r() < 0.2 ? pick([300, 500]) : 0;
      recs.push({ ref: `x${k}`, d, kind: 'transfer', from, to, cents, fee, manual: fee === 0 && r() < 0.2, posts: [
        { acct: from, date: addDays(d, Math.floor(r() * 3)), cents: -cents, desc: `TRANSFER ${k} OUT`, ref: `x${k}` },
        { acct: to, date: addDays(d, pick([0, 1, 2, 3, 5, 8, 9, 10, 11])), cents: cents - fee, desc: `TRANSFER ${k} IN`, ref: `x${k}` }] });
    }
    const nP = Math.floor(r() * 4);
    for (let k = 0; k < nP; k++) {
      const d = addDays('2026-09-02', Math.floor(r() * 12));
      const cents = pick([4000, 5000, 10000]);
      const tip = pick([0, 0, 800]);
      recs.push({ ref: `p${k}`, d, kind: 'card', from: 'C', to: 'C', cents, fee: 0, manual: false, posts: [{ acct: 'C', date: addDays(d, pick([0, 1, 3, 6, 14, 18])), cents: -(cents + tip), desc: `CARD ${k}`, ref: `p${k}` }] });
    }
    const extra: Post[] = [];
    for (let k = 0; k < 2; k++) extra.push({ acct: pick(['C', 'S'] as const), date: addDays('2026-09-03', Math.floor(r() * 20)), cents: pick([10000, -10000, 5000, -5000, -500]), desc: `OTHER ${k}`, ref: null });
    const posts = [...recs.flatMap((x) => x.posts), ...extra];
    const bank = (a: 'C' | 'S', asOf: string) => 500000 + posts.filter((p) => p.acct === a && p.date <= asOf).reduce((s, p) => s + p.cents, 0);
    const days = () => [...new Set([pick(['2026-09-08', '2026-09-12', '2026-09-15']), pick(['2026-09-18', '2026-09-22']), '2026-09-30', ...(r() < 0.5 ? [pick(['2026-09-25', '2026-09-27'])] : [])])].sort();
    const schedule = { C: days(), S: days() };
    const txOf = new Map<string, Transaction[]>(); // ref → its transactions
    const leg = (ref: string, a: 'C' | 'S') => txOf.get(ref)?.find((t) => t.accountId === id[a]);
    const live = (t: Transaction | undefined) => (t ? b.data.transactions.find((x) => x.id === t.id) : undefined);
    const lastImport: Record<'C' | 'S', string | null> = { C: null, S: null };
    const batches: { id: ID; acct: 'C' | 'S'; day: string; prev: string | null }[] = [];
    let ok = true;
    const fail = (m: string) => { ok = false; mismatches.push(`seed ${seed}: ${m}`); };

    const check = (where: string) => {
      tally.steps++;
      // Safe to Spend = checking's money: everything recorded, minus credits still pending (savings never goes negative here)
      const cTx = b.data.transactions.filter((t) => t.accountId === id.C);
      const expected = 500000 + cTx.reduce((s, t) => s + t.amountCents, 0) - cTx.filter((t) => t.status === 'pending' && t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
      if (b.sts() !== expected) fail(`${where}: Safe to Spend ${b.sts()} ≠ ${expected}`);
      const groups = new Map<string, Transaction[]>();
      for (const t of b.data.transactions) if (t.transferGroupId) groups.set(t.transferGroupId, [...(groups.get(t.transferGroupId) ?? []), t]);
      const recorded = recs.filter((x) => x.kind === 'transfer' && txOf.has(x.ref)).length;
      if (groups.size !== recorded) fail(`${where}: ${groups.size} transfers ≠ ${recorded} recorded`);
      for (const [g, legs] of groups) if (legs.length !== 2 || legs[0]!.amountCents + legs[1]!.amountCents !== 0) fail(`${where}: transfer ${g} legs don't cancel`);
      for (const f of b.data.transactions.filter((t) => t.transferFeeOf)) {
        const rec = recs.find((x) => txOf.get(x.ref)?.some((t) => t.transferGroupId === f.transferFeeOf));
        if (!rec || rec.fee !== -f.amountCents || f.accountId !== id[rec.from]) fail(`${where}: unexpected fee ${f.amountCents}`);
      }
    };

    for (let day = '2026-09-02'; day <= '2026-09-30'; day = addDays(day, 1)) {
      b.at(day);
      for (const x of recs.filter((y) => y.d === day)) {
        const txs = x.kind === 'transfer'
          ? b.add({ kind: 'transfer', accountId: id[x.from], toAccountId: id[x.to], date: day, amountCents: x.cents, merchant: `Transfer ${x.ref}`, categoryId: null, status: 'pending' })
          : b.add({ kind: 'expense', accountId: id.C, date: day, amountCents: x.cents, merchant: `Card ${x.ref}`, categoryId: null, status: 'pending' });
        txOf.set(x.ref, txs);
        check(`${day} recorded ${x.ref}`);
      }
      // a leg marked posted by hand on the day its bank posts it (before its statement)
      for (const x of recs.filter((y) => y.manual)) for (const p of x.posts) {
        const t = live(leg(x.ref, p.acct));
        if (p.date === day && t?.status === 'pending' && r() < 0.5) { b.data = applyOps(b.data, markTransactionPosted(b.ctx(), t.id)); tally.manualPosts++; check(`${day} marked ${x.ref} ${p.acct} posted`); }
      }
      for (const a of (r() < 0.5 ? ['C', 'S'] : ['S', 'C']) as ('C' | 'S')[]) {
        if (!schedule[a].includes(day)) continue;
        const rows = posts.filter((p) => p.acct === a && p.date <= day).sort((p, q) => (p.date < q.date ? -1 : p.date > q.date ? 1 : 0));
        if (!rows.length) continue;
        let bal = 500000;
        const lines: Line[] = rows.map((p) => { bal += p.cents; return [p.date, p.desc, p.cents, bal]; });
        const decideFor = () => {
          const rv = b.review(id[a], lines);
          const decide: Record<string, string> = {};
          for (const c of rv.preview.candidates) {
            if (c.duplicate?.level === 'exact') { decide[c.rawDescription] = 'skip'; continue; }
            tally.rows++;
            const p = rows.find((q) => q.desc === c.rawDescription)!;
            const lv = b.live(rv, c.rawDescription);
            if (lv.length > 1) tally.ambiguous++;
            if (lv.some((m) => m.basis === 'stale')) tally.stale++;
            const mine = p.ref ? live(leg(p.ref, a)) : undefined;
            if (mine) {
              if (mine.transferGroupId) tally.transferRows++;
              const m = lv.find((x) => x.txId === mine.id);
              if (m) { decide[c.rawDescription] = mine.id; if (m.feeOption && m.differenceCents) tally.fees++; }
              else { tally.notListed++; fail(`${day} ${a}: ${p.desc} is ${p.ref} but not listed`); decide[c.rawDescription] = 'skip'; }
            } else decide[c.rawDescription] = lv.length ? 'none' : 'auto';
          }
          return { rv, decide };
        };
        let { rv, decide } = decideFor();
        // sometimes another tab marks a transfer leg posted between the review and the commit: the commit must be refused
        const linkedLeg = Object.values(decide).map((v) => b.data.transactions.find((t) => t.id === v)).find((t) => t?.transferGroupId && t.status === 'pending' && !recs.find((x) => txOf.get(x.ref)?.some((y) => y.id === t.id))!.fee);
        if (linkedLeg && r() < 0.2) {
          const decisions = b.decisions(rv, decide);
          b.data = applyOps(b.data, markTransactionPosted(b.ctx(), linkedLeg.id));
          try { b.commit(rv, {}, { decisions }); fail(`${day} ${a}: a stale commit was accepted`); }
          catch (e) { if (e instanceof CommandError && e.issues[0]!.field === 'stale') tally.staleCommitsRefused++; else fail(`${day} ${a}: stale commit failed differently: ${(e as Error).message}`); }
          ({ rv, decide } = decideFor());
        }
        const res = b.commit(rv, decide);
        tally.imports++;
        // a purchase that cleared with a tip: the user edits it to the bank's amount
        for (const x of recs.filter((y) => y.kind === 'card')) {
          const t = live(leg(x.ref, 'C'));
          if (t?.statementMatch?.importBatchId === res.batch.id && t.amountCents !== x.posts[0]!.cents) {
            b.data = applyOps(b.data, updateTransaction(b.ctx(), t.id, { kind: 'expense', accountId: id.C, date: t.date, amountCents: -x.posts[0]!.cents, merchant: t.merchant, categoryId: null, status: 'confirmed' }).ops);
            tally.edits++;
          }
        }
        batches.push({ id: res.batch.id, acct: a, day, prev: lastImport[a] });
        lastImport[a] = day;
        const got = b.posted(id[a], day);
        if (got !== bank(a, day)) fail(`${day} after ${a} import: posted ${got} ≠ bank ${bank(a, day)}`);
        check(`${day} after ${a} import`);
        // sometimes undo it straight away (it is imported again on a later statement day)
        if (day !== '2026-09-30' && r() < 0.12) {
          if (importUndoProblem(b.data, res.batch.id)) fail(`${day}: undo refused: ${importUndoProblem(b.data, res.batch.id)}`);
          // (a fee this import posted together with its leg is its change too)
          const feesPosted = new Set(b.data.transactions.flatMap((t) => (t.statementMatch?.importBatchId === res.batch.id && t.statementMatch.postedFeeTxId ? [t.statementMatch.postedFeeTxId] : [])));
          const others = b.data.transactions.filter((t) => t.statementMatch?.importBatchId !== res.batch.id && t.provenance.importBatchId !== res.batch.id && !feesPosted.has(t.id));
          b.undo(res.batch.id);
          tally.undos++;
          lastImport[a] = batches.at(-1)!.prev;
          // nothing else changed: transactions this import didn't create or link are exactly as before
          for (const t of others) {
            const now = b.data.transactions.find((x) => x.id === t.id);
            if (!now || now.status !== t.status || now.amountCents !== t.amountCents || now.statementMatch?.importBatchId !== t.statementMatch?.importBatchId) {
              // the one exception: the principal of a transfer whose fee this import confirmed
              if (!(now && t.transferGroupId && b.data.transactions.some((y) => y.transferGroupId === t.transferGroupId && y.id !== t.id))) fail(`${day}: undo changed ${t.merchant}`);
            }
          }
          if (b.data.transactions.some((t) => t.statementMatch?.importBatchId === res.batch.id || t.provenance.importBatchId === res.batch.id)) fail(`${day}: undo left something of its import`);
          check(`${day} after undo ${a}`);
        }
      }
    }
    // at the end every account equals its bank, and every leg is posted exactly when its own bank posted it
    for (const a of ['C', 'S'] as const) {
      const asOf = lastImport[a]!;
      if (b.posted(id[a], asOf) !== bank(a, asOf)) fail(`end: ${a} posted ${b.posted(id[a], asOf)} ≠ bank ${bank(a, asOf)}`);
    }
    for (const x of recs) for (const p of x.posts) {
      const t = live(leg(x.ref, p.acct));
      const shouldPost = p.date <= lastImport[p.acct]!;
      if (!t) fail(`end: ${x.ref} ${p.acct} missing`);
      else if ((t.status === 'confirmed') !== shouldPost) fail(`end: ${x.ref} ${p.acct} ${t.status}, its bank posted ${p.date}`);
    }
    tally.runs++;
    if (ok) tally.correct++;
  }
  if (process.env.SETTLEMENT_REPORT) writeFileSync(process.env.SETTLEMENT_REPORT, JSON.stringify({ tally, mismatches }, null, 1));
  expect(mismatches).toEqual([]);
  expect(tally.correct).toBe(RUNS);
  // the generator really exercised every path
  for (const k of ['ambiguous', 'stale', 'fees', 'transferRows', 'undos', 'staleCommitsRefused', 'manualPosts', 'edits'] as const) expect(tally[k], k).toBeGreaterThan(5);
}, 180_000);


