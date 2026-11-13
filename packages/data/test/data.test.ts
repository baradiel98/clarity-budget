import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '@clarity/engine';
import { buildPreview, csvParser, guessMapping, headerSignature, reconcilePreview, suggestSignConvention } from '@clarity/import';
import { createNobleProvider } from '@clarity/security/noble';
import { createWebCryptoProvider } from '@clarity/security/webcrypto';
import {
  CommandError, MemoryAdapter, WorkspaceStore, addTransaction, adjustBalance, backupDue, buildDemoWorkspace, commitImport, createAccount,
  createRecurring, deleteTransaction, engineInput, exportTransactionsCsv, migrate, onboard, recordOccurrence, setOccurrenceException,
  undoImportBatch, updateTransaction, SCHEMA_VERSION, csvCell,
} from '../src';

const noble = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
const web = createWebCryptoProvider(globalThis.crypto);
const NOW = 1_790_000_000_000;
/** Order-independent comparison of workspace data. */
const norm = (d: object) => JSON.stringify(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, Array.isArray(v) ? [...v].sort((a, b) => (a.id < b.id ? -1 : 1)) : v])));
const TODAY = '2026-09-03';

async function fresh(provider = noble, adapter = new MemoryAdapter()) {
  const { store, recoveryKey } = await WorkspaceStore.create(adapter, provider, 'correct horse battery', { withRecoveryKey: true, now: NOW });
  await store.apply(onboard(store.ctx(NOW, TODAY), {
    checkingBalanceCents: 120000,
    pay: { schedule: { freq: 'weekly', interval: 2, anchor: '2026-09-12' }, amountCents: 180000 },
    bill: { name: 'Rent', amountCents: 140000, date: '2026-10-01', monthly: true },
  }), { now: NOW });
  return { store, adapter, recoveryKey: recoveryKey! };
}

describe('onboarding → first overview', () => {
  it('creates account, paycheck, bill and gives the expected numbers', async () => {
    const { store } = await fresh();
    const d = store.data;
    expect(d.accounts).toHaveLength(1);
    expect(d.recurring.map((r) => r.name)).toEqual(['Paycheck', 'Rent']);
    expect(d.categories.length).toBeGreaterThan(10);
    expect(d.settings.onboardingComplete).toBe(true);
    const dash = buildDashboard(engineInput(d, TODAY));
    // 1,200 + 1,800 (Sep 12) + 1,800 (Sep 26) = 4,800; rent is Oct 1 (outside September)
    expect(dash.monthEnd.cents).toBe(480000);
    // horizon is month-end (next paycheck 9/12 is within the month) → low is today
    expect(dash.safeToSpend.cents).toBe(120000);
  });

  it('"It varies" paycheck creates unknown income, never an invented amount', async () => {
    const adapter = new MemoryAdapter();
    const { store } = await WorkspaceStore.create(adapter, noble, 'correct horse battery', { withRecoveryKey: false, now: NOW });
    await store.apply(onboard(store.ctx(NOW, TODAY), { checkingBalanceCents: 50000, pay: { schedule: { freq: 'monthly', interval: 1, day: 15, anchor: '2026-09-15' }, amountCents: null } }));
    expect(store.data.recurring[0]!.amount).toEqual({ type: 'unknown' });
    expect(buildDashboard(engineInput(store.data, TODAY)).monthEnd.cents).toBe(50000);
  });
});

