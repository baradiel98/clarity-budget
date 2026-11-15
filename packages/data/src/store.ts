import { TABLES, type ISODate, type TableName, type WorkspaceData } from '@clarity/shared';
import {
  changePassphrase, createVault, decryptRecord, encryptRecord, hasRecoveryKey, makeBackup, parseBackup, regenerateRecoveryKey,
  removeRecoveryKey, serializeBackup, tombstone, unlockWithPassphrase, unlockWithRecoveryKey, type BackupFile, type CryptoProvider,
  type EncryptedRow, type VaultMeta,
} from '@clarity/security';
import { makeIdFactory } from '@clarity/shared';
import type { StorageAdapter } from './adapter';
import { defaultSettings, type Ctx } from './commands';
import { migrate, SCHEMA_VERSION } from './migrations';
import { applyOps, emptyWorkspace, inverseOps, type Op } from './ops';

const META_TABLE = '_meta';
const SCHEMA_ID = 'schema';

export type Unlock = { passphrase: string } | { recoveryKey: string } | { masterKey: Uint8Array };

/**
 * Phase 4A.5.14: another tab or window changed the workspace after this copy was loaded, so this change was NOT saved
 * (it was decided against old data). The store has reloaded the latest data; the user reviews and tries again.
 */
export class StaleDataError extends Error {
  constructor() {
    super('Clarity was changed in another tab or window, so this change was not saved. The latest data is now shown; check it and try again.');
    this.name = 'StaleDataError';
  }
}

export interface UndoEntry {
  label: string;
  ops: Op[];
}

/**
 * An unlocked workspace: decrypted data in memory, encrypted rows on disk.
 * Every change is a list of ops, encrypted and written atomically, then applied in memory.
 */
