/** Minimal in-memory stand-in for expo-sqlite's async API (only what SQLiteAdapter uses). */
type Row = Record<string, unknown>;

export class FakeDb {
  meta = new Map<string, string>();
  rows = new Map<string, Row>();
  failAfter: number | null = null;
  private writes = 0;

  async execAsync(sql: string) {
    if (/DELETE FROM meta/.test(sql)) this.meta.clear();
    if (/DELETE FROM rows/.test(sql)) this.rows.clear();
  }
  async getFirstAsync<T>(_sql: string, key: string): Promise<T | null> {
    const v = this.meta.get(key);
    return (v === undefined ? null : { value: v }) as T | null;
  }
  async getAllAsync<T>(): Promise<T[]> {
    return [...this.rows.values()] as T[];
  }
  async runAsync(sql: string, ...params: unknown[]) {
    if (this.failAfter !== null && ++this.writes > this.failAfter) throw new Error('disk full');
    if (/INTO meta/.test(sql)) this.meta.set(params[0] as string, params[1] as string);
    else if (/DELETE FROM rows/.test(sql)) this.rows.clear();
    else if (/INTO rows/.test(sql)) {
      const [table_name, id, key_version, iv, ct, updated_at, device_id, deleted] = params;
      this.rows.set(`${table_name}/${id}`, { table_name, id, key_version, iv, ct, updated_at, device_id, deleted });
    }
  }
  /** Snapshot + restore on failure = transactional semantics. */
  async withExclusiveTransactionAsync(task: (txn: FakeDb) => Promise<void>) {
    const meta = new Map(this.meta);
    const rows = new Map(this.rows);
    try {
      await task(this);
    } catch (e) {
      this.meta = meta;
      this.rows = rows;
      throw e;
    }
  }
  async closeAsync() {}
}

export const dbs = new Map<string, FakeDb>();
export const sqliteMock = {
  openDatabaseAsync: async (name: string) => {
    if (!dbs.has(name)) dbs.set(name, new FakeDb());
    return dbs.get(name)!;
  },
  deleteDatabaseAsync: async (name: string) => {
    dbs.delete(name);
  },
};
