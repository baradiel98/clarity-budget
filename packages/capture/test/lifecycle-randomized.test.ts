import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays, type ID } from '@clarity/shared';
import { applyOps, deleteTransaction, importUndoProblem, markTransactionPosted, recordPaymentReturn, saveCaptured, updateTransaction, type CaptureItem } from '@clarity/data';
import { Book } from '../../data/test/fixtures/settlement-harness';
import { interpretLocal, reviewDraft, toCaptureItem, type CaptureContext } from '../src';

/**
 * Phase 4A.7: a randomized lifecycle model, independent of the engine. The truth is each bank's own ledger, kept by the
 * model with plain integer arithmetic: Checking = 3,000 − payments + returns + genuine deposits; the card is owed its
 * opening balance − payments + returns. Safe to Spend (no schedules) = Checking − max(0, owed). Every action goes
 * through the commands the apps use: a card payment entered by hand or imported from a checking statement; its return
 * (full or partial) entered by hand, through the import review, or through Clarity Capture (confirmed as a return); a
 * genuine deposit captured as "separate income"; posting a leg; editing the payment's amount or card; deleting a
 * return or a payment; undoing an import. The model also states what MUST be refused (Phase 4A.7 policy): undoing the
 * import that created a payment with returns, deleting such a payment, editing it below what was returned or to
 * another card. A refused action must change nothing. No mismatch and no orphaned return is tolerated (no re-sync).
 */