export class WorkspaceStore {
  private listeners = new Set<() => void>();
  private undoStack: UndoEntry[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private locked = false;
  /** Phase 4A.5.14: the storage revision this copy of the data corresponds to (see StorageAdapter.writeRowsIfRevision). */
  private revision: string | null = null;

  private constructor(
    private adapter: StorageAdapter,
    private provider: CryptoProvider,
    private meta: VaultMeta,
    private mk: Uint8Array,
    private deviceId: string,
    private _data: WorkspaceData,
  ) {}

  // ─── lifecycle ───

  static async exists(adapter: StorageAdapter): Promise<boolean> {
    return (await adapter.loadVaultMeta()) !== null;
  }

  static async create(
    adapter: StorageAdapter,
    provider: CryptoProvider,
    passphrase: string,
    opts: { withRecoveryKey: boolean; now: number; baseCurrency?: string },
  ): Promise<{ store: WorkspaceStore; recoveryKey: string | null }> {
    if (await adapter.loadVaultMeta()) throw new Error('A workspace already exists on this device.');
    const v = await createVault(provider, passphrase, { withRecoveryKey: opts.withRecoveryKey, now: opts.now });
    const deviceId = await adapter.getDeviceId();
    const data = emptyWorkspace(defaultSettings(opts.now, opts.baseCurrency));
    const store = new WorkspaceStore(adapter, provider, v.meta, v.masterKey, deviceId, data);
    // Write meta first, then the initial settings + schema rows.
    await adapter.saveVaultMeta(v.meta);
    await adapter.writeRows([await store.encryptSchema(opts.now), await store.encrypt('settings', 'settings', data.settings, opts.now)]);
    store.revision = await adapter.loadRevision();
    return { store, recoveryKey: v.recoveryKey };
  }

  static async unlock(adapter: StorageAdapter, provider: CryptoProvider, how: Unlock): Promise<WorkspaceStore> {
    const meta = await adapter.loadVaultMeta();
    if (!meta) throw new Error('No data on this device.');
    const mk =
      'passphrase' in how
        ? await unlockWithPassphrase(provider, meta, how.passphrase)
        : 'recoveryKey' in how
          ? await unlockWithRecoveryKey(provider, meta, how.recoveryKey)
          : how.masterKey;
    const revision = await adapter.loadRevision(); // before the rows (see loadRevision)
    const rows = await adapter.loadRows();
    const data = await decryptAll(provider, mk, meta.vaultId, rows);
    const store = new WorkspaceStore(adapter, provider, meta, mk, await adapter.getDeviceId(), data);
    store.revision = revision;
    return store;
  }

  /** Restore an encrypted backup file, replacing everything on this device. */
  static async restoreBackup(
    adapter: StorageAdapter,
    provider: CryptoProvider,
    fileText: string,
    secret: { passphrase: string } | { recoveryKey: string },
  ): Promise<WorkspaceStore> {
    const backup = parseBackup(fileText);
    const mk = 'passphrase' in secret ? await unlockWithPassphrase(provider, backup.vault, secret.passphrase) : await unlockWithRecoveryKey(provider, backup.vault, secret.recoveryKey);
    // Decrypt everything first: a damaged backup must never replace good data.
    const data = await decryptAll(provider, mk, backup.vault.vaultId, backup.rows);
    await adapter.replaceAll(backup.vault, backup.rows);
    const store = new WorkspaceStore(adapter, provider, backup.vault, mk, await adapter.getDeviceId(), data);
    // a restore replaces everything: give it a new revision, so other tabs holding the old data can't write over it
    const fresh = store.newRevision();
    if (await adapter.writeRowsIfRevision([], null, fresh)) store.revision = fresh;
    if (backup.schemaVersion < SCHEMA_VERSION) await store.rewriteAll(Date.now());
    return store;
  }

  /** Inspect a backup without restoring it. */
  static inspectBackup(fileText: string): Pick<BackupFile, 'createdAt' | 'appPlatform' | 'schemaVersion'> & { rowCount: number; hasRecoveryKey: boolean } {
    const b = parseBackup(fileText);
    return { createdAt: b.createdAt, appPlatform: b.appPlatform, schemaVersion: b.schemaVersion, rowCount: b.rows.length, hasRecoveryKey: hasRecoveryKey(b.vault) };
  }

  lock(): void {
    this.mk.fill(0);
    this.locked = true;
    this._data = emptyWorkspace(this._data.settings);
    this.undoStack = [];
    this.emit();
  }

  /** The id of the encrypted vault on this device (not secret). */
  get vaultId(): string {
    return this.meta.vaultId;
  }

  /**
   * A copy of the master key, for a platform to protect with a device-bound key
   * ("remember this device" on the web, Keychain/Keystore on mobile). The caller must zero it after use.
   * The master key is already in memory while unlocked; this does not create new key material.
   */
  copyMasterKey(): Uint8Array {
    this.assertUnlocked();
    return this.mk.slice();
  }

  get isLocked(): boolean {
    return this.locked;
  }

  // ─── reading ───

  get data(): WorkspaceData {
    return this._data;
  }

  get vaultMeta(): VaultMeta {
    return this.meta;
  }

  /** The raw master key (mobile stores a copy in the Keychain/Keystore for biometric unlock). */
  exportMasterKey(): Uint8Array {
    this.assertUnlocked();
    return Uint8Array.from(this.mk);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  ctx(now: number, today: ISODate): Ctx {
    return { data: this._data, now, today, newId: makeIdFactory((n) => this.provider.randomBytes(n)) };
  }

  // ─── writing ───

  /** Encrypt and persist ops atomically, then update memory. Serialized so writes never interleave. */
  apply(ops: Op[], opts: { undoLabel?: string; now?: number } = {}): Promise<void> {
    const run = async () => {
      this.assertUnlocked();
      if (ops.length === 0) return;
      const now = opts.now ?? Date.now();
      const before = this._data;
      const after = applyOps(before, ops);
      const rows: EncryptedRow[] = [];
      const seen = new Set<string>();
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i]!;
        const id = op.t === 'put' ? op.value.id : op.id;
        const key = `${op.table}/${id}`;
        if (seen.has(key)) continue; // last op for a row wins
        seen.add(key);
        rows.push(op.t === 'put' ? await this.encrypt(op.table, id, op.value, now) : tombstone(op.table, id, this.meta.keyVersion, now, this.deviceId));
      }
      // Phase 4A.5.14: only if no other tab/window has written since this copy was loaded; otherwise nothing is
      // written, the latest data is loaded, and the caller is told (the change was decided against old data)
      const next = this.newRevision();
      if (!(await this.adapter.writeRowsIfRevision(rows, this.revision, next))) { // throws → memory unchanged
        await this.reloadNow();
        throw new StaleDataError();
      }
      this.revision = next;
      this._data = after;
      if (opts.undoLabel) {
        this.undoStack.push({ label: opts.undoLabel, ops: inverseOps(before, ops) });
        if (this.undoStack.length > 20) this.undoStack.shift();
      }
      this.emit();
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  get canUndo(): UndoEntry | null {
    return this.undoStack[this.undoStack.length - 1] ?? null;
  }

  async undo(): Promise<string | null> {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    await this.apply(entry.ops);
    return entry.label;
  }

  // ─── keys ───

  async changePassphrase(current: string, next: string, now = Date.now()): Promise<void> {
    this.assertUnlocked();
    await unlockWithPassphrase(this.provider, this.meta, current); // re-verify
    const meta = await changePassphrase(this.provider, this.meta, this.mk, next, now);
    await this.adapter.saveVaultMeta(meta);
    this.meta = meta;
  }

  async verifyPassphrase(pass: string): Promise<boolean> {
    try {
      await unlockWithPassphrase(this.provider, this.meta, pass);
      return true;
    } catch {
      return false;
    }
  }

  async regenerateRecoveryKey(now = Date.now()): Promise<string> {
    this.assertUnlocked();
    const r = await regenerateRecoveryKey(this.provider, this.meta, this.mk, now);
    await this.adapter.saveVaultMeta(r.meta);
    this.meta = r.meta;
    return r.recoveryKey;
  }

  async removeRecoveryKey(now = Date.now()): Promise<void> {
    const meta = removeRecoveryKey(this.meta, now);
    await this.adapter.saveVaultMeta(meta);
    this.meta = meta;
  }

  get hasRecoveryKey(): boolean {
    return hasRecoveryKey(this.meta);
  }

  // ─── backup ───

  async exportBackup(platform: BackupFile['appPlatform'], now = Date.now()): Promise<string> {
    this.assertUnlocked();
    const rows = await this.adapter.loadRows();
    const text = serializeBackup(makeBackup(this.meta, rows, SCHEMA_VERSION, now, platform));
    await this.apply([{ t: 'put', table: 'settings', value: { ...this._data.settings, lastBackupAt: now, txSinceBackup: 0, updatedAt: now } }], { now });
    return text;
  }

  async wipe(): Promise<void> {
    await this.adapter.wipe();
    this.lock();
  }

  /** Phase 4A.5.14: load the latest data from storage (e.g. after another tab changed it). Clears the undo history. */
  reload(): Promise<void> {
    const p = this.queue.then(() => this.reloadNow(), () => this.reloadNow());
    this.queue = p.catch(() => undefined);
    return p;
  }

  // ─── internals ───

  private async reloadNow() {
    this.assertUnlocked();
    const revision = await this.adapter.loadRevision(); // before the rows (see loadRevision)
    const rows = await this.adapter.loadRows();
    this._data = await decryptAll(this.provider, this.mk, this.meta.vaultId, rows);
    this.revision = revision;
    this.undoStack = [];
    this.emit();
  }

  private newRevision(): string {
    return Array.from(this.provider.randomBytes(12), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  private assertUnlocked() {
    if (this.locked) throw new Error('Locked');
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  private encrypt(table: TableName | typeof META_TABLE, id: string, value: unknown, now: number) {
    return encryptRecord(this.provider, this.mk, this.meta.vaultId, { table, id, value, keyVersion: this.meta.keyVersion, updatedAt: now, deviceId: this.deviceId });
  }

  private encryptSchema(now: number) {
    return this.encrypt(META_TABLE, SCHEMA_ID, { schemaVersion: SCHEMA_VERSION }, now);
  }

  /** Re-encrypt the whole (migrated) workspace, e.g. after a schema upgrade. */
  private async rewriteAll(now: number) {
    const rows: EncryptedRow[] = [await this.encryptSchema(now)];
    for (const t of TABLES) {
      const list = t === 'settings' ? [this._data.settings] : (this._data[t] as { id: string }[]);
      for (const v of list) rows.push(await this.encrypt(t, v.id, v, now));
    }
    await this.adapter.writeRows(rows);
  }
}

async function decryptAll(p: CryptoProvider, mk: Uint8Array, vaultId: string, rows: EncryptedRow[]): Promise<WorkspaceData> {
  const raw: Record<string, unknown[]> = {};
  let settings: unknown = null;
  let schemaVersion = 0;
  for (const r of rows) {
    if (r.deleted) continue;
    const v = await decryptRecord(p, mk, vaultId, r);
    if (r.table === META_TABLE) {
      if (r.id === SCHEMA_ID) schemaVersion = (v as { schemaVersion: number }).schemaVersion;
      continue;
    }
    if (r.table === 'settings') settings = v;
    else (raw[r.table] ??= []).push(v);
  }
  const byCreated = (a: unknown, b: unknown) => {
    const x = a as { createdAt?: number; id: string };
    const y = b as { createdAt?: number; id: string };
    return (x.createdAt ?? 0) - (y.createdAt ?? 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  };
  const shaped = {
    ...Object.fromEntries(TABLES.filter((t) => t !== 'settings').map((t) => [t, (raw[t] ?? []).sort(byCreated)])),
    settings: settings ?? defaultSettings(Date.now()),
  };
  return migrate(shaped, schemaVersion);
}