describe('persistence and encryption', () => {
  it('lock → unlock restores identical data; storage holds only ciphertext', async () => {
    const { store, adapter } = await fresh();
    const acct = store.data.accounts[0]!;
    await store.apply(addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: acct.id, date: TODAY, amountCents: 4321, merchant: 'Trader Joes', categoryId: 'cat_groceries' }).ops);
    const before = norm(store.data);
    store.lock();
    expect(store.isLocked).toBe(true);
    const dump = JSON.stringify([...adapter.rows.values()]) + JSON.stringify(adapter.meta);
    expect(dump).not.toMatch(/Trader|4321|Checking|Rent|Paycheck|120000/);
    const again = await WorkspaceStore.unlock(adapter, web, { passphrase: 'correct horse battery' });
    expect(JSON.parse(norm(again.data))).toEqual(JSON.parse(before));
  });

  it('wrong passphrase fails; recovery key works', async () => {
    const { adapter, recoveryKey } = await fresh();
    await expect(WorkspaceStore.unlock(adapter, noble, { passphrase: 'nope nope nope' })).rejects.toThrow(/not correct/);
    const s = await WorkspaceStore.unlock(adapter, noble, { recoveryKey });
    expect(s.data.accounts).toHaveLength(1);
  });

  it('a failed write leaves memory unchanged (atomic)', async () => {
    const { store, adapter } = await fresh();
    adapter.failNextWrite = true;
    const before = store.data;
    await expect(store.apply(addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: store.data.accounts[0]!.id, date: TODAY, amountCents: 100, merchant: 'x', categoryId: null }).ops)).rejects.toThrow();
    expect(store.data).toBe(before);
  });

  it('changing the passphrase keeps data readable', async () => {
    const { store, adapter } = await fresh();
    await store.changePassphrase('correct horse battery', 'a brand new passphrase');
    const s = await WorkspaceStore.unlock(adapter, noble, { passphrase: 'a brand new passphrase' });
    expect(s.data.recurring).toHaveLength(2);
  });

  it('wipe removes everything', async () => {
    const { store, adapter } = await fresh();
    await store.wipe();
    expect(adapter.meta).toBeNull();
    expect(adapter.rows.size).toBe(0);
    expect(await WorkspaceStore.exists(adapter)).toBe(false);
  });
});

describe('transactions', () => {
  it('add, undo, and duplicate-safe ids', async () => {
    const { store } = await fresh();
    const a = store.data.accounts[0]!;
    const r = addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: a.id, date: TODAY, amountCents: 650, merchant: 'Coffee', categoryId: 'cat_coffee' });
    await store.apply(r.ops, { undoLabel: 'Added Coffee' });
    expect(store.data.transactions[0]).toMatchObject({ amountCents: -650, kind: 'expense' });
    expect(await store.undo()).toBe('Added Coffee');
    expect(store.data.transactions).toHaveLength(0);
  });

  it('rejects invalid input with readable messages', async () => {
    const { store } = await fresh();
    const a = store.data.accounts[0]!;
    expect(() => addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: a.id, date: TODAY, amountCents: 0, merchant: 'x', categoryId: null })).toThrow(CommandError);
    expect(() => addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: a.id, date: TODAY, amountCents: 1000, merchant: 'Split', categoryId: null, splits: [{ categoryId: 'cat_groceries', amountCents: 600 }, { categoryId: 'cat_personal', amountCents: 300 }] })).toThrow(/add up exactly/);
  });

  it('transfers are created, edited and deleted as a pair', async () => {
    const { store } = await fresh();
    const chk = store.data.accounts[0]!;
    const sav = createAccount(store.ctx(NOW, TODAY), { name: 'Savings', type: 'savings', currentBalanceCents: 0 });
    await store.apply(sav.ops);
    const r = addTransaction(store.ctx(NOW, TODAY), { kind: 'transfer', accountId: chk.id, toAccountId: sav.account.id, date: TODAY, amountCents: 5000, merchant: '', categoryId: null });
    await store.apply(r.ops);
    expect(store.data.transactions.map((t) => t.amountCents).sort()).toEqual([-5000, 5000]);
    await store.apply(updateTransaction(store.ctx(NOW, TODAY), r.txs[1]!.id, { kind: 'transfer', accountId: chk.id, toAccountId: sav.account.id, date: TODAY, amountCents: 7500, merchant: 'To savings', categoryId: null }).ops);
    expect(store.data.transactions).toHaveLength(2);
    expect(store.data.transactions.map((t) => t.amountCents).sort()).toEqual([-7500, 7500]);
    expect(new Set(store.data.transactions.map((t) => t.transferGroupId)).size).toBe(1);
    await store.apply(deleteTransaction(store.ctx(NOW, TODAY), r.txs[0]!.id));
    expect(store.data.transactions).toHaveLength(0);
  });

  it('balance adjustment records the difference with a reason', async () => {
    const { store } = await fresh();
    const a = store.data.accounts[0]!;
    const r = adjustBalance(store.ctx(NOW, TODAY), a.id, 115000, 'Matched bank app');
    await store.apply(r.ops);
    expect(r.tx).toMatchObject({ amountCents: -5000, kind: 'adjustment', adjustmentReason: 'Matched bank app' });
    expect(adjustBalance(store.ctx(NOW, TODAY), a.id, 115000, 'x').tx).toBeNull();
  });
});

