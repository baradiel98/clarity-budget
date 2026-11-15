import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addDays, type ID } from '@clarity/shared';
import { findMatchCandidates } from '@clarity/import';
import { paymentReturnStatus } from '@clarity/engine';
import { applyOps, deleteTransaction, markTransactionPosted } from '../src';
import { Book, row, type Line } from './fixtures/settlement-harness';

/**
 * Phase 4A.8: a randomized model of same-statement card returns (N1) and transfer fees on returned payments (N2),
 * independent of the engine. Truth is each bank's ledger in plain integer arithmetic: Checking = 3,000 − payments −
 * fees + returns + separate refunds; Visa owed = opening − what Visa received (the payment, or the smaller amount a fee
 * left) + returns. No schedules, all returns posted in checking, so Safe to Spend = Checking − max(0, owed).
 *
 * Actions: a payment entered by hand; a statement with a payment AND its return (full or partial, rows in either order)
 * with the pairing confirmed, or rejected (a separate refund, the user's decision); a statement with only a return of
 * an earlier payment; a Visa statement showing less received than paid (the fee option: offered only when it keeps
 * the payment at least what was returned, otherwise refused); posting; deleting a return or a payment; undoing an
 * import. The model also states what must be refused (undo while a return from another import or by hand depends on
 * the payment, or after a later statement linked it; deleting a payment with returns; a fee below the returned total).
 * A refused action must change nothing. No mismatch is tolerated (no re-sync).
 */
