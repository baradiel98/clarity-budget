import { RefreshCw } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { isUpdateReady, onUpdateReady } from '../platform/update';

/** Shown once a newer version of Clarity has been downloaded. Reloading is the user's choice. */
export function UpdateBanner() {
  const ready = useSyncExternalStore(onUpdateReady, isUpdateReady);
  if (!ready) return null;
  return (
    <div className="toast update-banner" role="status" data-testid="update-banner">
      <RefreshCw size={16} aria-hidden />
      <span>A new version of Clarity is ready.</span>
      <button className="btn btn-primary btn-sm" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}