describe('recurring', () => {
  it('mark paid settles the occurrence once; skip removes it from the forecast', async () => {
    const { store } = await fresh();
    const a = store.data.accounts[0]!;
    const { ops } = createRecurring(store.ctx(NOW, TODAY), { name: 'Phone', kind: 'bill', accountId: a.id, categoryId: 'cat_internet', schedule: { freq: 'monthly', interval: 1, day: 10, anchor: '2026-01-10' }, amount: { type: 'fixed', cents: 6000 } });
    await store.apply(ops);
    let dash = buildDashboard(engineInput(store.data, TODAY));
    expect(dash.monthEnd.cents).toBe(474000);
    const occ = dash.upcoming.find((u) => u.label === 'Phone')!.occurrence!;
    await store.apply(recordOccurrence(store.ctx(NOW, TODAY), occ, { date: TODAY, amountCents: 6000 }).ops);
    dash = buildDashboard(engineInput(store.data, TODAY));
    expect(dash.monthEnd.cents).toBe(474000); // paid early: balance down now, not again on the 10th
    expect(dash.balances.availableCashCents).toBe(114000);
    const pay = dash.upcoming.find((u) => u.label === 'Paycheck')!.occurrence!;
    await store.apply(setOccurrenceException(store.ctx(NOW, TODAY), pay, 'skip'));
    expect(buildDashboard(engineInput(store.data, TODAY)).monthEnd.cents).toBe(294000);
  });
});

describe('statement import commit and undo', () => {
  it('imports approved rows atomically, saves mapping, undo removes them', async () => {
    const { store } = await fresh();
    const acct = store.data.accounts[0]!;
    const text = readFileSync(join(__dirname, '../../import/test/fixtures/signed-newest-first.csv'), 'utf8');
    const table = csvParser.parse(text);
    const g = guessMapping(table);
    const base = { hasHeader: g.hasHeader, columns: g.columns!, dateFormat: g.dateFormats[0]!, decimalSeparator: g.decimalSeparator };
    const settings = { ...base, signConvention: suggestSignConvention(table, base, acct).convention };
    const preview = buildPreview(table, settings, { account: acct, accounts: store.data.accounts, transactions: store.data.transactions, recurring: store.data.recurring, exceptions: store.data.exceptions, importBatches: [], fileHash: 'abc', today: '2026-09-13' });
    const chosen = preview.candidates.filter((c) => c.include);
    const recon = reconcilePreview(preview, chosen, { account: acct, transactions: store.data.transactions });
    const r = commitImport(store.ctx(NOW, '2026-09-13'), {
      accountId: acct.id, fileName: 'sept.csv', fileHash: 'abc', parserId: 'csv', headerSignature: headerSignature(g.headers), delimiter: ',',
      settings, decisions: chosen.map((c) => ({ candidate: c, kind: c.kind, categoryId: c.categoryId, merchant: c.merchant, linkOccurrence: true })),
      totalRows: preview.candidates.length, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: recon, applyAdjustment: true,
    });
    await store.apply(r.ops);
    expect(store.data.transactions.filter((t) => t.provenance.importBatchId === r.batch.id)).toHaveLength(8); // 7 rows + adjustment
    expect(store.data.mappingProfiles).toHaveLength(1);
    expect(store.data.importBatches[0]!.reconciliation!.differenceCents).toBe(-400);
    // paycheck on 09-12 was matched to the recurring paycheck
    expect(store.data.transactions.find((t) => t.kind === 'income')!.occurrenceRef?.originalDate).toBe('2026-09-12');
    await store.apply(undoImportBatch(store.ctx(NOW, '2026-09-13'), r.batch.id));
    expect(store.data.transactions).toHaveLength(0);
    expect(store.data.importBatches[0]!.undoneAt).not.toBeNull();
  });
});

