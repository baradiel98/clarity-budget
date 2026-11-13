import { fromBase64, toBase64, utf8Decode, utf8Encode } from './encoding';
import type { CryptoProvider } from './provider';

/** One stored row. Nothing but table/id/timestamps is visible without the master key. */
export interface EncryptedRow {
  table: string;
  id: string;
  keyVersion: number;
  iv: string; // base64, 12 random bytes
  ct: string; // base64 AES-GCM ciphertext+tag; '' for tombstones
  updatedAt: number;
  deviceId: string;
  /** Tombstone for deletions (keeps future end-to-end sync possible). */
  deleted: boolean;
}

const recordAad = (vaultId: string, table: string, id: string, keyVersion: number) =>
  utf8Encode(`clarity-rec|v1|${vaultId}|${table}|${id}|${keyVersion}`);

export async function encryptRecord(
  p: CryptoProvider,
  mk: Uint8Array,
  vaultId: string,
  row: { table: string; id: string; value: unknown; keyVersion: number; updatedAt: number; deviceId: string },
): Promise<EncryptedRow> {
  const iv = p.randomBytes(12);
  const ct = await p.aesGcmEncrypt(mk, iv, utf8Encode(JSON.stringify(row.value)), recordAad(vaultId, row.table, row.id, row.keyVersion));
  return { table: row.table, id: row.id, keyVersion: row.keyVersion, iv: toBase64(iv), ct: toBase64(ct), updatedAt: row.updatedAt, deviceId: row.deviceId, deleted: false };
}

export function tombstone(table: string, id: string, keyVersion: number, updatedAt: number, deviceId: string): EncryptedRow {
  return { table, id, keyVersion, iv: '', ct: '', updatedAt, deviceId, deleted: true };
}

/**
 * Decrypt a row. The AAD binds the ciphertext to its vault, table and id, so a row cannot be
 * moved or swapped without detection.
 */
export async function decryptRecord<T = unknown>(p: CryptoProvider, mk: Uint8Array, vaultId: string, row: EncryptedRow): Promise<T> {
  if (row.deleted) throw new Error('Cannot decrypt a tombstone');
  const pt = await p.aesGcmDecrypt(mk, fromBase64(row.iv), fromBase64(row.ct), recordAad(vaultId, row.table, row.id, row.keyVersion));
  return JSON.parse(utf8Decode(pt)) as T;
}
