export type PersistState = 'persisted' | 'not-persisted' | 'unsupported';

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence(): Promise<PersistState> {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'persisted';
    return (await navigator.storage.persist()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

export async function persistenceState(): Promise<PersistState> {
  if (!navigator.storage?.persisted) return 'unsupported';
  try {
    return (await navigator.storage.persisted()) ? 'persisted' : 'not-persisted';
  } catch {
    return 'unsupported';
  }
}

export function isStandalone(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
