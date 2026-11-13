import { gcm } from '@noble/ciphers/aes.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
const hex = (u) => Buffer.from(u).toString('hex');
const enc = (s) => new TextEncoder().encode(s);
const key = Uint8Array.from({ length: 32 }, (_, i) => i);
const iv = Uint8Array.from({ length: 12 }, (_, i) => 100 + i);
const salt = Uint8Array.from({ length: 16 }, (_, i) => 200 + i);
console.log(JSON.stringify({
  aes: hex(gcm(key, iv, enc('aad')).encrypt(enc('{"amountCents":-1234,"merchant":"Café"}'))),
  argon: hex(argon2id(enc('correct horse battery staple'), salt, { m: 19456, t: 2, p: 1, dkLen: 32 })),
  hkdf: hex(hkdf(sha256, key.slice(0, 20), salt, enc('clarity/recovery-kek/v1'), 32)),
  sha: hex(sha256(enc('clarity'))),
}, null, 2));
