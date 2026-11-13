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

/** Chrome/Edge install prompt (Safari has no prompt; the Privacy Center explains Add to Dock / Home Screen). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let deferred: InstallPromptEvent | null = null;
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
  });
}
export const canPromptInstall = () => deferred !== null;
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const r = await deferred.userChoice;
  deferred = null;
  return r.outcome === 'accepted';
}
