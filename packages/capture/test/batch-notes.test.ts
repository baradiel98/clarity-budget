import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryAdapter, WorkspaceStore, createAccount, onboard } from '@clarity/data';
import { createNobleProvider } from '@clarity/security/noble';
import type { WorkspaceData } from '@clarity/shared';
import { batchAccountNote, draftCardIssues, interpretLocal, reviewDraft, type CaptureContext } from '../src';

/** Phase 4B.1: the default-account note is said once per Capture batch, not on every draft. */
const noble = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
const TODAY = '2026-11-13';
const NOW = Date.UTC(2026, 10, 13, 15);
async function workspace(accounts: number) {
  const { store } = await WorkspaceStore.create(new MemoryAdapter(), noble, 'correct horse battery', { withRecoveryKey: false, now: NOW });
  await store.apply(onboard(store.ctx(NOW, '2026-11-01'), { checkingBalanceCents: 200000 }));
  if (accounts > 1) await store.apply(createAccount(store.ctx(NOW, '2026-11-01'), { name: 'Chase Visa', type: 'credit_card', currentBalanceCents: 30000 }).ops);
  return store.data;
}
const ctxOf = (d: WorkspaceData): CaptureContext => ({ today: TODAY, currency: d.settings.baseCurrency, categories: d.categories, accounts: d.accounts, defaultAccountId: d.settings.defaultAccountId, transactions: d.transactions });
const prepare = (text: string, d: WorkspaceData) => {
  const ctx = ctxOf(d);
  const drafts = interpretLocal(text, ctx).drafts;
  const reviews = new Map(drafts.map((x) => [x.id, reviewDraft(x, ctx)]));
  return { ctx, drafts, reviews, batch: batchAccountNote(drafts, reviews, ctx) };
};

describe('Capture batch notes (Phase 4B.1)', () => {
  it('two drafts with no account named: one batch note, none on the drafts; every other issue and readiness unchanged', async () => {
    const d = await workspace(2);
    const { drafts, reviews, batch } = prepare('Spent $14.50 on lunch at Panera yesterday and $60 on gas today', d);
    expect(drafts).toHaveLength(2);
    for (const x of drafts) expect(reviews.get(x.id)!.map((i) => i.code)).toContain('account_default');
    expect(batch.notes).toEqual(['No account was mentioned in these 2 drafts, so Checking is used for them.']);
    for (const x of drafts) {
      const shown = draftCardIssues(reviews.get(x.id)!, x.id, batch);
      expect(shown.map((i) => i.code)).not.toContain('account_default');
      // only that informational note is removed
      expect(shown).toEqual(reviews.get(x.id)!.filter((i) => i.code !== 'account_default'));
      expect(shown.some((i) => i.blocking)).toBe(reviews.get(x.id)!.some((i) => i.blocking));
      expect(x.accountSource).toBe('default'); // the field still says "your default"
    }
  });

  it('a single draft keeps its own note (no batch note)', async () => {
    const d = await workspace(2);
    const { drafts, reviews, batch } = prepare('Spent $14.50 on lunch at Panera yesterday', d);
    expect(batch.notes).toEqual([]);
    expect(draftCardIssues(reviews.get(drafts[0]!.id)!, drafts[0]!.id, batch).map((i) => i.code)).toContain('account_default');
  });

  it('only the drafts that use the default are counted ("2 of these drafts"); a draft naming its account keeps no such note', async () => {
    const d = await workspace(2);
    const { drafts, reviews, batch } = prepare('Spent $14.50 on lunch at Panera yesterday, $60 on gas today, and $30 at Target on my Chase Visa', d);
    expect(drafts).toHaveLength(3);
    expect(batch.notes).toEqual(['No account was mentioned in 2 of these drafts, so Checking is used for them.']);
    const visa = drafts.find((x) => x.merchant === 'Target')!;
    expect(batch.draftIds.has(visa.id)).toBe(false);
    expect(reviews.get(visa.id)!.map((i) => i.code)).not.toContain('account_default');
  });

  it('one account only: no default-account note at all (unchanged rule)', async () => {
    const d = await workspace(1);
    const { batch, drafts, reviews } = prepare('Spent $14.50 on lunch at Panera yesterday and $60 on gas today', d);
    expect(batch.notes).toEqual([]);
    for (const x of drafts) expect(reviews.get(x.id)!.map((i) => i.code)).not.toContain('account_default');
  });
});
