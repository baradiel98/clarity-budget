import type { WorkspaceData } from '@clarity/shared';

/**
 * Schema versions of the decrypted workspace. Every platform runs the same migrations on load
 * and on backup restore, so a backup from an older app version opens in a newer one.
 */
export const SCHEMA_VERSION = 1;

type AnyData = Record<string, unknown> & { [k: string]: unknown };
type Migration = (data: AnyData) => AnyData;

/** v0 → v1: early prototype data lacked a few fields; fill safe defaults. */
const v0to1: Migration = (d) => {
  const settings = { backupReminderTxCount: 50, txSinceBackup: 0, backupReminderDays: 14, ...(d.settings as object) };
  const recurring = ((d.recurring as AnyData[]) ?? []).map((r) => ({ weekendRule: 'none', paused: false, trackFrom: r.startDate, ...r }));
  const transactions = ((d.transactions as AnyData[]) ?? []).map((t) => ({ status: 'confirmed', notes: '', provenance: { source: 'manual' }, ...t }));
  return {
    accounts: [], exceptions: [], categories: [], importBatches: [], mappingProfiles: [],
    ...d,
    settings,
    recurring,
    transactions,
  };
};

const MIGRATIONS: Record<number, Migration> = { 0: v0to1 };

export class SchemaTooNewError extends Error {
  constructor() {
    super('This data was saved by a newer version of the app. Update the app to open it.');
    this.name = 'SchemaTooNewError';
  }
}

export function migrate(data: unknown, fromVersion: number): WorkspaceData {
  if (fromVersion > SCHEMA_VERSION) throw new SchemaTooNewError();
  let d = data as AnyData;
  for (let v = fromVersion; v < SCHEMA_VERSION; v++) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`Missing migration from schema ${v}`);
    d = m(d);
  }
  return d as unknown as WorkspaceData;
}
