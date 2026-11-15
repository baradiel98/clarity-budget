import { expect, it } from 'vitest';
import { accountBalance, canIAfford, computeSafeToSpend } from '@clarity/engine';
import type { Account, WorkspaceData } from '@clarity/shared';
import { addDays } from '@clarity/shared';
import { addTransaction, adjustBalance, applyOps, CommandError, createAccount, defaultSettings, deleteTransaction, emptyWorkspace, engineInput, markTransactionPosted, updateTransaction, type Ctx, type TxInput } from '../src';

/**
 * Phase 4A.5.8: random sequences of operations compared, after EVERY step, with a ledger kept here independently from
 * the rules (no engine balance function is used to compute expectations):
 *   - an item counts unless it is history only; history only = posted and dated from the opening date to the day before
 *     the account's confirmed balance date when it was entered (default), or the user's explicit choice (allowed through
 *     the confirmed date itself);
 *   - each transfer leg is decided against its own account's date;
 *   - Update balance: difference = bank posted − (counted − pending); refused when a set of ≤3 pending items adds up to
 *     it (unless confirmed unrelated); an exact match creates no transaction; either way the confirmed date moves;
 *   - Safe to Spend (no scheduled items, reserve 0) = Σ spendable accounts (counted − pending credits)
 *     − max(0, card owed with pending card credits added back) − max(0, −(savings counted − pending credits))
 *     (Phase 4A.5.9: a negative savings balance is owed; a positive one adds nothing). The EUR account never counts.
 * Accounts: checking and cash (spendable, may start negative), savings, a EUR checking, a card (owed or in credit).
 */
type Item = { id: string; acct: string; cents: number; pending: boolean; history: boolean; date: string; group?: string; kind: TxInput['kind'] | 'adjustment' };
const NOW = Date.UTC(2026, 10, 13, 12);
let seq = 0;

