import { argon2id } from 'hash-wasm';
import { utf8Encode } from '../encoding';
import { DecryptionError, assertKdfParams, type CryptoProvider, type KdfParams } from '../provider';

type Subtle = SubtleCrypto;

/** Copy into a fresh ArrayBuffer-backed view (WebCrypto rejects some shared/offset views). */
const buf = (u: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(u.length));
  out.set(u);
  return out;
};

/** Browser provider: WebCrypto for AES-GCM / HKDF / PBKDF2 / SHA-256, hash-wasm for Argon2id. */
export function createWebCryptoProvider(crypto: Crypto = globalThis.crypto): CryptoProvider {
  const subtle: Subtle = crypto.subtle;
  const importAes = (key: Uint8Array, usage: KeyUsage) => subtle.importKey('raw', buf(key), { name: 'AES-GCM' }, false, [usage]);
  return {
    name: 'webcrypto',
    randomBytes(n) {
      const out = new Uint8Array(n);
      crypto.getRandomValues(out);
      return out;
    },
    async aesGcmEncrypt(key, iv, plaintext, aad) {
      const k = await importAes(key, 'encrypt');
      return new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad), tagLength: 128 }, k, buf(plaintext)));
    },
    async aesGcmDecrypt(key, iv, ciphertext, aad) {
      const k = await importAes(key, 'decrypt');
      try {
        return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad), tagLength: 128 }, k, buf(ciphertext)));
      } catch {
        throw new DecryptionError();
      }
    },
    async deriveKey(params: KdfParams, secret, salt) {
      assertKdfParams(params);
      switch (params.id) {
        case 'argon2id':
          return argon2id({ password: secret, salt, parallelism: params.p, iterations: params.t, memorySize: params.m, hashLength: 32, outputType: 'binary' });
        case 'pbkdf2-sha256': {
          const k = await subtle.importKey('raw', buf(secret), 'PBKDF2', false, ['deriveBits']);
          return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations: params.c }, k, 256));
        }
        case 'hkdf-sha256': {
          const k = await subtle.importKey('raw', buf(secret), 'HKDF', false, ['deriveBits']);
          return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(utf8Encode(params.info)) }, k, 256));
        }
      }
    },
    async sha256(data) {
      return new Uint8Array(await subtle.digest('SHA-256', buf(data)));
    },
  };
}
