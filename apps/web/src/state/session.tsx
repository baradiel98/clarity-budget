import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { buildDemoWorkspace, CommandError, MemoryAdapter, WorkspaceStore, type Ctx, type Op } from '@clarity/data';
import { localISODate, TABLES, type ISODate, type WorkspaceData } from '@clarity/shared';
import { WrongSecretError } from '@clarity/security';
import { DexieAdapter } from '../platform/dexieAdapter';
import { provider } from '../platform/crypto';
import { requestPersistence } from '../platform/persistence';

type Phase =
  | { kind: 'loading' }
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
  restore(fileText: string, secret: { passphrase: string } | { recoveryKey: string }): Promise<void>;
  startDemo(): Promise<void>;
  exitDemo(): void;
  lock(): void;
  wipe(): Promise<void>;
}

const SessionCtx = createContext<Session | null>(null);
const adapter = new DexieAdapter();

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
    WorkspaceStore.exists(adapter)
      .then((e) => setPhase(e ? { kind: 'locked' } : { kind: 'welcome' }))
      .catch(() => setPhase({ kind: 'welcome' }));
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
        const { store, recoveryKey } = await WorkspaceStore.create(adapter, provider, passphrase, { withRecoveryKey, now: Date.now() });
        void requestPersistence();
        setPendingRecoveryKey(recoveryKey);
        setIntroActive(true);
        setPhase({ kind: 'ready', store, demo: false });
        return recoveryKey;
      },
      async unlock(how) {
        const store = await WorkspaceStore.unlock(adapter, provider, how);
        lastActive.current = Date.now();
        void requestPersistence();
        setPhase({ kind: 'ready', store, demo: false });
      },
      async restore(text, secret) {
        const store = await WorkspaceStore.restoreBackup(adapter, provider, text, secret);
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
        WorkspaceStore.exists(adapter).then((e) => setPhase(e ? { kind: 'locked' } : { kind: 'welcome' }));
      },
      lock,
      async wipe() {
        if (phase.kind === 'ready') await phase.store.wipe();
        else await adapter.wipe();
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
