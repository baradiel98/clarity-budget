import type { TableName, WorkspaceData } from '@clarity/shared';

/** Row type for each table. */
export type RowOf = { [K in Exclude<TableName, 'settings'>]: WorkspaceData[K][number] } & { settings: WorkspaceData['settings'] };

export type PutOp = { [K in TableName]: { t: 'put'; table: K; value: RowOf[K] } }[TableName];
export type Op = PutOp | { t: 'del'; table: TableName; id: string };

type Row = { id: string };

function tableArray(data: WorkspaceData, table: TableName): Row[] {
  if (table === 'settings') return [data.settings];
  return data[table] as unknown as Row[];
}

/** Apply ops immutably. */
export function applyOps(data: WorkspaceData, ops: readonly Op[]): WorkspaceData {
  const next: WorkspaceData = { ...data };
  const touched = new Set<TableName>();
  for (const op of ops) {
    if (op.table === 'settings') {
      if (op.t === 'put') next.settings = op.value as WorkspaceData['settings'];
      continue;
    }
    if (!touched.has(op.table)) {
      (next as unknown as Record<string, Row[]>)[op.table] = [...tableArray(data, op.table)];
      touched.add(op.table);
    }
    const arr = (next as unknown as Record<string, Row[]>)[op.table]!;
    const id = op.t === 'put' ? op.value.id : op.id;
    const idx = arr.findIndex((r) => r.id === id);
    if (op.t === 'put') {
      if (idx >= 0) arr[idx] = op.value as Row;
      else arr.push(op.value as Row);
    } else if (idx >= 0) arr.splice(idx, 1);
  }
  return next;
}

/** Ops that revert `ops` when applied to the result of applying them to `before`. */
export function inverseOps(before: WorkspaceData, ops: readonly Op[]): Op[] {
  const inv: Op[] = [];
  for (const op of ops) {
    const id = op.t === 'put' ? op.value.id : op.id;
    const prev = tableArray(before, op.table).find((r) => r.id === id);
    if (prev) inv.push({ t: 'put', table: op.table, value: prev } as PutOp);
    else if (op.t === 'put') inv.push({ t: 'del', table: op.table, id });
  }
  return inv.reverse();
}

export function emptyWorkspace(settings: WorkspaceData['settings']): WorkspaceData {
  return { accounts: [], transactions: [], recurring: [], exceptions: [], categories: [], settings, importBatches: [], mappingProfiles: [] };
}
