import { fromHex, toHex, utf8Encode } from './encoding';
import type { CryptoProvider } from './provider';

/**
 * Known-answer test vectors. Expected values were produced by @noble and are independently
 * reproduced by WebCrypto + hash-wasm in packages/security/test. The apps run these on-device
 * (self-test screen) to prove each platform's provider is interoperable.
 */
const KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
const IV = Uint8Array.from({ length: 12 }, (_, i) => 100 + i);
const SALT = Uint8Array.from({ length: 16 }, (_, i) => 200 + i);
const PLAINTEXT = '{"amountCents":-1234,"merchant":"Café"}';

export const VECTORS = {
  aesGcm: '3339bf0b169c38ea7d07319ca94750d073f0353ea74e9e17d5b2c42995d78772b6aa21a68fbbb9794bf7c9b4645fb0ccd31d783130d2b8cf',
  argon2id: '598535d973fbd2ee1dd75a13f4801a743d575c5a0899fa7c5c1bf8e1c6afe584',
  hkdf: '491c01bcea52378c9c93838eb11bb981d0d3d0a254c0e5d6390a84f418ff86a2',
  sha256: '261b152862d1d614014496a635018719d34bb3965c5bd7a9f7bbebc7cd8b8696',
} as const;

export interface SelfTestResult {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
}

export async function runCryptoSelfTest(p: CryptoProvider, now: () => number = () => Date.now()): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = [];
  const run = async (name: string, expected: string, fn: () => Promise<Uint8Array>) => {
    const t = now();
    try {
      const got = toHex(await fn());
      results.push({ name, ok: got === expected, ms: now() - t, ...(got === expected ? {} : { detail: `got ${got.slice(0, 16)}…` }) });
    } catch (e) {
      results.push({ name, ok: false, ms: now() - t, detail: (e as Error).message });
    }
  };
  await run('AES-256-GCM encrypt', VECTORS.aesGcm, () => p.aesGcmEncrypt(KEY, IV, utf8Encode(PLAINTEXT), utf8Encode('aad')));
  await run('AES-256-GCM decrypt', toHex(utf8Encode(PLAINTEXT)), () => p.aesGcmDecrypt(KEY, IV, fromHex(VECTORS.aesGcm), utf8Encode('aad')));
  await run('SHA-256', VECTORS.sha256, () => p.sha256(utf8Encode('clarity')));
  await run('HKDF-SHA256 (recovery key)', VECTORS.hkdf, () => p.deriveKey({ id: 'hkdf-sha256', info: 'clarity/recovery-kek/v1' }, KEY.slice(0, 20), SALT));
  await run('Argon2id 19 MiB, t=2 (passphrase)', VECTORS.argon2id, () =>
    p.deriveKey({ id: 'argon2id', m: 19456, t: 2, p: 1, v: 19 }, utf8Encode('correct horse battery staple'), SALT),
  );
  return results;
}
