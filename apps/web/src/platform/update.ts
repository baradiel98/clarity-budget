/**
 * App updates. The service worker (vite-plugin-pwa, autoUpdate) downloads a new version in the
 * background and takes control, but the open page keeps running the old code until it reloads.
 * We never reload on our own (that would lock the app and could lose typing); we offer a button.
 */

/** Short build id stamped into index.html at build time (git commit on Render). */
export function buildId(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="clarity-build"]')?.content || 'unknown';
}

let ready = false;
const listeners = new Set<() => void>();

export function watchForUpdates(): void {
  const sw = navigator.serviceWorker;
  if (!sw) return;
  // The very first install also fires controllerchange; that one is not an update.
  let claimed = !!sw.controller;
  sw.addEventListener('controllerchange', () => {
    if (!claimed) {
      claimed = true;
      return;
    }
    ready = true;
    listeners.forEach((l) => l());
  });
  // Phones keep a tab alive for days without navigating; check again whenever the app comes back.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
}

export const isUpdateReady = () => ready;
export function onUpdateReady(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Asks the server for a newer version (same origin only). */
export async function checkForUpdate(): Promise<'ready' | 'downloading' | 'latest' | 'unavailable'> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return 'unavailable';
    await reg.update();
    if (ready) return 'ready';
    return reg.installing || reg.waiting ? 'downloading' : 'latest';
  } catch {
    return 'unavailable';
  }
}
