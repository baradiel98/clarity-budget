import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildDemoWorkspace, CommandError, MemoryAdapter, WorkspaceStore, type Ctx, type Op } from '@clarity/data';
import { localISODate, TABLES, type ISODate, type WorkspaceData } from '@clarity/shared';
import { hasRecoveryKey, WrongSecretError } from '@clarity/security';
import type { DexieAdapter } from '../platform/dexieAdapter';
import { provider } from '../platform/crypto';
import { requestPersistence } from '../platform/persistence';
import { markFresh } from './fresh';

type Phase =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'welcome' }
  | { kind: 'locked' }
  | { kind: 'ready'; store: WorkspaceStore; demo: boolean };

interface Session {
  phase: Phase;
  today: ISODate;
  /** Recovery key created during setup, shown once by onboarding, then cleared from memory. */
  pendingRecoveryKey: string | null;
  clearPendingRecoveryKey(): void;
  /** True from vault creation until the user leaves the first overview. */
  introActive: boolean;
  finishIntro(): void;
  createVault(passphrase: string, withRecoveryKey: boolean): Promise<string | null>;
  unlock(how: { passphrase: string } | { recoveryKey: string }): Promise<void>;
  /** Whether a recovery key was set up for the data on this device. Reads only which key slots exist (no secrets). */
  recoveryKeyAvailable(): Promise<boolean>;
  restore(fileText: string, secret: { passphrase: string } | { recoveryKey: string }): Promise<void>;
  startDemo(): Promise<void>;
  exitDemo(): void;
  lock(): void;
  wipe(): Promise<void>;
}

const SessionCtx = createContext<Session | null>(null);
let adapterInstance: DexieAdapter | null = null;
/** Created on first use (not at import time), so a storage failure is reported instead of stopping the app from loading. */
async function getAdapter(): Promise<DexieAdapter> {
  if (!adapterInstance) {
    const { DexieAdapter: Impl } = await import('../platform/dexieAdapter');
    adapterInstance = new Impl();
  }
  return adapterInstance;
}

/** Tells the startup safety net (public/boot.js) that the app started. */
function markReady() {
  (window as unknown as { __clarityReady?: boolean }).__clarityReady = true;
}

