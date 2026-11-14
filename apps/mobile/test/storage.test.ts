import { randomBytes } from 'node:crypto';
import { addTransaction, onboard, WorkspaceStore } from '@clarity/data';
import { buildDashboard } from '@clarity/engine';
import { createWebCryptoProvider } from '@clarity/security/webcrypto';
import { engineInput, MemoryAdapter } from '@clarity/data';
import { dbs, sqliteMock } from './fakeSqlite';

jest.mock('expo-sqlite', () => require('./fakeSqlite').sqliteMock);
// Seeded random bytes (test only): keys, IVs and ids are the same on every run, so the ciphertext checked
// below is reproducible. The app itself uses expo-crypto's secure random source; nothing here changes it.
jest.mock('expo-crypto', () => {
  let s = 1;
  const next = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s >>> 0; };
  return {
    __reseed: (seed: number) => { s = seed >>> 0 || 1; },
    getRandomBytes: (n: number) => { const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = next() & 0xff; return out; },
  };
});

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
    // Deterministic: fixed clock (row timestamps) and seeded random bytes (keys, IVs, ids).
    (require('expo-crypto') as { __reseed: (s: number) => void }).__reseed(42);
    const clock = jest.spyOn(Date, 'now').mockReturnValue(NOW);
    try {
      const adapter = new SQLiteAdapter('t1.db');
      const { store } = await WorkspaceStore.create(adapter, provider, 'phone passphrase here', { withRecoveryKey: true, now: NOW });
      await store.apply(onboard(store.ctx(NOW, TODAY), { checkingBalanceCents: 120000, pay: { schedule: { freq: 'weekly', interval: 2, anchor: '2026-09-12' }, amountCents: 180000 } }));
      const acct = store.data.accounts[0]!;
      await store.apply(addTransaction(store.ctx(NOW, TODAY), { kind: 'expense', accountId: acct.id, date: TODAY, amountCents: 650, merchant: 'Corner Cafe', categoryId: 'cat_coffee' }).ops);
      // The sensitive values, exactly as they appear in a record's plaintext JSON.
      const plaintextOf = (x: unknown) => JSON.stringify(x);
      const secrets = ['"merchant":"Corner Cafe"', '"amountCents":-650', '"name":"Paycheck"', `"name":"${acct.name}"`, '120000', 'Corner Cafe', 'Paycheck', acct.name];
      // Control: the same scan finds them in unencrypted data, so the check below cannot pass vacuously.
      const clear = plaintextOf({ transactions: store.data.transactions, recurring: store.data.recurring, accounts: store.data.accounts });
      for (const v of ['"merchant":"Corner Cafe"', '"amountCents":-650', '"name":"Paycheck"', 'Corner Cafe', acct.name]) expect(clear).toContain(v);
      store.lock();

      const db = dbs.get('t1.db')!;
      const rows = [...db.rows.values()];
      expect(rows.length).toBeGreaterThan(10);
      const enc = new TextEncoder();
      const has = (hay: Uint8Array, needle: string) => {
        const n = enc.encode(needle);
        outer: for (let i = 0; i + n.length <= hay.length; i++) { for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer; return true; }
        return false;
      };
      for (const r of rows) {
        // only the storage envelope is in the clear: no record fields, no extra columns
        expect(Object.keys(r).sort()).toEqual(['ct', 'deleted', 'device_id', 'id', 'iv', 'key_version', 'table_name', 'updated_at']);
        expect(r.updated_at).toBe(NOW);
        for (const col of ['table_name', 'id', 'device_id'] as const) for (const w of ['Corner', 'Paycheck', 'Checking', 'Cafe']) expect(String(r[col])).not.toContain(w);
        // the payload is base64 ciphertext; neither its text nor its decoded bytes contain the plaintext
        expect(String(r.ct)).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
        const bytes = Uint8Array.from(Buffer.from(String(r.ct), 'base64'));
        for (const v of secrets) {
          expect(String(r.ct)).not.toContain(v);
          if (v.length >= 8) expect(has(bytes, v)).toBe(false); // ≥8 bytes: a chance match in ciphertext is ~2^-64
        }
      }
      // the vault metadata (key slots) holds wrapped keys only
      const meta = [...db.meta.values()].join('\n');
      for (const v of ['Corner', 'Paycheck', 'Checking', 'phone passphrase here']) expect(meta).not.toContain(v);

      const again = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'phone passphrase here' });
      expect(buildDashboard(engineInput(again.data, TODAY)).balances.availableCashCents).toBe(119350);
    } finally {
      clock.mockRestore();
    }
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
