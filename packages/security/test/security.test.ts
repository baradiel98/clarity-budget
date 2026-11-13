import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  BackupFormatError, VECTORS, WrongSecretError, changePassphrase, checkPassphrase, createVault, decryptRecord, encryptRecord,
  formatRecoveryKey, fromBase64, fromCrockford, makeBackup, parseBackup, parseRecoveryKey, regenerateRecoveryKey,
  runCryptoSelfTest, serializeBackup, toBase64, toCrockford, unlockWithPassphrase, unlockWithRecoveryKey, utf8Decode, utf8Encode,
  type CryptoProvider,
} from '../src';
import { createNobleProvider } from '../src/providers/noble';
import { createWebCryptoProvider } from '../src/providers/webcrypto';

const noble = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
const web = createWebCryptoProvider(globalThis.crypto);
const providers: [string, CryptoProvider][] = [['noble', noble], ['webcrypto', web]];
const NOW = 1_700_000_000_000;

describe('encoding', () => {
  it('base64 round-trips all lengths', () => {
    for (let n = 0; n < 40; n++) {
      const b = new Uint8Array(randomBytes(n));
      expect(fromBase64(toBase64(b))).toEqual(b);
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
  });
  it('utf8 round-trips non-ASCII text', () => {
    for (const s of ['Café', 'Año nuevo — ñ', '💸 rent', '日本語']) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
      expect(utf8Encode(s)).toEqual(new Uint8Array(Buffer.from(s, 'utf8')));
    }
  });
  it('crockford round-trips and tolerates confusable characters', () => {
    const b = new Uint8Array(randomBytes(20));
    const s = toCrockford(b);
    expect(s).toHaveLength(32);
    expect(fromCrockford(s.toLowerCase(), 20)).toEqual(b);
    const formatted = formatRecoveryKey(b);
    expect(formatted).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/);
    expect(parseRecoveryKey(formatted.replace(/1/g, 'l').replace(/0/g, 'o'))).toEqual(b);
  });
});

describe.each(providers)('known-answer vectors: %s', (_name, p) => {
  it('passes every self-test vector', async () => {
    const r = await runCryptoSelfTest(p);
    expect(r.filter((x) => !x.ok)).toEqual([]);
    expect(r).toHaveLength(5);
  });
});

describe('cross-provider interoperability', () => {
  it('records encrypted by one provider decrypt with the other', async () => {
    const mk = noble.randomBytes(32);
    for (const [a, b] of [[noble, web], [web, noble]] as const) {
      const row = await encryptRecord(a, mk, 'vault_x', { table: 'transactions', id: 't1', value: { amountCents: -1234, merchant: 'Café' }, keyVersion: 1, updatedAt: NOW, deviceId: 'd1' });
      expect(await decryptRecord(b, mk, 'vault_x', row)).toEqual({ amountCents: -1234, merchant: 'Café' });
    }
  });
  it('a vault created on web unlocks on mobile and vice versa', async () => {
    const v1 = await createVault(web, 'river otter lantern 42', { withRecoveryKey: true, now: NOW });
    expect(await unlockWithPassphrase(noble, v1.meta, 'river otter lantern 42')).toEqual(v1.masterKey);
    expect(await unlockWithRecoveryKey(noble, v1.meta, v1.recoveryKey!)).toEqual(v1.masterKey);
    const v2 = await createVault(noble, 'river otter lantern 42', { withRecoveryKey: false, now: NOW });
    expect(await unlockWithPassphrase(web, v2.meta, 'river otter lantern 42')).toEqual(v2.masterKey);
  });
});

