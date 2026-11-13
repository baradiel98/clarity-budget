/**
 * Rows that were just added or edited get a brief highlight so people can see what changed.
 * Purely visual: ids are kept in memory for a few seconds and never stored.
 */
const marked = new Map<string, number>();
const WINDOW_MS = 2500;

export function markFresh(ids: Iterable<string>, now = Date.now()): void {
  for (const id of ids) marked.set(id, now);
  for (const [id, t] of marked) if (now - t > WINDOW_MS) marked.delete(id);
}

export function isFresh(id: string, now = Date.now()): boolean {
  const t = marked.get(id);
  return t !== undefined && now - t <= WINDOW_MS;
}
