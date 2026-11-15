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
  /**
   * Phase 4A.5.14: the workspace revision: an opaque value replaced on every guarded write (null if none yet).
   * Read it BEFORE the rows, so a write by another tab in between makes this copy's revision stale (never the reverse).
   */
  loadRevision(): Promise<string | null>;
  /**
   * Phase 4A.5.14: optimistic concurrency between tabs/windows sharing the same storage. In ONE atomic storage
   * transaction: if the stored revision is still `expected`, write every row and store `next`, and return true;
   * otherwise write nothing and return false (another tab changed the workspace since this copy was loaded).
   */
  writeRowsIfRevision(rows: EncryptedRow[], expected: string | null, next: string): Promise<boolean>;
  /** Atomically replace vault metadata and all rows (backup restore). */
  replaceAll(meta: VaultMeta, rows: EncryptedRow[]): Promise<void>;
  /** Crypto-shred (destroy key slots first) and then delete all data. */
  wipe(): Promise<void>;
  getDeviceId(): Promise<string>;
}

export class MemoryAdapter implements StorageAdapter {
  meta: VaultMeta | null = null;
  rows = new Map<string, EncryptedRow>();
  revision: string | null = null;
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
  async loadRevision() {
    return this.revision;
  }
  async writeRowsIfRevision(rows: EncryptedRow[], expected: string | null, next: string) {
    if (this.revision !== expected) return false;
    await this.writeRows(rows);
    this.revision = next;
    return true;
  }
  async replaceAll(meta: VaultMeta, rows: EncryptedRow[]) {
    this.revision = null;
    this.meta = structuredCloneJSON(meta);
    this.rows = new Map(rows.map((r) => [`${r.table}/${r.id}`, structuredCloneJSON(r)]));
  }
  async wipe() {
    this.meta = null;
    this.revision = null;
    this.rows.clear();
  }
  async getDeviceId() {
    return this.deviceId;
  }
}

function structuredCloneJSON<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
