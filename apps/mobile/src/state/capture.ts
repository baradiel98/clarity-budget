import type { CaptureDraft } from '@clarity/capture';

/**
 * Clarity Capture drafts. Kept in memory only (never in browser storage, never in the encrypted
 * records): drafts are not financial data until approved. Survives moving between pages, cleared on lock.
 */
export interface CaptureState {
  text: string;
  drafts: CaptureDraft[];
  notUnderstood: string[];
  error: string | null;
  /** How many were saved in this session (for the "saved" note). */
  saved: number;
}

const empty = (): CaptureState => ({ text: '', drafts: [], notUnderstood: [], error: null, saved: 0 });
let state: CaptureState = empty();
const listeners = new Set<() => void>();

export const captureStore = {
  get: (): CaptureState => state,
  set(patch: Partial<CaptureState> | ((s: CaptureState) => Partial<CaptureState>)) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  clear() {
    state = empty();
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
