import type { EncryptedRow } from './records';
import { isVaultMeta, type VaultMeta } from './vault';

/**
 * Cross-platform encrypted backup (.claritybackup). Plain JSON whose financial content is
 * entirely ciphertext. Restorable on web or mobile with the passphrase that was current
 * when the backup was made, or with the recovery key.
 */
export const BACKUP_FORMAT = 'clarity-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_EXTENSION = '.claritybackup';
export const BACKUP_MIME = 'application/json';

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  createdAt: number;
  appPlatform: 'web' | 'ios' | 'android' | 'test';
  vault: VaultMeta;
  rows: EncryptedRow[];
}

export function makeBackup(vault: VaultMeta, rows: EncryptedRow[], schemaVersion: number, createdAt: number, appPlatform: BackupFile['appPlatform']): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    schemaVersion,
    createdAt,
    appPlatform,
    vault,
    rows: rows.filter((r) => !r.deleted),
  };
}

export const serializeBackup = (b: BackupFile): string => JSON.stringify(b);

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/** Validate structure before attempting any decryption. */
export function parseBackup(text: string, maxBytes = 50 * 1024 * 1024): BackupFile {
  if (text.length > maxBytes) throw new BackupFormatError('This backup file is too large.');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupFormatError('This file is not a Clarity backup.');
  }
  const b = data as BackupFile;
  if (!b || b.format !== BACKUP_FORMAT) throw new BackupFormatError('This file is not a Clarity backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) throw new BackupFormatError('This backup was made by a newer version of Clarity. Update the app and try again.');
  if (!isVaultMeta(b.vault)) throw new BackupFormatError('The backup is missing its key information.');
  if (!Array.isArray(b.rows)) throw new BackupFormatError('The backup has no data.');
  for (const r of b.rows) {
    if (typeof r?.table !== 'string' || typeof r.id !== 'string' || typeof r.ct !== 'string' || typeof r.iv !== 'string') {
      throw new BackupFormatError('The backup is damaged.');
    }
  }
  return b;
}
