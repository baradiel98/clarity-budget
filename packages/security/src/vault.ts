import { fromBase64, fromCrockford, toBase64, toCrockford, utf8Encode } from './encoding';
import { DEFAULT_PASSPHRASE_KDF, DecryptionError, RECOVERY_KDF, type CryptoProvider, type KdfParams } from './provider';

/**
 * Envelope encryption ("key slots").
 *
 *   master key (MK, 32 random bytes) ── encrypts every record (AES-256-GCM)
 *   passphrase ─Argon2id─► KEK₁ ── wraps MK  (slot type "passphrase")
 *   recovery key ─HKDF───► KEK₂ ── wraps MK  (slot type "recovery", optional)
 *
 * Changing the passphrase only re-wraps MK; records are never re-encrypted.
 * See docs/security.md.
 */

export const VAULT_FORMAT = 'clarity-vault';
export const VAULT_VERSION = 1;
export const MASTER_KEY_BYTES = 32;
export const RECOVERY_KEY_BYTES = 20; // 160 bits

export type SlotType = 'passphrase' | 'recovery';

export interface KeySlot {
  id: string;
  type: SlotType;
  kdf: KdfParams;
  salt: string; // base64, 16 bytes
  iv: string; // base64, 12 bytes
  wrappedKey: string; // base64, AES-GCM(KEK, MK)
  createdAt: number;
}

export interface VaultMeta {
  format: typeof VAULT_FORMAT;
  version: number;
  vaultId: string;
  /** Records are encrypted with the master key of this version. Reserved for future key rotation. */
  keyVersion: number;
  slots: KeySlot[];
  createdAt: number;
  updatedAt: number;
}

const slotAad = (vaultId: string, slot: Pick<KeySlot, 'id' | 'type'>) =>
  utf8Encode(`clarity-slot|v1|${vaultId}|${slot.id}|${slot.type}`);

function randomId(p: CryptoProvider, prefix: string): string {
  return `${prefix}_${toCrockford(p.randomBytes(10)).toLowerCase()}`;
}

async function wrap(p: CryptoProvider, vaultId: string, type: SlotType, kdf: KdfParams, secret: Uint8Array, mk: Uint8Array, now: number): Promise<KeySlot> {
  const salt = p.randomBytes(16);
  const iv = p.randomBytes(12);
  const kek = await p.deriveKey(kdf, secret, salt);
  const id = randomId(p, 'slot');
  const wrapped = await p.aesGcmEncrypt(kek, iv, mk, slotAad(vaultId, { id, type }));
  kek.fill(0);
  return { id, type, kdf, salt: toBase64(salt), iv: toBase64(iv), wrappedKey: toBase64(wrapped), createdAt: now };
}

async function unwrap(p: CryptoProvider, vaultId: string, slot: KeySlot, secret: Uint8Array): Promise<Uint8Array> {
  const kek = await p.deriveKey(slot.kdf, secret, fromBase64(slot.salt));
  try {
    const mk = await p.aesGcmDecrypt(kek, fromBase64(slot.iv), fromBase64(slot.wrappedKey), slotAad(vaultId, slot));
    if (mk.length !== MASTER_KEY_BYTES) throw new DecryptionError();
    return mk;
  } finally {
    kek.fill(0);
  }
}

/** Normalize passphrases so the same text typed on any keyboard derives the same key. */
export const passphraseBytes = (pass: string): Uint8Array => utf8Encode(pass.normalize('NFKC'));

/** "ABCD-EFGH-..." (8 groups of 4). */
export function formatRecoveryKey(bytes: Uint8Array): string {
  return toCrockford(bytes).match(/.{1,4}/g)!.join('-');
}

export function parseRecoveryKey(text: string): Uint8Array {
  return fromCrockford(text, RECOVERY_KEY_BYTES);
}

export interface CreatedVault {
  meta: VaultMeta;
  masterKey: Uint8Array;
  /** Shown to the user once, if requested. Never stored. */
  recoveryKey: string | null;
}