function useToday(): ISODate {
  const [today, setToday] = useState(() => localISODate(new Date()));
  useEffect(() => {
    const tick = () => setToday(localISODate(new Date()));
    const id = setInterval(tick, 30_000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return today;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);
  const [introActive, setIntroActive] = useState(false);
  const today = useToday();

  useEffect(() => {
    // Opening browser storage can hang or fail (private browsing, in-app browsers, blocked site data).
    // Never leave a blank screen: report it after a few seconds.
    let done = false;
    const timer = setTimeout(() => {
      if (!done) setPhase({ kind: 'error', message: 'This browser did not allow Clarity to open its storage. This happens in some private-browsing modes, in browsers inside other apps, or when site data is blocked.' });
    }, 8000);
    getAdapter()
      .then((a) => WorkspaceStore.exists(a))
      .then((e) => {
        done = true;
        clearTimeout(timer);
        markReady();
        setPhase(e ? { kind: 'locked' } : { kind: 'welcome' });
      })
      .catch((err: unknown) => {
        done = true;
        clearTimeout(timer);
        setPhase({ kind: 'error', message: `Clarity could not open its storage in this browser (${err instanceof Error ? err.name : 'error'}). Try a normal (non-private) window in Chrome, Safari, Edge or Firefox.` });
      });
    return () => clearTimeout(timer);
  }, []);

  const lock = useCallback(() => {
    setPhase((p) => {
      if (p.kind !== 'ready') return p;
      p.store.lock();
      return p.demo ? { kind: 'welcome' } : { kind: 'locked' };
    });
  }, []);

  // Auto-lock after inactivity, including while the tab is hidden.
  const lastActive = useRef(Date.now());
  useEffect(() => {
    if (phase.kind !== 'ready' || phase.demo) return;
    const mark = () => (lastActive.current = Date.now());
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    for (const e of events) window.addEventListener(e, mark, { passive: true });
    const check = () => {
      const minutes = phase.store.data.settings.autoLockMinutes;
      if (Date.now() - lastActive.current > minutes * 60_000) lock();
    };
    const id = setInterval(check, 15_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      for (const e of events) window.removeEventListener(e, mark);
      clearInterval(id);
      document.removeEventListener('visibilitychange', check);
    };
  }, [phase, lock]);

  const session = useMemo<Session>(
    () => ({
      phase,
      today,
      pendingRecoveryKey,
      clearPendingRecoveryKey: () => setPendingRecoveryKey(null),
      introActive,
      finishIntro: () => setIntroActive(false),
      async createVault(passphrase, withRecoveryKey) {
        const { store, recoveryKey } = await WorkspaceStore.create(await getAdapter(), provider, passphrase, { withRecoveryKey, now: Date.now() });
        void requestPersistence();
        setPendingRecoveryKey(recoveryKey);
        setIntroActive(true);
        setPhase({ kind: 'ready', store, demo: false });
        return recoveryKey;
      },
      async unlock(how) {
        const store = await WorkspaceStore.unlock(await getAdapter(), provider, how);
        lastActive.current = Date.now();
        void requestPersistence();
        setPhase({ kind: 'ready', store, demo: false });
      },
      async recoveryKeyAvailable() {
        const meta = await (await getAdapter()).loadVaultMeta();
        return !!meta && hasRecoveryKey(meta);
      },
      async restore(text, secret) {
        const store = await WorkspaceStore.restoreBackup(await getAdapter(), provider, text, secret);
        void requestPersistence();
        setPhase({ kind: 'ready', store, demo: false });
      },
      async startDemo() {
        const now = Date.now();
        const mem = new MemoryAdapter('demo');
        const pass = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16)).join('');
        const { store } = await WorkspaceStore.create(mem, provider, pass, { withRecoveryKey: false, now });
        const demo = buildDemoWorkspace(localISODate(new Date()), now);
        const ops: Op[] = [];
        for (const t of TABLES) {
          if (t === 'settings') ops.push({ t: 'put', table: 'settings', value: demo.settings });
          else for (const v of demo[t] as { id: string }[]) ops.push({ t: 'put', table: t, value: v } as Op);
        }
        await store.apply(ops);
        setPhase({ kind: 'ready', store, demo: true });
      },
      exitDemo() {
        setPhase((p) => {
          if (p.kind === 'ready') p.store.lock();
          return { kind: 'loading' };
        });
        getAdapter().then((a) => WorkspaceStore.exists(a)).then((e) => setPhase(e ? { kind: 'locked' } : { kind: 'welcome' }));
      },
      lock,
      async wipe() {
        if (phase.kind === 'ready') await phase.store.wipe();
        else await (await getAdapter()).wipe();
        setPhase({ kind: 'welcome' });
      },
    }),
    [phase, today, lock, pendingRecoveryKey, introActive],
  );

  return <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('No session');
  return s;
}

/** The unlocked store. Only valid inside the unlocked app. */
export function useStore(): { store: WorkspaceStore; demo: boolean } {
  const { phase } = useSession();
  if (phase.kind !== 'ready') throw new Error('Workspace is locked');
  return { store: phase.store, demo: phase.demo };
}

export function useData(): WorkspaceData {
  const { store } = useStore();
  return useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.data,
  );
}

export type RunResult = { ok: true } | { ok: false; errors: { field: string; message: string }[] };

/** Run a command, persist its ops, and report validation errors in a form-friendly shape. */
export function useRun() {
  const { store } = useStore();
  const { today } = useSession();
  return useCallback(
    async (fn: (ctx: Ctx) => Op[] | { ops: Op[] }, opts: { undoLabel?: string } = {}): Promise<RunResult> => {
      try {
        const r = fn(store.ctx(Date.now(), today));
        const ops = Array.isArray(r) ? r : r.ops;
        markFresh(ops.flatMap((o) => (o.t === 'put' && o.table === 'transactions' ? [o.value.id] : [])));
        await store.apply(ops, opts);
        return { ok: true };
      } catch (e) {
        if (e instanceof CommandError) return { ok: false, errors: e.issues };
        return { ok: false, errors: [{ field: 'form', message: e instanceof Error ? e.message : 'Something went wrong.' }] };
      }
    },
    [store, today],
  );
}

export { WrongSecretError };
