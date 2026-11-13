import Dexie, { type Table } from 'dexie';
import type { StorageAdapter } from '@clarity/data';
import type { EncryptedRow, VaultMeta } from '@clarity/security';
import { toBase64 } from '@clarity/security';

interface MetaRow {
  key: string;
  value: unknown;
}

class ClarityDB extends Dexie {
  meta!: Table<MetaRow, string>;
  rows!: Table<EncryptedRow, [string, string]>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      meta: 'key',
      // Only table/id are indexed. No financial value is ever stored in plaintext.
      rows: '[table+id]',
    });
  }
}

export const DB_NAME = 'clarity';

/** IndexedDB storage. Every write is one Dexie transaction, so it is atomic. */
export class DexieAdapter implements StorageAdapter {
  private db: ClarityDB;
  constructor(private name = DB_NAME) {
    this.db = new ClarityDB(name);
  }

  async loadVaultMeta(): Promise<VaultMeta | null> {
    const r = await this.db.meta.get('vault');
    return (r?.value as VaultMeta | undefined) ?? null;
  }

  async saveVaultMeta(meta: VaultMeta): Promise<void> {
    await this.db.meta.put({ key: 'vault', value: meta });
  }

  async loadRows(): Promise<EncryptedRow[]> {
    return this.db.rows.toArray();
  }

  async writeRows(rows: EncryptedRow[]): Promise<void> {
    await this.db.transaction('rw', this.db.rows, async () => {
      await this.db.rows.bulkPut(rows);
    });
  }

  async replaceAll(meta: VaultMeta, rows: EncryptedRow[]): Promise<void> {
    await this.db.transaction('rw', this.db.rows, this.db.meta, async () => {
      await this.db.rows.clear();
      await this.db.rows.bulkPut(rows);
      await this.db.meta.put({ key: 'vault', value: meta });
    });
  }

  /** Crypto-shred: overwrite the wrapped keys with random bytes, then delete the database. */
  async wipe(): Promise<void> {
    const meta = await this.loadVaultMeta();
    if (meta) {
      const junk = toBase64(crypto.getRandomValues(new Uint8Array(48)));
      await this.db.meta.put({ key: 'vault', value: { ...meta, slots: meta.slots.map((s) => ({ ...s, wrappedKey: junk, salt: junk, iv: junk })) } });
      await this.db.meta.delete('vault');
    }
    this.db.close();
    await Dexie.delete(this.name);
    this.db = new ClarityDB(this.name);
  }

  async getDeviceId(): Promise<string> {
    const r = await this.db.meta.get('device');
    if (r) return r.value as string;
    const id = `web_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    await this.db.meta.put({ key: 'device', value: id });
    return id;
  }
}
