import * as SQLite from 'expo-sqlite';
import type { StorageAdapter } from '@clarity/data';
import { toBase64, type EncryptedRow, type VaultMeta } from '@clarity/security';
import * as ExpoCrypto from 'expo-crypto';

export const DB_NAME = 'clarity.db';

interface RowRecord {
  table_name: string;
  id: string;
  key_version: number;
  iv: string;
  ct: string;
  updated_at: number;
  device_id: string;
  deleted: number;
}

/**
 * SQLite storage. Only table/id and ciphertext are stored — never plaintext financial values.
 * Writes run in an exclusive transaction, so they are atomic.
 */
export class SQLiteAdapter implements StorageAdapter {
  private db: SQLite.SQLiteDatabase | null = null;
  constructor(private name = DB_NAME) {}

  private async open(): Promise<SQLite.SQLiteDatabase> {
    if (this.db) return this.db;
    const db = await SQLite.openDatabaseAsync(this.name);
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rows (
        table_name TEXT NOT NULL, id TEXT NOT NULL, key_version INTEGER NOT NULL, iv TEXT NOT NULL, ct TEXT NOT NULL,
        updated_at INTEGER NOT NULL, device_id TEXT NOT NULL, deleted INTEGER NOT NULL, PRIMARY KEY (table_name, id)
      );
    `);
    this.db = db;
    return db;
  }

  async loadVaultMeta(): Promise<VaultMeta | null> {
    const db = await this.open();
    const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'vault');
    return r ? (JSON.parse(r.value) as VaultMeta) : null;
  }

  async saveVaultMeta(meta: VaultMeta): Promise<void> {
    const db = await this.open();
    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'vault', JSON.stringify(meta));
  }

  async loadRows(): Promise<EncryptedRow[]> {
    const db = await this.open();
    const rows = await db.getAllAsync<RowRecord>('SELECT * FROM rows');
    return rows.map((r) => ({ table: r.table_name, id: r.id, keyVersion: r.key_version, iv: r.iv, ct: r.ct, updatedAt: r.updated_at, deviceId: r.device_id, deleted: r.deleted === 1 }));
  }

  async writeRows(rows: EncryptedRow[]): Promise<void> {
    const db = await this.open();
    await db.withExclusiveTransactionAsync(async (txn) => {
      for (const r of rows) {
        await txn.runAsync(
          'INSERT OR REPLACE INTO rows (table_name, id, key_version, iv, ct, updated_at, device_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          r.table, r.id, r.keyVersion, r.iv, r.ct, r.updatedAt, r.deviceId, r.deleted ? 1 : 0,
        );
      }
    });
  }

  async replaceAll(meta: VaultMeta, rows: EncryptedRow[]): Promise<void> {
    const db = await this.open();
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync('DELETE FROM rows');
      for (const r of rows) {
        await txn.runAsync(
          'INSERT INTO rows (table_name, id, key_version, iv, ct, updated_at, device_id, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          r.table, r.id, r.keyVersion, r.iv, r.ct, r.updatedAt, r.deviceId, r.deleted ? 1 : 0,
        );
      }
      await txn.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'vault', JSON.stringify(meta));
    });
  }

  /** Crypto-shred: overwrite wrapped keys with random bytes, then delete the database file. */
  async wipe(): Promise<void> {
    const db = await this.open();
    const meta = await this.loadVaultMeta();
    if (meta) {
      const junk = toBase64(ExpoCrypto.getRandomBytes(48));
      await this.saveVaultMeta({ ...meta, slots: meta.slots.map((s) => ({ ...s, wrappedKey: junk, salt: junk, iv: junk })) });
    }
    await db.execAsync('DELETE FROM meta; DELETE FROM rows;');
    await db.closeAsync();
    this.db = null;
    await SQLite.deleteDatabaseAsync(this.name);
  }

  async getDeviceId(): Promise<string> {
    const db = await this.open();
    const r = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'device');
    if (r) return r.value;
    const id = `app_${Array.from(ExpoCrypto.getRandomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'device', id);
    return id;
  }
}