it('300 random sequences equal the independent ledger after every step', () => {
  const tally = { runs: 0, steps: 0, partialOnly: 0, adjustments: 0, exactMatches: 0, pendingMatches: 0, resolvedByPosting: 0, unrelated: 0, history: 0, refusedFlags: 0, transfers: 0, splitTransfers: 0 };
  for (let run = 0; run < 300; run++) {
    let s = (run * 2654435761 + 99) >>> 0;
    const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
    let data: WorkspaceData = emptyWorkspace(defaultSettings(NOW));
    let today = '2026-11-01';
    const ctx = (): Ctx => ({ data, now: NOW, today, newId: (p) => `${p}_${++seq}` });
    // ── accounts (opened Nov 1); entered figures are signed; a card's figure is the amount owed (negative = in credit)
    const entered: Record<string, number> = { chk: (Math.floor(r() * 10) - 2) * 10000, wal: (Math.floor(r() * 4) - 1) * 2500, sav: (Math.floor(r() * 5) - 1) * 10000, eur: 20000, visa: (Math.floor(r() * 6) - 2) * 10000 };
    const ids: Record<string, string> = {};
    for (const [k, type] of [['chk', 'checking'], ['wal', 'cash'], ['sav', 'savings'], ['eur', 'checking'], ['visa', 'credit_card']] as const) {
      const a = createAccount(ctx(), { name: k, type, currentBalanceCents: entered[k]! });
      data = applyOps(data, k === 'eur' ? [...a.ops, { t: 'put', table: 'accounts', value: { ...a.account, currency: 'EUR' } }] : a.ops);
      ids[k] = a.account.id;
    }
    const opening: Record<string, number> = { ...entered, visa: 0 - entered.visa! }; // a card is stored as −owed; the sign is never dropped
    for (const k of Object.keys(ids)) expect(data.accounts.find((a) => a.id === ids[k])!.openingBalanceCents).toBe(opening[k]);
    const confirmed: Record<string, string> = { chk: '2026-11-01', wal: '2026-11-01', sav: '2026-11-01', eur: '2026-11-01', visa: '2026-11-01' };
    today = '2026-11-13';
    const items: Item[] = [];
    const before = (x: Item) => x.date < '2026-11-01'; // dated before the opening date: already in the opening balance
    const counted = (k: string) => opening[k]! + items.filter((x) => x.acct === k && !x.history && !before(x)).reduce((a, x) => a + x.cents, 0);
    const pendingOf = (k: string) => items.filter((x) => x.acct === k && !x.history && !before(x) && x.pending);
    // Phase 4A.5.14 (owner decision): a transfer leg still pending at the receiving bank is a pending credit too
    // Phase 4A.5.15: except the card side of a payment from another account (counted once, from where it came)
    const pendingCredits = (k: string) => pendingOf(k).filter((x) => x.cents > 0 && !(k === 'visa' && x.group)).reduce((a, x) => a + x.cents, 0);
    const posted = (k: string) => counted(k) - pendingOf(k).reduce((a, x) => a + x.cents, 0);
    const expectedSts = () => (counted('chk') - pendingCredits('chk')) + (counted('wal') - pendingCredits('wal')) - Math.max(0, pendingCredits('visa') - counted('visa')) - Math.max(0, pendingCredits('sav') - counted('sav'));
    const eligible = (k: string, date: string, pending: boolean) => !pending && date >= '2026-11-01' && date <= confirmed[k]! && date <= today;
    const choice = (k: string, date: string, pending: boolean): { flag: boolean | undefined; history: boolean; refused: boolean } => {
      const roll = r();
      if (roll < 0.25) return { flag: false, history: false, refused: false };
      if (roll < 0.35) return eligible(k, date, pending) ? { flag: true, history: true, refused: false } : { flag: true, history: false, refused: true };
      return { flag: undefined, history: eligible(k, date, pending) && date < confirmed[k]!, refused: false }; // default: strictly before
    };
    const subsetsMatching = (k: string, diff: number) => {
      const p = pendingOf(k).filter((x) => x.date <= today);
      const out: Item[][] = [];
      const walk = (from: number, chosen: Item[], sum: number) => {
        if (chosen.length && sum === diff) out.push([...chosen]);
        if (chosen.length >= 3) return;
        for (let i = from; i < p.length; i++) { chosen.push(p[i]!); walk(i + 1, chosen, sum + p[i]!.cents); chosen.pop(); }
      };
      if (diff !== 0) walk(0, [], 0);
      return out;
    };
    const steps = 4 + Math.floor(r() * 12);
    for (let st = 0; st < steps; st++) {
      if (r() < 0.3) today = addDays(today, 1 + Math.floor(r() * 3));
      const op = r();
      const date = addDays(today, -Math.floor(r() * 14));
      if (op < 0.4 || items.length === 0) {
        const k = pick(['chk', 'chk', 'wal', 'sav', 'eur', 'visa'] as const);
        const credit = r() < 0.45;
        const cents = (1 + Math.floor(r() * 8)) * 2500;
        const pending = r() < 0.4;
        const kind: TxInput['kind'] = credit ? (k === 'visa' || r() < 0.5 ? 'refund' : 'income') : 'expense';
        const c = choice(k, date, pending);
        const input: TxInput = { kind, accountId: ids[k]!, date, amountCents: cents, merchant: 'M', categoryId: null, status: pending ? 'pending' : 'confirmed', ...(c.flag !== undefined ? { includedInBalance: c.flag } : {}) };
        if (c.refused) { expect(() => addTransaction(ctx(), input)).toThrow(CommandError); tally.refusedFlags++; continue; }
        const res = addTransaction(ctx(), input);
        data = applyOps(data, res.ops);
        items.push({ id: res.txs[0]!.id, acct: k, cents: credit ? cents : -cents, pending, history: c.history, date, kind });
        if (c.history) tally.history++;
      } else if (op < 0.5) { // transfer between base accounts (a card only as the destination: a payment)
        const from = pick(['chk', 'wal', 'sav'] as const);
        const to = pick((['chk', 'wal', 'sav', 'visa'] as const).filter((x) => x !== from));
        const cents = (1 + Math.floor(r() * 6)) * 2500;
        const pending = r() < 0.3;
        // Phase 4A.5.14: each leg has its own status (e.g. "Sent · awaiting deposit")
        const toPending = r() < 0.3 ? !pending : pending;
        const cf = choice(from, date, pending), ct = choice(to, date, toPending);
        const input: TxInput = { kind: 'transfer', accountId: ids[from]!, toAccountId: ids[to]!, date, amountCents: cents, merchant: 'T', categoryId: null, status: pending ? 'pending' : 'confirmed', toStatus: toPending ? 'pending' : 'confirmed', ...(cf.flag !== undefined ? { includedInBalance: cf.flag } : {}), ...(ct.flag !== undefined ? { toIncludedInBalance: ct.flag } : {}) };
        if (cf.refused || ct.refused) { expect(() => addTransaction(ctx(), input)).toThrow(CommandError); tally.refusedFlags++; continue; }
        const res = addTransaction(ctx(), input);
        data = applyOps(data, res.ops);
        const g = res.txs[0]!.transferGroupId!;
        items.push({ id: res.txs.find((t) => t.amountCents < 0)!.id, acct: from, cents: -cents, pending, history: cf.history, date, group: g, kind: 'transfer' });
        items.push({ id: res.txs.find((t) => t.amountCents > 0)!.id, acct: to, cents, pending: toPending, history: ct.history, date, group: g, kind: 'transfer' });
        tally.transfers++;
        if (cf.history !== ct.history) tally.splitTransfers++;
      } else if (op < 0.6) { // mark a pending item posted (Phase 4A.5.14: one leg of a transfer only)
        const p = items.filter((x) => x.pending);
        if (!p.length) continue;
        const it = pick(p);
        data = applyOps(data, markTransactionPosted(ctx(), it.id));
        it.pending = false;
      } else if (op < 0.68) { // delete
        const it = pick(items);
        data = applyOps(data, deleteTransaction(ctx(), it.id));
        for (const x of [...items]) if (x.id === it.id || (it.group && x.group === it.group)) items.splice(items.indexOf(x), 1);
      } else if (op < 0.75) { // edit the amount; the inclusion state is kept (no flag passed)
        const it = pick(items.filter((x) => !x.group));
        if (!it) continue;
        if (it.kind === 'adjustment') { // never edited (Phase 4A.5.8: editing one as an expense flipped its sign)
          expect(() => updateTransaction(ctx(), it.id, { kind: 'expense', accountId: ids[it.acct]!, date: it.date, amountCents: 1000, merchant: 'M', categoryId: null })).toThrow(/can’t be edited/);
          continue;
        }
        const cents = (1 + Math.floor(r() * 8)) * 2500;
        data = applyOps(data, updateTransaction(ctx(), it.id, { kind: it.kind as TxInput['kind'], accountId: ids[it.acct]!, date: it.date, amountCents: cents, merchant: 'M', categoryId: null, status: it.pending ? 'pending' : 'confirmed' }).ops);
        it.cents = Math.sign(it.cents) * cents;
      } else { // Update balance with the bank's posted figure: exact, or a difference (sometimes equal to pending items)
        const k = pick(['chk', 'wal', 'sav', 'eur', 'visa'] as const);
        const pend = pendingOf(k);
        const delta = r() < 0.35 ? 0 : r() < 0.5 && pend.length ? pick(pend).cents : (Math.floor(r() * 9) - 4) * 1000;
        const bankPosted = posted(k) + delta;
        const enteredFigure = k === 'visa' ? -bankPosted : bankPosted; // a card is entered as the amount owed
        const matches = subsetsMatching(k, delta);
        // Phase 4A.5.9: any pending item in the same direction (not in an exact set) could explain part of it
        const inExact = new Set(matches.flat().map((x) => x.id));
        const partial = delta === 0 ? [] : pendingOf(k).filter((x) => x.date <= today && !inExact.has(x.id) && Math.sign(x.cents) === Math.sign(delta));
        const before = data.transactions.length;
        if (!matches.length && partial.length) {
          expect(() => adjustBalance(ctx(), ids[k]!, enteredFigure, 'x')).toThrow(/could be pending/);
          const res = adjustBalance(ctx(), ids[k]!, enteredFigure, 'x', today, { unrelatedToPending: true });
          expect(res.tx!.amountCents).toBe(delta);
          data = applyOps(data, res.ops);
          items.push({ id: res.tx!.id, acct: k, cents: delta, pending: false, history: false, date: today, kind: 'adjustment' });
          tally.partialOnly++;
        } else if (matches.length) {
          tally.pendingMatches++;
          expect(() => adjustBalance(ctx(), ids[k]!, enteredFigure, 'x')).toThrow(/matches pending/);
          if (r() < 0.5) {
            // resolve: the first matching set has cleared at the bank → mark it posted; then the bank figure matches exactly
            for (const it of matches[0]!) {
              data = applyOps(data, markTransactionPosted(ctx(), it.id));
              it.pending = false; // Phase 4A.5.14: only this leg
            }
            const res = adjustBalance(ctx(), ids[k]!, enteredFigure, 'x', today, { unrelatedToPending: true }); // other same-direction items may remain
            const left = delta - matches[0]!.reduce((a, x) => a + x.cents, 0); // 0: the set was the difference
            expect(res.tx?.amountCents ?? 0).toBe(left);
            data = applyOps(data, res.ops);
            tally.resolvedByPosting++;
          } else {
            const res = adjustBalance(ctx(), ids[k]!, enteredFigure, 'x', today, { unrelatedToPending: true });
            expect(res.tx!.amountCents).toBe(delta);
            expect(res.tx!.notes).toMatch(/^Confirmed not related to pending/);
            data = applyOps(data, res.ops);
            items.push({ id: res.tx!.id, acct: k, cents: delta, pending: false, history: false, date: today, kind: 'adjustment' });
            tally.unrelated++;
          }
        } else {
          const res = adjustBalance(ctx(), ids[k]!, enteredFigure, 'x');
          data = applyOps(data, res.ops);
          if (delta === 0) { expect(res.tx).toBeNull(); expect(data.transactions.length).toBe(before); tally.exactMatches++; }
          else { expect(res.tx!.amountCents).toBe(delta); items.push({ id: res.tx!.id, acct: k, cents: delta, pending: false, history: false, date: today, kind: 'adjustment' }); tally.adjustments++; }
        }
        confirmed[k] = today;
      }
      tally.steps++;
      // ── after every step ──
      const where = `run ${run} step ${st}`;
      for (const k of Object.keys(ids)) {
        const a = data.accounts.find((x) => x.id === ids[k]) as Account;
        expect(accountBalance(a, data.transactions, today), `${where} recorded ${k}`).toBe(counted(k));
      }
      expect(data.transactions.length, `${where} nothing lost or duplicated`).toBe(items.length);
      expect(data.transactions.every((t) => t.amountCents !== 0), `${where} no $0 transaction`).toBe(true);
      for (const it of items) expect(!!data.transactions.find((t) => t.id === it.id)!.includedInBalance, `${where} history flag ${it.id}`).toBe(it.history);
      const i = engineInput(data, today);
      const sts = computeSafeToSpend(i).cents;
      expect(sts, `${where} Safe to Spend`).toBe(expectedSts());
      // pending credits never raise it; the EUR account never changes it
      expect(computeSafeToSpend({ ...i, transactions: i.transactions.filter((t) => !(t.status === 'pending' && t.amountCents > 0 && !(t.accountId === ids.visa && t.transferGroupId))) }).cents, `${where} pending credits`).toBe(sts);
      expect(computeSafeToSpend({ ...i, transactions: i.transactions.filter((t) => t.accountId !== ids.eur) }).cents, `${where} EUR`).toBe(sts);
      // a transfer whose two sides are both counted moves money without creating or destroying any
      for (const g of new Set(items.filter((x) => x.group).map((x) => x.group!))) {
        const legs = items.filter((x) => x.group === g);
        if (legs.every((x) => !x.history && !before(x))) expect(legs.reduce((a, x) => a + x.cents, 0)).toBe(0);
      }
      if (sts > 0) expect(canIAfford(i, { amountCents: sts + 1, accountId: ids.chk!, date: today }).verdict, `${where} afford`).not.toBe('yes');
    }
    tally.runs++;
  }
  // the generator really exercised every path
  expect(tally.runs).toBe(300);
  for (const k of ['partialOnly', 'adjustments', 'exactMatches', 'pendingMatches', 'resolvedByPosting', 'unrelated', 'history', 'refusedFlags', 'splitTransfers'] as const) expect(tally[k], k).toBeGreaterThan(5);
}, 120_000);