describe('encrypted backup', () => {
  it('web backup restores on mobile provider (and the reverse) with passphrase or recovery key', async () => {
    const { store, recoveryKey } = await fresh(web);
    const text = await store.exportBackup('web', NOW);
    expect(text).not.toMatch(/Paycheck|Rent/);
    expect(store.data.settings.lastBackupAt).toBe(NOW);
    const mobile = new MemoryAdapter('phone');
    const restored = await WorkspaceStore.restoreBackup(mobile, noble, text, { recoveryKey });
    expect(restored.data.recurring.map((r) => r.name).sort()).toEqual(['Paycheck', 'Rent']);
    const back = await restored.exportBackup('android', NOW);
    const webAgain = await WorkspaceStore.restoreBackup(new MemoryAdapter('web2'), web, back, { passphrase: 'correct horse battery' });
    expect(JSON.parse(norm(webAgain.data))).toEqual(JSON.parse(norm({ ...store.data, settings: webAgain.data.settings })));
  });

  it('a wrong secret never replaces existing data', async () => {
    const { store } = await fresh();
    const text = await store.exportBackup('test', NOW);
    const target = new MemoryAdapter();
    await WorkspaceStore.create(target, noble, 'existing data here', { withRecoveryKey: false, now: NOW });
    const metaBefore = JSON.stringify(target.meta);
    await expect(WorkspaceStore.restoreBackup(target, noble, text, { passphrase: 'wrong wrong wrong' })).rejects.toThrow();
    expect(JSON.stringify(target.meta)).toBe(metaBefore);
  });

  it('inspects a backup without decrypting', async () => {
    const { store } = await fresh();
    const info = WorkspaceStore.inspectBackup(await store.exportBackup('web', NOW));
    expect(info).toMatchObject({ appPlatform: 'web', schemaVersion: SCHEMA_VERSION, hasRecoveryKey: true });
  });
});

describe('migrations', () => {
  it('v0 fixture data upgrades to the current schema', () => {
    const v0 = {
      accounts: [{ id: 'a', name: 'Checking', type: 'checking', currency: 'USD', openingBalanceCents: 1000, openingDate: '2026-01-01', spendable: true, archived: false, createdAt: 1, updatedAt: 1 }],
      transactions: [{ id: 't', accountId: 'a', date: '2026-01-02', amountCents: -100, kind: 'expense', merchant: 'x', categoryId: null, createdAt: 1, updatedAt: 1 }],
      recurring: [{ id: 'r', name: 'Rent', kind: 'bill', accountId: 'a', categoryId: null, schedule: { freq: 'once', date: '2026-02-01' }, amount: { type: 'fixed', cents: 500 }, startDate: '2026-01-01', createdAt: 1, updatedAt: 1 }],
      settings: { id: 'settings', baseCurrency: 'USD', minReserveCents: 0 },
    };
    const d = migrate(v0, 0);
    expect(d.transactions[0]).toMatchObject({ status: 'confirmed', provenance: { source: 'manual' } });
    expect(d.recurring[0]).toMatchObject({ trackFrom: '2026-01-01', weekendRule: 'none', paused: false });
    expect(d.importBatches).toEqual([]);
    expect(d.settings.backupReminderDays).toBe(14);
    expect(() => migrate(v0, SCHEMA_VERSION + 1)).toThrow(/newer version/);
  });
});

describe('exports and reminders', () => {
  it('CSV export escapes formula injection', async () => {
    const { store } = await fresh();
    const a = store.data.accounts[0]!;
    await store.apply(addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: a.id, date: TODAY, amountCents: 1000, merchant: '=HYPERLINK("http://x")', categoryId: null }).ops);
    const csv = exportTransactionsCsv(store.data);
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain(',-10.00,');
    expect(csvCell('+1')).toBe("'+1");
  });

  it('backup reminder after transactions or days', async () => {
    const { store } = await fresh();
    expect(backupDue(store.data, NOW).due).toBe(false);
    await store.apply(addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: store.data.accounts[0]!.id, date: TODAY, amountCents: 100, merchant: 'x', categoryId: null }).ops);
    expect(backupDue(store.data, NOW)).toMatchObject({ due: true, reason: 'You have not made a backup yet.' });
    await store.exportBackup('test', NOW);
    expect(backupDue(store.data, NOW + 3 * 86_400_000).due).toBe(false);
    expect(backupDue(store.data, NOW + 15 * 86_400_000).due).toBe(true);
  });
});

describe('demo workspace', () => {
  it('is internally consistent and produces a sensible dashboard', () => {
    const d = buildDemoWorkspace(TODAY, NOW);
    const dash = buildDashboard(engineInput(d, TODAY));
    expect(d.accounts).toHaveLength(3);
    expect(dash.warnings.filter((w) => w.severity === 'critical')).toEqual([]);
    expect(dash.warnings.filter((w) => w.id.startsWith('overdue'))).toEqual([]);
    expect(dash.safeToSpend.cents).toBeGreaterThan(0);
  });
});
