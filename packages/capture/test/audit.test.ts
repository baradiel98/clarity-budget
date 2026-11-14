import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryAdapter, WorkspaceStore, createAccount, onboard } from '@clarity/data';
import { createNobleProvider } from '@clarity/security/noble';
import type { WorkspaceData } from '@clarity/shared';
import { findAmounts, interpretLocal, reviewDraft, toTxInput, type CaptureContext } from '../src';

/** Regression tests for weaknesses found in the Phase 1 audit. Each was silently wrong before. */
const noble = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
const TODAY = '2026-11-13'; // Friday

let data: WorkspaceData;
const ctx = (): CaptureContext => ({ today: TODAY, currency: 'USD', categories: data.categories, accounts: data.accounts, defaultAccountId: data.settings.defaultAccountId, transactions: data.transactions });
const run = (t: string) => interpretLocal(t, ctx());
const blocking = (t: string) => run(t).drafts.map((d) => reviewDraft(d, ctx()).filter((i) => i.blocking).map((i) => i.code));
const acct = (name: string) => data.accounts.find((a) => a.name === name)!.id;

describe('Capture audit regressions', async () => {
  const { store } = await WorkspaceStore.create(new MemoryAdapter(), noble, 'correct horse battery', { withRecoveryKey: false, now: 1 });
  await store.apply(onboard(store.ctx(1, '2026-11-01'), { checkingBalanceCents: 200000 }));
  await store.apply(createAccount(store.ctx(1, '2026-11-01'), { name: 'Savings', type: 'savings', currentBalanceCents: 50000 }).ops);
  await store.apply(createAccount(store.ctx(1, '2026-11-01'), { name: 'Chase Visa', type: 'credit_card', currentBalanceCents: 30000 }).ops);
  data = store.data;

  it('W1: a purchase AT a merchant on the card is spending on the card, not a card payment', () => {
    expect(run('Paid $40 at Target on my Chase Visa today').drafts[0]).toMatchObject({ kind: 'expense', merchant: 'Target', accountId: acct('Chase Visa'), toAccountId: null });
  });

  it('W2: "Visa bill" / "card balance" is a payment to the card (never counted as spending)', () => {
    for (const t of ['Paid $300 Visa bill today', 'Paid the credit card balance $300 today', 'Paid $300 toward my Chase Visa today']) {
      expect(run(t).drafts[0], t).toMatchObject({ kind: 'transfer', role: 'card_payment', toAccountId: acct('Chase Visa'), accountId: acct('Checking') });
    }
  });

  it('W3: a count before a noun is not money when another amount is present', () => {
    expect(run('bought 3 shirts for 45 at Target today').drafts.map((d) => d.amountCents)).toEqual([4500]);
    expect(run('walmart 45 groceries yesterday').drafts.map((d) => d.amountCents)).toEqual([4500]); // single number still money
  });

  it('W4: malformed numbers are never partially read', () => {
    for (const t of ['$1.234,56 at Costco today', '$45,50 at Costco today']) {
      const r = run(t);
      expect(r.drafts, t).toHaveLength(0);
      expect(r.notUnderstood, t).toEqual([t]);
    }
    expect(run('$1,234.56 at Costco today').drafts[0]!.amountCents).toBe(123456);
    expect(findAmounts('$12.30 and $9', [])).toMatchObject([{ cents: 1230 }, { cents: 900 }]);
  });

  it('W5: "k" means thousands, exactly', () => {
    expect(run('$1.5k for rent today').drafts[0]!.amountCents).toBe(150000);
    expect(run('$2k to savings today').drafts[0]!.amountCents).toBe(200000);
  });

  it('W6: "ish" / "or so" are approximate and must be confirmed', () => {
    for (const t of ['spent 50ish at Target today', 'spent $50 or so at Target today']) {
      expect(run(t).drafts[0]!.approximate, t).toBe(true);
      expect(blocking(t)[0], t).toContain('amount_approx');
    }
  });

  it('W7: a range becomes one draft with no amount chosen', () => {
    for (const t of ['$40-50 at Target today', '40 to 50 at Target today', '$40 to $50 at Target today']) {
      const r = run(t);
      expect(r.drafts, t).toHaveLength(1);
      expect(r.drafts[0]!.amountCents, t).toBeNull();
      expect(blocking(t)[0], t).toContain('amount_missing');
    }
  });

  it('W8: weekday names inside merchant names are not dates; conflicting dates in one item are reported', () => {
    expect(run('$20 at Sunday Market today').drafts[0]).toMatchObject({ merchant: 'Sunday Market', date: TODAY, dateAmbiguous: false });
    expect(run('$20 at Sunday Market').drafts[0]).toMatchObject({ merchant: 'Sunday Market', dateSource: 'none' }); // asks to confirm today
    expect(run('Last Friday I spent $20 at Target').drafts[0]!.date).toBe('2026-11-06');
    const conflict = run('Yesterday $5 at CVS today').drafts[0]!;
    expect(conflict.dateAmbiguous).toBe(true);
    expect(blocking('Yesterday $5 at CVS today')[0]).toContain('date_ambiguous');
  });

  it('W9: "cash back" is not treated as a refund; the type must be confirmed', () => {
    const d = run('Got $20 cash back at Walmart today').drafts[0]!;
    expect(d.kind).not.toBe('refund');
    expect(d.kindUnclear).toBe(true);
    expect(toTxInput(d, ctx())).toBeNull();
  });

  it('W10: returning an item "to" a store names the store', () => {
    expect(run('Returned shoes to Nike for $90 today').drafts[0]).toMatchObject({ kind: 'refund', merchant: 'Nike' });
  });

  it('W11: "transferred to <person>" is money to someone, not between accounts; the type must be confirmed', () => {
    const d = run('Transferred $100 to Mom today').drafts[0]!;
    expect(d).toMatchObject({ kind: 'expense', merchant: 'Mom', kindUnclear: true });
    expect(run('Transferred $300 from checking to savings today').drafts[0]).toMatchObject({ kind: 'transfer', accountId: acct('Checking'), toAccountId: acct('Savings'), kindUnclear: false });
    expect(run('Sarah paid me back $20 today').drafts[0]!.kindUnclear).toBe(true);
  });

  it('unchanged: purchases with the card, other currencies, unknown accounts, times and percentages', () => {
    expect(run('Paid my rent $1400 with my credit card today').drafts[0]).toMatchObject({ kind: 'expense', accountId: acct('Chase Visa') });
    expect(blocking('20 EUR at Zara today')[0]).toContain('currency_other');
    expect(blocking('Spent $15 at CVS with cash today')[0]).toContain('account_unknown');
    expect(run('Spent $10 at CVS at 5pm yesterday').drafts.map((d) => [d.amountCents, d.date])).toEqual([[1000, '2026-11-12']]);
    expect(run('Spent 20% more, $30 at Target today').drafts.map((d) => d.amountCents)).toEqual([3000]);
    expect(run('$5 coffee at Starbucks, $5 coffee at Starbucks today').drafts).toHaveLength(2); // two coffees are two coffees
  });
});
