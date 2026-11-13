import { CalendarRange, Home as HomeIcon, Lock, Plus, ReceiptText, Settings as SettingsIcon, ShieldCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Explanation } from '@clarity/engine';
import { TERMS } from '@clarity/shared';
import { Link, RouterProvider, useRouter } from './lib/router';
import { useData, useSession } from './state/session';
import { UiCtx, type AddPrefill, type UiApi } from './state/ui';
import { ExplainDialog } from './ui/Explain';
import { Dialog } from './ui/Dialog';
import { AddTransactionDialog } from './features/AddTransaction';
import { AffordDialog } from './features/Afford';
import { Home } from './features/Home';
import { ImportPage } from './features/Import';
import { LockScreen } from './features/Lock';
import { Onboarding } from './features/Onboarding';
import { Planning } from './features/Planning';
import { PrivacyCenter } from './features/Privacy';
import { SelfTest } from './features/SelfTest';
import { Settings } from './features/Settings';
import { Transactions } from './features/Transactions';
import { Welcome } from './features/Welcome';

export function App() {
  const session = useSession();
  const { phase } = session;
  if (phase.kind === 'loading') return <div className="center-screen" aria-busy="true" />;
  if (phase.kind === 'welcome') return <RouterProvider><PublicRoutes /></RouterProvider>;
  if (phase.kind === 'locked') return <LockScreen />;
  return (
    <RouterProvider>
      <Unlocked />
    </RouterProvider>
  );
}

function PublicRoutes() {
  const { path } = useRouter();
  if (path === '/dev/self-test') return <div className="main"><div className="main-inner"><SelfTest /></div></div>;
  return <Welcome />;
}

function Unlocked() {
  const data = useData();
  const session = useSession();
  const theme = data.settings.theme;
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
  if (!data.settings.onboardingComplete || session.introActive || session.pendingRecoveryKey) return <Onboarding />;
  return <Shell />;
}

const NAV = [
  { to: '/', label: TERMS.tabs.home, icon: HomeIcon, key: '1' },
  { to: '/transactions', label: TERMS.tabs.transactions, icon: ReceiptText, key: '2' },
  { to: '/planning', label: TERMS.tabs.planning, icon: CalendarRange, key: '3' },
  { to: '/settings', label: TERMS.tabs.settings, icon: SettingsIcon, key: '4' },
];

function Shell() {
  const session = useSession();
  const { path, navigate } = useRouter();
  const [add, setAdd] = useState<AddPrefill | null>(null);
  const [afford, setAfford] = useState(false);
  const [explain, setExplain] = useState<Explanation | null>(null);
  const [help, setHelp] = useState(false);
  const data = useData();
  const demo = session.phase.kind === 'ready' && session.phase.demo;

  const ui = useMemo<UiApi>(() => ({ openAdd: (p) => setAdd(p ?? {}), openAfford: () => setAfford(true), explain: setExplain }), []);
  const anyOpen = add !== null || afford || explain !== null || help;

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (anyOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setAdd({}); }
      else if (e.key === '?') { e.preventDefault(); setHelp(true); }
      else if (e.key === '/') { e.preventDefault(); navigate('/transactions'); setTimeout(() => document.getElementById('tx-search')?.focus(), 30); }
      else {
        const n = NAV.find((x) => x.key === e.key);
        if (n) navigate(n.to);
      }
    },
    [anyOpen, navigate],
  );
  useEffect(() => {
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onKey]);

  let page: ReactNode;
  if (path === '/transactions') page = <Transactions />;
  else if (path === '/planning') page = <Planning />;
  else if (path === '/settings') page = <Settings />;
  else if (path === '/import') page = <ImportPage />;
  else if (path === '/privacy') page = <PrivacyCenter />;
  else if (path === '/dev/self-test') page = <SelfTest />;
  else page = <Home />;

  return (
    <UiCtx.Provider value={ui}>
      {demo && (
        <div className="demo-banner" role="note">
          Sample data — fictional numbers for exploring. Nothing here is saved.
          <button className="btn btn-sm btn-secondary" onClick={session.exitDemo}>Exit demo</button>
        </div>
      )}
      <div className={`shell ${demo ? 'with-banner' : ''}`}>
        <nav className="sidebar" aria-label="Main">
          <div className="brand"><img src="/favicon.svg" alt="" /> {TERMS.appName}</div>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="nav-item">
              <n.icon size={18} strokeWidth={1.9} /> {n.label} <kbd>{n.key}</kbd>
            </Link>
          ))}
          <div className="sidebar-actions">
            <button className="btn btn-primary btn-block" onClick={() => setAdd({})}><Plus size={16} /> {TERMS.addTransaction}</button>
            <Link to="/import" className="btn btn-secondary btn-block"><Upload size={15} /> {TERMS.importStatement}</Link>
          </div>
          <div className="sidebar-foot">
            <Link to="/privacy" className="privacy-chip"><ShieldCheck size={16} /> <span>Stored only on this device, encrypted</span></Link>
            {!demo && <button className="nav-item" onClick={session.lock}><Lock size={17} /> Lock</button>}
          </div>
        </nav>
        <main className="main" id="main">
          <div className="main-inner">{page}</div>
        </main>
      </div>
      {add !== null && <AddTransactionDialog prefill={add} onClose={() => setAdd(null)} />}
      {afford && <AffordDialog onClose={() => setAfford(false)} />}
      {explain && <ExplainDialog ex={explain} currency={data.settings.baseCurrency} onClose={() => setExplain(null)} />}
      {help && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <div className="list">
            {[
              ['N', TERMS.addTransaction], ['/', 'Search transactions'], ['1 – 4', 'Go to Home, Transactions, Planning, Settings'],
              ['↑ ↓', 'Move between transactions'], ['E or Enter', 'Edit selected transaction'], ['Delete', 'Delete selected transaction'],
              ['Esc', 'Close dialog'], ['?', 'Show this help'],
            ].map(([k, d]) => (
              <div key={k} className="kv"><span>{d}</span><kbd>{k}</kbd></div>
            ))}
          </div>
        </Dialog>
      )}
    </UiCtx.Provider>
  );
}