describe('randomized same-statement returns and fees (independent ledger)', () => {
  it('300 scenarios × 14 steps', () => {
    let s = 0;
    const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const res = { scenarios: 0, actions: 0, refused: 0, byAction: {} as Record<string, number>, mismatches: [] as string[], worstCents: 0 };
    for (let run = 1; run <= 300; run++) {
      s = run * 4099 + 7;
      const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)] as T;
      const b = new Book();
      const c = b.acct('Checking', 'checking', 300000);
      const v = b.acct('Visa', 'credit_card', pick([20000, 60000]));
      b.at('2026-09-12');
      let money = 300000;
      let owed = -b.a(v).openingBalanceCents;
      type Ret = { id: ID; cents: number; batch?: ID };
      type Pay = { out: ID; vin: ID; cents: number; fee: number; date: string; batch?: ID; linked: boolean; rets: Ret[]; refund: number };
      const pays: Pay[] = [];
      const returned = (p: Pay) => p.rets.reduce((a, r) => a + r.cents, 0);
      const live = (p: Pay) => b.data.transactions.some((x) => x.id === p.out);
      const snap = () => JSON.stringify([b.data.transactions, b.data.importBatches]);
      const refuse = (what: string, f: () => unknown) => {
        const before = snap();
        let threw = false;
        try { f(); } catch { threw = true; }
        if (!threw) res.mismatches.push(`run ${run}: ${what} was NOT refused`);
        else if (snap() !== before) res.mismatches.push(`run ${run}: refused ${what} changed data`);
        res.refused++;
      };
      for (let step = 0; step < 14; step++) {
        const op = rnd();
        let act = '';
        const tag = `${run}-${step}`;
        if (op < 0.12 || !pays.length) {
          const cents = pick([10000, 15000, 20000]);
          const date = addDays(b.today, -Math.floor(rnd() * 4));
          const t = b.transfer(c, v, date, cents, pick(['pending', 'confirmed'] as const), 'pending');
          pays.push({ out: t.out.id, vin: t.in.id, cents, fee: 0, date, linked: false, rets: [], refund: 0 });
          money -= cents; owed -= cents;
          act = 'payment (manual)';
        } else if (op < 0.4) {
          // a statement with a card payment and its return (neither in Clarity)
          const cents = pick([10000, 15000, 20000]);
          const amt = rnd() < 0.3 ? 5000 : cents;
          const pd = addDays(b.today, -Math.floor(rnd() * 4));
          const PAY: Line = [pd, `PAYMENT TO VISA ${tag}`, -cents, 100000];
          const RET: Line = [b.today, `RETURNED PAYMENT ${tag}`, amt, 100000];
          const rv = b.review(c, rnd() < 0.5 ? [PAY, RET] : [RET, PAY]);
          const pr = row(rv, PAY[1]); const rr = row(rv, RET[1]);
          if (!rr.statementReturnOf?.length) { res.mismatches.push(`run ${run}: no pairing offered`); continue; }
          const reject = rnd() < 0.2;
          // the payment row may also look like an existing (pending) transaction: the user says it's a different one;
          // a return row that could ALSO be an earlier payment's return: the user still says which (here: this statement's)
          const choice = reject ? 'none' : `row:${rr.statementReturnOf[0]!.paymentRow}`;
          const r = b.commit(rv, { [PAY[1]]: pr.matchCandidates.length ? 'none' : 'auto', [RET[1]]: choice }, { other: { [PAY[1]]: v } });
          const out = r.txs.find((t) => t.accountId === c && t.transferGroupId && !t.returnOf)!;
          const vin = r.txs.find((t) => t.accountId === v && t.transferGroupId === out.transferGroupId)!;
          const p: Pay = { out: out.id, vin: vin.id, cents, fee: 0, date: pd, batch: r.batch.id, linked: false, rets: [], refund: reject ? amt : 0 };
          if (!reject) p.rets.push({ id: r.txs.find((t) => t.returnOf && t.accountId === c)!.id, cents: amt, batch: r.batch.id });
          pays.push(p);
          money += -cents + amt; owed += -cents + (reject ? 0 : amt);
          act = reject ? 'statement pair rejected (separate refund)' : 'statement pair';
        } else if (op < 0.47) {
          const p = pick(pays);
          const left = p.cents - returned(p);
          if (!left || !live(p)) continue;
          const amt = rnd() < 0.4 && left > 5000 ? 5000 : left;
          const desc = `RETURNED PAYMENT ${tag}`;
          const rv = b.review(c, [[b.today, desc, amt, 100000]]);
          if (!row(rv, desc).matchCandidates.some((m) => m.txId === p.out && m.basis === 'return')) continue;
          const r = b.commit(rv, { [desc]: p.out });
          p.rets.push({ id: r.txs.find((t) => t.returnOf && t.accountId === c)!.id, cents: amt, batch: r.batch.id });
          money += amt; owed += amt;
          act = 'return (later statement)';
        } else if (op < 0.62) {
          // Visa shows less received than was paid: the fee option
          const p = pick(pays);
          if (!live(p) || p.linked || p.fee) continue;
          const principal = p.cents - pick([2500, 5000]);
          const desc = `PAYMENT THANK YOU ${tag}`;
          const rowLine: Line = [b.today, desc, principal, 0];
          const cand = findMatchCandidates({ date: b.today, amountCents: principal, rawDescription: desc }, b.a(v), b.data.transactions, { accounts: b.data.accounts }).find((m) => m.txId === p.vin);
          if (!cand) continue;
          const rv = b.review(v, [rowLine], 'as_is');
          if (returned(p) > principal) {
            if (cand.feeOption || cand.feeBlockedByReturnsCents !== returned(p)) res.mismatches.push(`run ${run}: fee option offered below the returned total`);
            const forced = b.decisions(rv, { [desc]: p.vin }).map((d) => ({ ...d, match: { ...(d.match as { txId: ID }), txId: p.vin, fee: { feeCents: p.cents - principal } } }));
            refuse('a fee below the returned total', () => b.commit(rv, {}, { decisions: forced as never }));
            act = 'fee (refused)';
          } else {
            if (cand.feeOption?.feeCents !== p.cents - principal) { res.mismatches.push(`run ${run}: fee option missing`); continue; }
            b.commit(rv, { [desc]: p.vin });
            owed += p.cents - principal; // Visa received less; checking's total (payment + fee) is unchanged
            p.fee = p.cents - principal; p.cents = principal; p.linked = true;
            act = 'fee';
          }
        } else if (op < 0.68) {
          const p = pick(pays);
          if (!live(p)) continue;
          b.data = applyOps(b.data, markTransactionPosted(b.ctx(), p.out));
          act = 'post';
        } else if (op < 0.8) {
          const withRets = pays.filter((x) => x.rets.length);
          if (!withRets.length) continue;
          const p = pick(withRets);
          const r = pick(p.rets);
          b.data = applyOps(b.data, deleteTransaction(b.ctx(), r.id));
          p.rets.splice(p.rets.indexOf(r), 1);
          money -= r.cents; owed -= r.cents;
          act = 'delete return';
        } else if (op < 0.9) {
          const p = pick(pays);
          if (!live(p)) continue;
          if (p.rets.length) { refuse('deleting a payment with returns', () => deleteTransaction(b.ctx(), p.out)); act = 'delete payment (refused)'; }
          else {
            b.data = applyOps(b.data, deleteTransaction(b.ctx(), p.out));
            pays.splice(pays.indexOf(p), 1);
            money += p.cents + p.fee; owed += p.cents;
            act = 'delete payment';
          }
        } else {
          const imported = pays.filter((x) => x.batch);
          if (!imported.length) continue;
          const p = pick(imported);
          const ok = !p.linked && p.rets.every((r) => r.batch === p.batch);
          if (!ok) { refuse('undo with dependent returns or a later link', () => b.undo(p.batch as ID)); act = 'undo (refused)'; }
          else {
            b.undo(p.batch as ID);
            pays.splice(pays.indexOf(p), 1);
            const back = returned(p);
            // the separate refund imported with a rejected pairing (same batch) goes too
            money += p.cents + p.fee - back - p.refund; owed += p.cents - back;
            act = 'undo payment import';
          }
        }
        res.actions++;
        res.byAction[act] = (res.byAction[act] ?? 0) + 1;
        const exp = money - Math.max(0, owed);
        const got = b.sts();
        if (got !== exp) { res.mismatches.push(`run ${run} step ${step} after ${act}: STS ${got} ≠ ${exp}`); res.worstCents = Math.max(res.worstCents, Math.abs(got - exp)); }
        if (b.rec(c) !== money) { res.mismatches.push(`run ${run} step ${step} after ${act}: checking ${b.rec(c)} ≠ ${money}`); res.worstCents = Math.max(res.worstCents, Math.abs(b.rec(c) - money)); }
        if (-b.rec(v) !== owed) { res.mismatches.push(`run ${run} step ${step} after ${act}: Visa owes ${-b.rec(v)} ≠ ${owed}`); res.worstCents = Math.max(res.worstCents, Math.abs(-b.rec(v) - owed)); }
        const groups = new Set(b.data.transactions.filter((t) => t.transferGroupId && !t.returnOf).map((t) => t.transferGroupId!));
        for (const t of b.data.transactions) if (t.returnOf && !groups.has(t.returnOf)) res.mismatches.push(`run ${run} step ${step} after ${act}: orphaned return`);
        for (const g of groups) { const st = paymentReturnStatus(g, b.data.transactions); if (st.returnedCents > st.paymentCents) res.mismatches.push(`run ${run} step ${step} after ${act}: returns exceed payment`); }
      }
      res.scenarios++;
    }
    if (process.env.STATEMENT_OUT) writeFileSync(process.env.STATEMENT_OUT, JSON.stringify(res, null, 1));
    expect(res.mismatches.slice(0, 8)).toEqual([]);
    for (const k of ['payment (manual)', 'statement pair', 'statement pair rejected (separate refund)', 'return (later statement)', 'fee', 'fee (refused)', 'post', 'delete return', 'delete payment', 'delete payment (refused)', 'undo payment import', 'undo (refused)']) expect(res.byAction[k] ?? 0, k).toBeGreaterThan(0);
  });
});
