/**
 * The cryptographic primitives the format needs. Each platform supplies an implementation:
 *  - web:    WebCrypto (AES-GCM, HKDF, SHA-256) + hash-wasm (Argon2id)
 *  - mobile: @noble/ciphers + @noble/hashes, with expo-crypto for random bytes
 * Both must produce byte-identical results; packages/security/test verifies this.
 */
export type KdfParams =
  | { id: 'argon2id'; m: number; t: number; p: number; v: 19 }
  | { id: 'pbkdf2-sha256'; c: number }
  | { id: 'hkdf-sha256'; info: string };

export interface CryptoProvider {
  readonly name: string;
  randomBytes(n: number): Uint8Array;
  /** AES-256-GCM. Output = ciphertext || 16-byte tag. Throws on authentication failure. */
  aesGcmEncrypt(key: Uint8Array, iv: Uint8Array, plaintext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  aesGcmDecrypt(key: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array, aad: Uint8Array): Promise<Uint8Array>;
  /** Derive 32 bytes. For hkdf-sha256 `secret` is the input key material. */
  deriveKey(params: KdfParams, secret: Uint8Array, salt: Uint8Array): Promise<Uint8Array>;
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

/** Default passphrase KDF for new key slots. OWASP-listed Argon2id configuration (19 MiB, 2 passes). */
export const DEFAULT_PASSPHRASE_KDF: KdfParams = { id: 'argon2id', m: 19456, t: 2, p: 1, v: 19 };
export const RECOVERY_KDF: KdfParams = { id: 'hkdf-sha256', info: 'clarity/recovery-kek/v1' };

export class DecryptionError extends Error {
  constructor(message = 'Decryption failed') {
    super(message);
    this.name = 'DecryptionError';
  }
}

export function assertKdfParams(p: KdfParams): void {
  if (p.id === 'argon2id') {
    if (p.m < 19456 || p.t < 2 || p.p < 1 || p.v !== 19) throw new Error('Argon2id parameters below the minimum');
  } else if (p.id === 'pbkdf2-sha256') {
    if (p.c < 600000) throw new Error('PBKDF2 iterations below the minimum');
  }
}