export async function createVault(
  p: CryptoProvider,
  passphrase: string,
  opts: { withRecoveryKey: boolean; now: number; kdf?: KdfParams },
): Promise<CreatedVault> {
  const mk = p.randomBytes(MASTER_KEY_BYTES);
  const vaultId = randomId(p, 'vault');
  const slots: KeySlot[] = [await wrap(p, vaultId, 'passphrase', opts.kdf ?? DEFAULT_PASSPHRASE_KDF, passphraseBytes(passphrase), mk, opts.now)];
  let recoveryKey: string | null = null;
  if (opts.withRecoveryKey) {
    const rk = p.randomBytes(RECOVERY_KEY_BYTES);
    slots.push(await wrap(p, vaultId, 'recovery', RECOVERY_KDF, rk, mk, opts.now));
    recoveryKey = formatRecoveryKey(rk);
    rk.fill(0);
  }
  return {
    meta: { format: VAULT_FORMAT, version: VAULT_VERSION, vaultId, keyVersion: 1, slots, createdAt: opts.now, updatedAt: opts.now },
    masterKey: mk,
    recoveryKey,
  };
}

export class WrongSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrongSecretError';
  }
}

export async function unlockWithPassphrase(p: CryptoProvider, meta: VaultMeta, passphrase: string): Promise<Uint8Array> {
  const slot = meta.slots.find((s) => s.type === 'passphrase');
  if (!slot) throw new Error('This vault has no passphrase slot');
  try {
    return await unwrap(p, meta.vaultId, slot, passphraseBytes(passphrase));
  } catch (e) {
    if (e instanceof DecryptionError) throw new WrongSecretError('That passphrase is not correct.');
    throw e;
  }
}

export async function unlockWithRecoveryKey(p: CryptoProvider, meta: VaultMeta, recoveryKey: string): Promise<Uint8Array> {
  const slot = meta.slots.find((s) => s.type === 'recovery');
  if (!slot) throw new WrongSecretError('No recovery key was set up for this data.');
  let bytes: Uint8Array;
  try {
    bytes = parseRecoveryKey(recoveryKey);
  } catch (e) {
    throw new WrongSecretError((e as Error).message);
  }
  try {
    return await unwrap(p, meta.vaultId, slot, bytes);
  } catch (e) {
    if (e instanceof DecryptionError) throw new WrongSecretError('That recovery key does not match.');
    throw e;
  } finally {
    bytes.fill(0);
  }
}

/** Replace the passphrase slot. Requires the unlocked master key. Records are untouched. */
export async function changePassphrase(p: CryptoProvider, meta: VaultMeta, mk: Uint8Array, newPassphrase: string, now: number, kdf?: KdfParams): Promise<VaultMeta> {
  const slot = await wrap(p, meta.vaultId, 'passphrase', kdf ?? DEFAULT_PASSPHRASE_KDF, passphraseBytes(newPassphrase), mk, now);
  return { ...meta, slots: [slot, ...meta.slots.filter((s) => s.type !== 'passphrase')], updatedAt: now };
}

/** Create a new recovery key; the old one stops working. */
export async function regenerateRecoveryKey(p: CryptoProvider, meta: VaultMeta, mk: Uint8Array, now: number): Promise<{ meta: VaultMeta; recoveryKey: string }> {
  const rk = p.randomBytes(RECOVERY_KEY_BYTES);
  const slot = await wrap(p, meta.vaultId, 'recovery', RECOVERY_KDF, rk, mk, now);
  const recoveryKey = formatRecoveryKey(rk);
  rk.fill(0);
  return { meta: { ...meta, slots: [...meta.slots.filter((s) => s.type !== 'recovery'), slot], updatedAt: now }, recoveryKey };
}

export function removeRecoveryKey(meta: VaultMeta, now: number): VaultMeta {
  return { ...meta, slots: meta.slots.filter((s) => s.type !== 'recovery'), updatedAt: now };
}

export const hasRecoveryKey = (meta: VaultMeta): boolean => meta.slots.some((s) => s.type === 'recovery');

export function isVaultMeta(x: unknown): x is VaultMeta {
  const m = x as VaultMeta;
  return !!m && m.format === VAULT_FORMAT && typeof m.vaultId === 'string' && Array.isArray(m.slots) && typeof m.version === 'number';
}
