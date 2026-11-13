import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as ExpoCrypto from 'expo-crypto';
import { buildDemoWorkspace, CommandError, MemoryAdapter, WorkspaceStore, type Ctx, type Op } from '@clarity/data';
import { localISODate, TABLES, type ISODate, type WorkspaceData } from '@clarity/shared';
import { biometricSupport, disableBiometric, enableBiometric, isBiometricEnabled, readBiometricKey, type BiometricSupport } from '../platform/biometrics';
import { provider } from '../platform/crypto';
import { SQLiteAdapter } from '../platform/sqliteAdapter';

type Phase = { kind: 'loading' } | { kind: 'welcome' } | { kind: 'locked' } | { kind: 'ready'; store: WorkspaceStore; demo: boolean };

interface Session {
  phase: Phase;
  today: ISODate;
  appActive: boolean;
  pendingRecoveryKey: string | null;
  clearPendingRecoveryKey(): void;
  introActive: boolean;
  finishIntro(): void;
  biometric: BiometricSupport & { enabled: boolean };
  setBiometric(on: boolean): Promise<void>;
  createVault(passphrase: string, withRecoveryKey: boolean): Promise<void>;
  unlock(how: { passphrase: string } | { recoveryKey: string }): Promise<void>;
  unlockWithBiometric(): Promise<'ok' | 'cancelled' | 'unavailable'>;
  restore(fileText: string, secret: { passphrase: string } | { recoveryKey: string }): Promise<void>;
  startDemo(): Promise<void>;
  exitDemo(): void;
  lock(): void;
  wipe(): Promise<void>;
}

const SessionCtx = createContext<Session | null>(null);

/** Max time in the background before locking, regardless of the auto-lock setting. */
export const MAX_BACKGROUND_MS = 5 * 60_000;

/** Pure lock decision so it can be unit-tested. */
export function shouldLockOnResume(backgroundedAt: number | null, now: number, autoLockMinutes: number): boolean {
  if (backgroundedAt === null) return false;
  return now - backgroundedAt >= Math.min(autoLockMinutes * 60_000, MAX_BACKGROUND_MS);
}
const adapter = new SQLiteAdapter();

