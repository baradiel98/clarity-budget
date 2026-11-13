import type { EncryptedRow, VaultMeta } from '@clarity/security';

/**
 * Persistence for one workspace. Implemented per platform:
 *  - web:    IndexedDB (Dexie)
 *  - mobile: expo-sqlite
 *  - tests / demo mode: MemoryAdapter
 * Only encrypted rows and the vault metadata (wrapped keys) are ever stored.
 */
export interface StorageAdapter {
  loadVaultMeta(): Promise<VaultMeta | null>;
  saveVaultMeta(meta: VaultMeta): Promise<void>;
  loadRows(): Promise<EncryptedRow[]>;
  /** Must be atomic: either every row is written or none is. */
  writeRows(rows: EncryptedRow[]): Promise<void>;
  /** Atomically replace vault metadata and all rows (backup restore). */
  replaceAll(meta: VaultMeta, rows: EncryptedRow[]): Promise<void>;
  /** Crypto-shred (destroy key slots first) and then delete all data. */
  wipe(): Promise<void>;
  getDeviceId(): Promise<string>;
}

export class MemoryAdapter implements StorageAdapter {
  meta: VaultMeta | null = null;
  rows = new Map<string, EncryptedRow>();
  failNextWrite = false;
  constructor(private deviceId = 'memory') {}
  async loadVaultMeta() {
    return this.meta ? structuredCloneJSON(this.meta) : null;
  }
  async saveVaultMeta(meta: VaultMeta) {
    this.meta = structuredCloneJSON(meta);
  }
  async loadRows() {
    return [...this.rows.values()].map(structuredCloneJSON);
  }
  async writeRows(rows: EncryptedRow[]) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Simulated write failure');
    }
    for (const r of rows) this.rows.set(`${r.table}/${r.id}`, structuredCloneJSON(r));
  }
  async replaceAll(meta: VaultMeta, rows: EncryptedRow[]) {
    this.meta = structuredCloneJSON(meta);
    this.rows = new Map(rows.map((r) => [`${r.table}/${r.id}`, structuredCloneJSON(r)]));
  }
  async wipe() {
    this.meta = null;
    this.rows.clear();
  }
  async getDeviceId() {
    return this.deviceId;
  }
}

function structuredCloneJSON<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