describe('randomized transaction lifecycle (independent ledger)', () => {
  it('300 scenarios × 14 steps: Safe to Spend, checking balance and return links always match the banks', () => {
    let s = 0;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const res = { scenarios: 0, actions: 0, refused: 0, byAction: {} as Record<string, number>, mismatches: [] as string[], worstCents: 0 };
    for (let run = 1; run <= 300; run++) {
      s = run * 7331;
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
      const b = new Book();
      const c = b.acct('Checking', 'checking', 300000);
      const v = b.acct('Visa', 'credit_card', pick([20000, 60000]));
      const amex = b.acct('Amex', 'credit_card', 0);
      b.at('2026-09-12');
      let money = 300000;
      let owed = -b.a(v).openingBalanceCents;
      type Ret = { id: ID; cents: number; batch?: ID };
      type Pay = { out: ID; cents: number; date: string; batch?: ID; returns: Ret[] };
      const pays: Pay[] = [];
      const returned = (p: Pay) => p.returns.reduce((a, r) => a + r.cents, 0);
      const cap = (): CaptureContext => ({ today: b.today, currency: 'USD', categories: b.data.categories, accounts: b.data.accounts, defaultAccountId: c, transactions: b.data.transactions });
      const live = (p: Pay) => b.data.transactions.some((x) => x.id === p.out);
      const refuse = (what: string, f: () => unknown) => {
        const before = JSON.stringify(b.data);
        let threw = false;
        try { f(); } catch { threw = true; }
        if (!threw) res.mismatches.push(`run ${run}: ${what} was NOT refused`);
        if (JSON.stringify(b.data) !== before) res.mismatches.push(`run ${run}: refused ${what} changed data`);
        res.refused++;
      };
      for (let step = 0; step < 14; step++) {
        const op = rnd();
        let act = '';
        if (op < 0.22 || !pays.length) {
          const cents = pick([10000, 20000, 15000]);
          const date = addDays(b.today, -Math.floor(rnd() * 4));
          if (rnd() < 0.5) {
            const t = b.transfer(c, v, date, cents, pick(['pending', 'confirmed'] as const), pick(['pending', 'confirmed'] as const));
            pays.push({ out: t.out.id, cents, date, returns: [] });
            act = 'payment (manual)';
          } else {
            const desc = `VISA PMT ${run}-${step}`;
            const rv = b.review(c, [[date, desc, -cents, 100000]]);
            const r = b.commit(rv, { [desc]: rv.preview.candidates[0]!.matchCandidates.length ? 'none' : 'auto' }, { other: { [desc]: v } });
            pays.push({ out: r.txs.find((x) => x.accountId === c)!.id, cents, date, batch: r.batch.id, returns: [] });
            act = 'payment (import)';
          }
          money -= cents; owed -= cents;
        } else if (op < 0.32) {
          const p = pick(pays);
          if (!live(p)) continue;
          b.data = applyOps(b.data, markTransactionPosted(b.ctx(), p.out));
          act = 'post';
        } else if (op < 0.55) {
          const p = pick(pays);
          const left = p.cents - returned(p);
          if (!left || !live(p)) continue;
          const amt = rnd() < 0.3 && left > 5000 ? 5000 : left;
          const how = pick(['manual', 'import', 'capture'] as const);
          if (how === 'manual') {
            const r = recordPaymentReturn(b.ctx(), { paymentLegId: p.out, accountId: c, amountCents: amt, date: b.today });
            b.data = applyOps(b.data, r.ops);
            p.returns.push({ id: r.txs[0]!.id, cents: amt });
          } else if (how === 'import') {
            const desc = `RETURNED PAYMENT ${run}-${step}`;
            const r = b.commit(b.review(c, [[b.today, desc, amt, 100000]]), { [desc]: p.out });
            p.returns.push({ id: r.txs.find((x) => x.accountId === c && x.returnOf)!.id, cents: amt, batch: r.batch.id });
          } else {
            const [d] = interpretLocal(`Received $${amt / 100} today, payment returned`, cap()).drafts;
            const chosen = { ...d!, accountId: c, returnChoice: p.out };
            if (reviewDraft(chosen, cap()).some((i) => i.blocking)) { res.mismatches.push(`run ${run}: captured return still blocked`); continue; }
            const r = saveCaptured(b.ctx(), [toCaptureItem(chosen, cap()) as CaptureItem]);
            b.data = applyOps(b.data, r.ops);
            p.returns.push({ id: r.txs[0]!.id, cents: amt });
          }
          money += amt; owed += amt;
          act = `return (${how})`;
        } else if (op < 0.6) {
          // a genuine deposit captured as separate income (the decision is the user's)
          const [d] = interpretLocal('Received $100 today', cap()).drafts;
          const item = toCaptureItem({ ...d!, accountId: c, returnChoice: 'separate', acknowledged: [...d!.acknowledged, 'duplicate'] }, cap()); // a second $100 deposit: "Keep it"
          if (!item) { res.mismatches.push(`run ${run}: separate income still blocked`); continue; }
          b.data = applyOps(b.data, saveCaptured(b.ctx(), [item]).ops);
          money += 10000;
          act = 'deposit (capture, separate)';
        } else if (op < 0.68) {
          const p = pick(pays);
          if (!live(p)) continue;
          const to = pick([v, amex]);
          const cents = pick([5000, 10000, 20000, 25000]);
          const input = { kind: 'transfer' as const, accountId: c, toAccountId: to, date: p.date, amountCents: cents, merchant: 'Payment', categoryId: null };
          if (p.returns.length && (to !== v || cents < returned(p))) { refuse('editing a returned payment unsafely', () => updateTransaction(b.ctx(), p.out, input)); act = 'edit (refused)'; }
          else if (to !== v) { act = ''; continue; } // moving a payment to Amex: out of the model's scope
          else {
            b.data = applyOps(b.data, updateTransaction(b.ctx(), p.out, input).ops);
            const delta = cents - p.cents;
            money -= delta; owed -= delta; p.cents = cents;
            act = 'edit amount';
          }
        } else if (op < 0.78) {
          const p = pick(pays.filter((x) => x.returns.length));
          if (!p) continue;
          const r = pick(p.returns);
          if (r.batch && rnd() < 0.6) b.undo(r.batch);
          else b.data = applyOps(b.data, deleteTransaction(b.ctx(), r.id));
          p.returns.splice(p.returns.indexOf(r), 1);
          money -= r.cents; owed -= r.cents;
          act = r.batch ? 'remove imported return' : 'delete return';
        } else if (op < 0.9) {
          const p = pick(pays.filter((x) => x.batch));
          if (!p) continue;
          if (p.returns.length) { refuse('undoing the import of a payment with returns', () => b.undo(p.batch!)); act = 'undo payment import (refused)'; }
          else {
            if (importUndoProblem(b.data, p.batch!)) { res.mismatches.push(`run ${run}: undo refused without returns`); continue; }
            b.undo(p.batch!); pays.splice(pays.indexOf(p), 1);
            money += p.cents; owed += p.cents;
            act = 'undo payment import';
          }
        } else {
          const p = pick(pays);
          if (!live(p)) continue;
          if (p.returns.length) { refuse('deleting a payment with returns', () => deleteTransaction(b.ctx(), p.out)); act = 'delete payment (refused)'; }
          else {
            b.data = applyOps(b.data, deleteTransaction(b.ctx(), p.out)); pays.splice(pays.indexOf(p), 1);
            money += p.cents; owed += p.cents;
            act = 'delete payment';
          }
        }
        res.actions++;
        res.byAction[act] = (res.byAction[act] ?? 0) + 1;
        const expected = money - Math.max(0, owed);
        const got = b.sts();
        if (got !== expected) { res.mismatches.push(`run ${run} step ${step} after ${act}: STS ${got} ≠ ${expected}`); res.worstCents = Math.max(res.worstCents, Math.abs(got - expected)); }
        if (b.rec(c) !== money) { res.mismatches.push(`run ${run} step ${step} after ${act}: checking ${b.rec(c)} ≠ ${money}`); res.worstCents = Math.max(res.worstCents, Math.abs(b.rec(c) - money)); }
        // structure: every return belongs to an existing payment, and never exceeds it
        const groups = new Set(b.data.transactions.filter((t) => t.transferGroupId && !t.returnOf).map((t) => t.transferGroupId));
        for (const t of b.data.transactions) if (t.returnOf && !groups.has(t.returnOf)) res.mismatches.push(`run ${run} step ${step} after ${act}: orphaned return ${t.id}`);
        for (const p of pays) if (returned(p) > p.cents) res.mismatches.push(`run ${run}: model returns exceed payment`);
      }
      res.scenarios++;
    }
    if (process.env.LIFECYCLE_OUT) writeFileSync(process.env.LIFECYCLE_OUT, JSON.stringify(res, null, 1));
    expect(res.mismatches.slice(0, 10)).toEqual([]);
    expect(res.scenarios).toBe(300);
    // every action type, including each refusal, was exercised
    for (const k of ['payment (manual)', 'payment (import)', 'post', 'return (manual)', 'return (import)', 'return (capture)', 'deposit (capture, separate)', 'edit amount', 'edit (refused)', 'delete return', 'remove imported return', 'undo payment import', 'undo payment import (refused)', 'delete payment', 'delete payment (refused)']) {
      expect(res.byAction[k] ?? 0, k).toBeGreaterThan(0);
    }
  });
});