export function SessionProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [today, setToday] = useState(() => localISODate(new Date()));
  const [appActive, setAppActive] = useState(true);
  const [pendingRecoveryKey, setPendingRecoveryKey] = useState<string | null>(null);
  const [introActive, setIntroActive] = useState(false);
  const [bio, setBio] = useState<BiometricSupport & { enabled: boolean }>({ available: false, label: 'biometrics', enabled: false });
  const backgroundedAt = useRef<number | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    void (async () => {
      const [exists, support, enabled] = await Promise.all([
        WorkspaceStore.exists(adapter).catch(() => false),
        biometricSupport().catch(() => ({ available: false, label: 'biometrics' })),
        isBiometricEnabled().catch(() => false),
      ]);
      setBio({ ...support, enabled: enabled && support.available });
      setPhase(exists ? { kind: 'locked' } : { kind: 'welcome' });
    })();
  }, []);

  const lock = useCallback(() => {
    setPhase((p) => {
      if (p.kind !== 'ready') return p;
      p.store.lock();
      return p.demo ? { kind: 'welcome' } : { kind: 'locked' };
    });
  }, []);

  // Lock after leaving the app for longer than the grace period; hide content in the app switcher.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      setAppActive(s === 'active');
      const p = phaseRef.current;
      if (s === 'background') backgroundedAt.current = Date.now();
      if (s === 'active') {
        setToday(localISODate(new Date()));
        if (p.kind === 'ready' && !p.demo && shouldLockOnResume(backgroundedAt.current, Date.now(), p.store.data.settings.autoLockMinutes)) lock();
        backgroundedAt.current = null;
      }
    });
    const tick = setInterval(() => setToday(localISODate(new Date())), 60_000);
    return () => {
      sub.remove();
      clearInterval(tick);
    };
  }, [lock]);

  const ready = (store: WorkspaceStore) => setPhase({ kind: 'ready', store, demo: false });

  const session = useMemo<Session>(
    () => ({
      phase,
      today,
      appActive,
      pendingRecoveryKey,
      clearPendingRecoveryKey: () => setPendingRecoveryKey(null),
      introActive,
      finishIntro: () => setIntroActive(false),
      biometric: bio,
      async setBiometric(on) {
        if (on) {
          if (phase.kind !== 'ready') return;
          await enableBiometric(phase.store.exportMasterKey());
        } else await disableBiometric();
        setBio((b) => ({ ...b, enabled: on }));
      },
      async createVault(passphrase, withRecoveryKey) {
        const { store, recoveryKey } = await WorkspaceStore.create(adapter, provider, passphrase, { withRecoveryKey, now: Date.now() });
        setPendingRecoveryKey(recoveryKey);
        setIntroActive(true);
        ready(store);
      },
      async unlock(how) {
        ready(await WorkspaceStore.unlock(adapter, provider, how));
      },
      async unlockWithBiometric() {
        const r = await readBiometricKey();
        if (!r.ok) {
          if (r.reason === 'unavailable') setBio((b) => ({ ...b, enabled: false }));
          return r.reason;
        }
        try {
          ready(await WorkspaceStore.unlock(adapter, provider, { masterKey: r.masterKey }));
          return 'ok';
        } catch {
          // Stored key no longer matches this data (e.g. after a restore): fall back to the passphrase.
          await disableBiometric();
          setBio((b) => ({ ...b, enabled: false }));
          return 'unavailable';
        }
      },
      async restore(text, secret) {
        const store = await WorkspaceStore.restoreBackup(adapter, provider, text, secret);
        // The restored data has a different key; any stored biometric key is now stale.
        await disableBiometric();
        setBio((b) => ({ ...b, enabled: false }));
        ready(store);
      },
      async startDemo() {
        const now = Date.now();
        const mem = new MemoryAdapter('demo');
        const pass = Array.from(ExpoCrypto.getRandomBytes(16), (b) => b.toString(16)).join('');
        // Demo data stays in memory; a fast KDF is fine because nothing is stored.
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
        void WorkspaceStore.exists(adapter).then((e) => setPhase(e ? { kind: 'locked' } : { kind: 'welcome' }));
      },
      lock,
      async wipe() {
        await disableBiometric();
        if (phase.kind === 'ready') await phase.store.wipe();
        else await adapter.wipe();
        setBio((b) => ({ ...b, enabled: false }));
        setPhase({ kind: 'welcome' });
      },
    }),
    [phase, today, appActive, pendingRecoveryKey, introActive, bio, lock],
  );
  return <SessionCtx.Provider value={session}>{children}</SessionCtx.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('No session');
  return s;
}

export function useStore(): { store: WorkspaceStore; demo: boolean } {
  const { phase } = useSession();
  if (phase.kind !== 'ready') throw new Error('Workspace is locked');
  return { store: phase.store, demo: phase.demo };
}

export function useData(): WorkspaceData {
  const { store } = useStore();
  return useSyncExternalStore((cb) => store.subscribe(cb), () => store.data);
}

export type RunResult = { ok: true } | { ok: false; errors: { field: string; message: string }[] };

export function useRun() {
  const { store } = useStore();
  const { today } = useSession();
  return useCallback(
    async (fn: (ctx: Ctx) => Op[] | { ops: Op[] }, opts: { undoLabel?: string } = {}): Promise<RunResult> => {
      try {
        const r = fn(store.ctx(Date.now(), today));
        await store.apply(Array.isArray(r) ? r : r.ops, opts);
        return { ok: true };
      } catch (e) {
        if (e instanceof CommandError) return { ok: false, errors: e.issues };
        return { ok: false, errors: [{ field: 'form', message: e instanceof Error ? e.message : 'Something went wrong.' }] };
      }
    },
    [store, today],
  );
}
