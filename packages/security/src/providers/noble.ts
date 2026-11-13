import { gcm } from '@noble/ciphers/aes.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8Encode } from '../encoding';
import { DecryptionError, assertKdfParams, type CryptoProvider, type KdfParams } from '../provider';

/**
 * Pure-JavaScript provider (audited @noble libraries). Used by the mobile app and in tests.
 * `randomBytes` must be a CSPRNG supplied by the platform (expo-crypto on mobile).
 */
export function createNobleProvider(randomBytes: (n: number) => Uint8Array): CryptoProvider {
  return {
    name: 'noble',
    randomBytes,
    async aesGcmEncrypt(key, iv, plaintext, aad) {
      return gcm(key, iv, aad).encrypt(plaintext);
    },
    async aesGcmDecrypt(key, iv, ciphertext, aad) {
      try {
        return gcm(key, iv, aad).decrypt(ciphertext);
      } catch {
        throw new DecryptionError();
      }
    },
    async deriveKey(params: KdfParams, secret, salt) {
      assertKdfParams(params);
      switch (params.id) {
        case 'argon2id':
          return argon2idAsync(secret, salt, { m: params.m, t: params.t, p: params.p, version: params.v, dkLen: 32, asyncTick: 20 });
        case 'pbkdf2-sha256':
          return pbkdf2Async(sha256, secret, salt, { c: params.c, dkLen: 32 });
        case 'hkdf-sha256':
          return hkdf(sha256, secret, salt, utf8Encode(params.info), 32);
      }
    },
    async sha256(data) {
      return sha256(data);
    },
  };
}
