// KDF benchmark: pure-JS (@noble/hashes, as used on mobile) vs WASM (hash-wasm, web).
// Run: node scripts/kdf-benchmark.mjs
import { argon2id } from '@noble/hashes/argon2.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';

const pw = new TextEncoder().encode('correct horse battery staple');
const salt = new Uint8Array(16).fill(7);
const time = async (label, fn) => { const t = performance.now(); await fn(); console.log(label.padEnd(48), `${Math.round(performance.now() - t)} ms`); };

await time('noble argon2id m=19MiB t=2 p=1', () => argon2id(pw, salt, { m: 19456, t: 2, p: 1, dkLen: 32 }));
await time('noble argon2id m=64MiB t=3 p=1', () => argon2id(pw, salt, { m: 65536, t: 3, p: 1, dkLen: 32 }));
await time('noble scrypt N=2^17 r=8 p=1', () => scrypt(pw, salt, { N: 2 ** 17, r: 8, p: 1, dkLen: 32 }));
await time('noble pbkdf2-sha256 600k', () => pbkdf2(sha256, pw, salt, { c: 600000, dkLen: 32 }));
try {
  const hw = await import('hash-wasm');
  await time('hash-wasm argon2id m=19MiB t=2 p=1', () => hw.argon2id({ password: pw, salt, parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32, outputType: 'binary' }));
  await time('hash-wasm argon2id m=64MiB t=3 p=1', () => hw.argon2id({ password: pw, salt, parallelism: 1, iterations: 3, memorySize: 65536, hashLength: 32, outputType: 'binary' }));
} catch (e) { console.log('hash-wasm not installed:', e.message); }
