/**
 * "Remember this device" for the web app.
 *
 * How it works:
 * - When you unlock with your passphrase (or recovery key) and choose "Remember this device",
 *   the browser creates a random AES-256-GCM key with WebCrypto, marked NON-EXTRACTABLE:
 *   its raw bytes can never be read by any script, including Clarity's own code.
 * - That device key encrypts a copy of the vault's master key. The CryptoKey object and the
 *   encrypted master key are stored in a separate IndexedDB database ("clarity-device") in this
 *   browser profile only. They are never in backups, never sent anywhere, and do not touch the
 *   encrypted financial records (no migration, no re-encryption).
 * - The expiry date and vault id are bound to the ciphertext as AES-GCM associated data, so editing
 *   the stored expiry makes decryption fail.
 * - On the next visit, if the trust has not expired and was not suspended by a lock, Clarity asks the
 *   browser to decrypt the master key with the device key and opens the vault with it.
 * - The passphrase is never stored anywhere.
 *
 * Limits (also in docs/security.md): anyone who can use this browser profile during the trust period
 * can open Clarity without the passphrase; a malicious extension or an XSS bug could ask the browser
 * to use the device key while it exists (non-extractable stops copying the key, not using it).
 */

const DB = 'clarity-device';
const STORE = 'trust';
const ID = 'device';
const VERSION = 1;

export type TrustDays = 7 | 30;
export const TRUST_CHOICES: readonly TrustDays[] = [7, 30];

interface TrustRecord {
  id: typeof ID;
  v: typeof VERSION;
  key: CryptoKey; // non-extractable AES-GCM device key
  iv: Uint8Array<ArrayBuffer>;
  ct: ArrayBuffer; // master key, encrypted with the device key
  vaultId: string;
  days: TrustDays;
  createdAt: number;
  expiresAt: number;
  /** Set by a manual or inactivity lock: the passphrase is needed before remembered access resumes. */
  suspended: boolean;
}

/** What the rest of the app may know about the trust (no key material). */
export interface TrustInfo {
  vaultId: string;
  days: TrustDays;
  createdAt: number;
  expiresAt: number;
  suspended: boolean;
}

export type TrustedUnlock =
  | { status: 'ok'; masterKey: Uint8Array; info: TrustInfo }
  | { status: 'none' | 'suspended' | 'expired' | 'invalid'; info: TrustInfo | null };

const DAY = 86_400_000;

/**
 * Locking must take effect even if the tab is closed or reloaded immediately, before the IndexedDB
 * write finishes. So a lock also sets this flag synchronously. It is not secret (just "locked: yes").
 */
const LOCK_FLAG = 'clarity-device-locked';
function setLockFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(LOCK_FLAG, '1');
    else localStorage.removeItem(LOCK_FLAG);
  } catch {
    /* storage blocked: the IndexedDB suspension below still applies */
  }
}
function lockFlag(): boolean {
  try {
    return localStorage.getItem(LOCK_FLAG) === '1';
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

const aad = (vaultId: string, expiresAt: number) => new TextEncoder().encode(`clarity-device-v${VERSION}|${vaultId}|${expiresAt}`);
const info = (r: TrustRecord): TrustInfo => ({ vaultId: r.vaultId, days: r.days, createdAt: r.createdAt, expiresAt: r.expiresAt, suspended: r.suspended });

async function read(): Promise<TrustRecord | null> {
  try {
    const r = (await tx<TrustRecord>('readonly', (s) => s.get(ID))) ?? null;
    return r && r.v === VERSION ? r : null;
  } catch {
    return null;
  }
}

/** Remember this device for `days`. Replaces any previous trust. `masterKey` is not kept. */
export async function rememberDevice(masterKey: Uint8Array, vaultId: string, days: TrustDays, now = Date.now()): Promise<TrustInfo> {
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const expiresAt = now + days * DAY;
  const plain = new Uint8Array(masterKey); // own copy, zeroed below
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(vaultId, expiresAt) }, key, plain);
  plain.fill(0);
  const rec: TrustRecord = { id: ID, v: VERSION, key, iv, ct, vaultId, days, createdAt: now, expiresAt, suspended: false };
  await tx('readwrite', (s) => s.put(rec));
  setLockFlag(false);
  return info(rec);
}

/** Try to open the vault without the passphrase. Expired or broken trust is deleted. */
export async function unlockWithDevice(vaultId: string, now = Date.now()): Promise<TrustedUnlock> {
  const r = await read();
  if (!r) return { status: 'none', info: null };
  if (r.vaultId !== vaultId) {
    await forgetDevice();
    return { status: 'invalid', info: null };
  }
  if (now >= r.expiresAt) {
    await forgetDevice();
    return { status: 'expired', info: info(r) };
  }
  if (r.suspended || lockFlag()) {
    if (!r.suspended) await tx('readwrite', (s) => s.put({ ...r, suspended: true }));
    return { status: 'suspended', info: { ...info(r), suspended: true } };
  }
  try {
    const mk = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv, additionalData: aad(r.vaultId, r.expiresAt) }, r.key, r.ct));
    return { status: 'ok', masterKey: mk, info: info(r) };
  } catch {
    await forgetDevice();
    return { status: 'invalid', info: null };
  }
}

/** A lock (manual or after inactivity) pauses remembered access until the next passphrase unlock. */
export async function suspendTrust(): Promise<void> {
  setLockFlag(true); // synchronous, before anything else can happen
  const r = await read();
  if (r && !r.suspended) await tx('readwrite', (s) => s.put({ ...r, suspended: true }));
}

/** Forget this device: deletes the device key and the wrapped master key. */
export async function forgetDevice(): Promise<void> {
  setLockFlag(false);
  try {
    await tx('readwrite', (s) => s.delete(ID));
  } catch {
    /* nothing stored */
  }
}

export async function trustInfo(): Promise<TrustInfo | null> {
  const r = await read();
  return r ? info(r) : null;
}
