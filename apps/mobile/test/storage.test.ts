import { randomBytes } from 'node:crypto';
import { addTransaction, onboard, WorkspaceStore } from '@clarity/data';
import { buildDashboard } from '@clarity/engine';
import { createWebCryptoProvider } from '@clarity/security/webcrypto';
import { engineInput, MemoryAdapter } from '@clarity/data';
import { dbs, sqliteMock } from './fakeSqlite';

jest.mock('expo-sqlite', () => require('./fakeSqlite').sqliteMock);
jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));

// Imported after mocks so the adapter and provider use them.
import { SQLiteAdapter } from '../src/platform/sqliteAdapter';
import { provider } from '../src/platform/crypto';

const NOW = 1_790_000_000_000;
const TODAY = '2026-09-03';
void sqliteMock;
void randomBytes;

describe('SQLiteAdapter + mobile crypto provider', () => {
  beforeEach(() => dbs.clear());
  jest.setTimeout(120_000);

  it('creates, writes, locks and unlocks; the database holds only ciphertext', async () => {
    const adapter = new SQLiteAdapter('t1.db');
    const { store } = await WorkspaceStore.create(adapter, provider, 'phone passphrase here', { withRecoveryKey: true, now: NOW });
    await store.apply(onboard(store.ctx(NOW, TODAY), { checkingBalanceCents: 120000, pay: { schedule: { freq: 'weekly', interval: 2, anchor: '2026-09-12' }, amountCents: 180000 } }));
    const acct = store.data.accounts[0]!;
    await store.apply(addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: acct.id, date: TODAY, amountCents: 650, merchant: 'Corner Cafe', categoryId: 'cat_coffee' }).ops);
    store.lock();
    const raw = JSON.stringify([...dbs.get('t1.db')!.rows.values(), ...dbs.get('t1.db')!.meta.values()]);
    expect(raw).not.toMatch(/Corner|Paycheck|Checking|120000|650/);
    const again = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'phone passphrase here' });
    expect(buildDashboard(engineInput(again.data, TODAY)).balances.availableCashCents).toBe(119350);
  });

  it('a failed write rolls back and leaves memory unchanged', async () => {
    const adapter = new SQLiteAdapter('t2.db');
    const { store } = await WorkspaceStore.create(adapter, provider, 'phone passphrase here', { withRecoveryKey: false, now: NOW });
    await store.apply(onboard(store.ctx(NOW, TODAY), { checkingBalanceCents: 1000 }));
    const before = store.data;
    const rowsBefore = dbs.get('t2.db')!.rows.size;
    dbs.get('t2.db')!.failAfter = 1;
    const acct = store.data.accounts[0]!;
    const transfer = addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: acct.id, date: TODAY, amountCents: 100, merchant: 'x', categoryId: null });
    await expect(store.apply(transfer.ops)).rejects.toThrow('disk full');
    expect(store.data).toBe(before);
    expect(dbs.get('t2.db')!.rows.size).toBe(rowsBefore);
  });

  it('wipe crypto-shreds and deletes the database', async () => {
    const adapter = new SQLiteAdapter('t3.db');
    const { store } = await WorkspaceStore.create(adapter, provider, 'phone passphrase here', { withRecoveryKey: false, now: NOW });
    await store.wipe();
    expect(dbs.has('t3.db')).toBe(false);
  });

  it('restores a backup made by the web app (WebCrypto + hash-wasm)', async () => {
    const web = createWebCryptoProvider(globalThis.crypto);
    const { store: webStore, recoveryKey } = await WorkspaceStore.create(new MemoryAdapter('web'), web, 'web passphrase here', { withRecoveryKey: true, now: NOW });
    await webStore.apply(onboard(webStore.ctx(NOW, TODAY), { checkingBalanceCents: 50000, bill: { name: 'Rent', amountCents: 40000, date: '2026-09-20', monthly: true } }));
    const file = await webStore.exportBackup('web', NOW);
    const phone = await WorkspaceStore.restoreBackup(new SQLiteAdapter('t4.db'), provider, file, { recoveryKey: recoveryKey! });
    expect(buildDashboard(engineInput(phone.data, TODAY)).monthEnd.cents).toBe(10000);
    // and back again: phone backup restores with the web provider
    const back = await phone.exportBackup('ios', NOW);
    const web2 = await WorkspaceStore.restoreBackup(new MemoryAdapter('web2'), web, back, { passphrase: 'web passphrase here' });
    expect(web2.data.recurring.map((r) => r.name)).toEqual(['Rent']);
  });
});