describe('vault', () => {
  it('rejects the wrong passphrase and recovery key', async () => {
    const v = await createVault(noble, 'blue whale granite', { withRecoveryKey: true, now: NOW });
    await expect(unlockWithPassphrase(noble, v.meta, 'blue whale granitE')).rejects.toBeInstanceOf(WrongSecretError);
    const other = formatRecoveryKey(noble.randomBytes(20));
    await expect(unlockWithRecoveryKey(noble, v.meta, other)).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('passphrase is Unicode-normalized (same text from different keyboards)', async () => {
    const v = await createVault(noble, 'café morning walk', { withRecoveryKey: false, now: NOW });
    expect(await unlockWithPassphrase(noble, v.meta, 'café morning walk')).toEqual(v.masterKey);
  });

  it('changing the passphrase does not re-encrypt records', async () => {
    const v = await createVault(noble, 'first passphrase here', { withRecoveryKey: true, now: NOW });
    const row = await encryptRecord(noble, v.masterKey, v.meta.vaultId, { table: 'accounts', id: 'a', value: { n: 1 }, keyVersion: 1, updatedAt: NOW, deviceId: 'd' });
    const meta2 = await changePassphrase(noble, v.meta, v.masterKey, 'second passphrase here', NOW + 1);
    await expect(unlockWithPassphrase(noble, meta2, 'first passphrase here')).rejects.toBeInstanceOf(WrongSecretError);
    const mk = await unlockWithPassphrase(noble, meta2, 'second passphrase here');
    expect(await decryptRecord(noble, mk, meta2.vaultId, row)).toEqual({ n: 1 });
    // recovery key still works after the passphrase change
    expect(await unlockWithRecoveryKey(noble, meta2, v.recoveryKey!)).toEqual(v.masterKey);
  });

  it('regenerating the recovery key revokes the old one', async () => {
    const v = await createVault(noble, 'some long passphrase', { withRecoveryKey: true, now: NOW });
    const { meta, recoveryKey } = await regenerateRecoveryKey(noble, v.meta, v.masterKey, NOW + 1);
    await expect(unlockWithRecoveryKey(noble, meta, v.recoveryKey!)).rejects.toBeInstanceOf(WrongSecretError);
    expect(await unlockWithRecoveryKey(noble, meta, recoveryKey)).toEqual(v.masterKey);
  });

  it('tampered, moved or swapped ciphertext fails authentication', async () => {
    const mk = noble.randomBytes(32);
    const row = await encryptRecord(noble, mk, 'v', { table: 'transactions', id: 't1', value: { a: 1 }, keyVersion: 1, updatedAt: NOW, deviceId: 'd' });
    const ct = fromBase64(row.ct);
    ct[0] = ct[0]! ^ 1;
    await expect(decryptRecord(noble, mk, 'v', { ...row, ct: toBase64(ct) })).rejects.toThrow();
    await expect(decryptRecord(noble, mk, 'v', { ...row, id: 't2' })).rejects.toThrow();
    await expect(decryptRecord(noble, mk, 'other-vault', row)).rejects.toThrow();
    await expect(decryptRecord(web, mk, 'v', { ...row, table: 'accounts' })).rejects.toThrow();
  });

  it('ciphertext contains no plaintext', async () => {
    const mk = noble.randomBytes(32);
    const row = await encryptRecord(noble, mk, 'v', { table: 'transactions', id: 't1', value: { merchant: 'Trader Joes', amountCents: -4321 }, keyVersion: 1, updatedAt: NOW, deviceId: 'd' });
    const raw = JSON.stringify(row) + Buffer.from(fromBase64(row.ct)).toString('latin1');
    expect(raw).not.toMatch(/Trader|4321/);
  });

  it('uses fresh IVs for every encryption', async () => {
    const mk = noble.randomBytes(32);
    const ivs = new Set<string>();
    for (let i = 0; i < 50; i++) ivs.add((await encryptRecord(noble, mk, 'v', { table: 't', id: 'x', value: 1, keyVersion: 1, updatedAt: NOW, deviceId: 'd' })).iv);
    expect(ivs.size).toBe(50);
  });
});

describe('backup format', () => {
  it('round-trips and restores across providers', async () => {
    const v = await createVault(web, 'backup test passphrase', { withRecoveryKey: true, now: NOW });
    const row = await encryptRecord(web, v.masterKey, v.meta.vaultId, { table: 'accounts', id: 'a1', value: { name: 'Checking' }, keyVersion: 1, updatedAt: NOW, deviceId: 'web' });
    const file = serializeBackup(makeBackup(v.meta, [row, { ...row, id: 'gone', deleted: true, ct: '', iv: '' }], 1, NOW, 'web'));
    const parsed = parseBackup(file);
    expect(parsed.rows).toHaveLength(1);
    const mk = await unlockWithRecoveryKey(noble, parsed.vault, v.recoveryKey!);
    expect(await decryptRecord(noble, mk, parsed.vault.vaultId, parsed.rows[0]!)).toEqual({ name: 'Checking' });
  });
  it('rejects malformed or future-version files', () => {
    expect(() => parseBackup('nope')).toThrow(BackupFormatError);
    expect(() => parseBackup('{"format":"other"}')).toThrow(BackupFormatError);
    expect(() => parseBackup(JSON.stringify({ format: 'clarity-backup', version: 99 }))).toThrow(/newer version/);
  });
});

describe('passphrase policy', () => {
  it('rejects short PINs and common passwords', () => {
    expect(checkPassphrase('1234').ok).toBe(false);
    expect(checkPassphrase('1234567890123').ok).toBe(false);
    expect(checkPassphrase('password123').ok).toBe(false);
    expect(checkPassphrase('short').ok).toBe(false);
  });
  it('accepts and scores passphrases', () => {
    expect(checkPassphrase('river otter lantern').ok).toBe(true);
    expect(checkPassphrase('Purple-Moose-73-Sings!').score).toBe(4);
  });
});

it('vectors are hex', () => {
  for (const v of Object.values(VECTORS)) expect(v).toMatch(/^[0-9a-f]+$/);
});
