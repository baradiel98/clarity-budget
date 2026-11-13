import { BarChart3, CalendarRange, Ellipsis, Home as HomeIcon, Lock, PieChart, Plus, ReceiptText, Settings as SettingsIcon, ShieldCheck, Upload } from 'lucide-react';
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
import { Budget } from './features/Budget';
import { Home } from './features/Home';
import { ImportPage } from './features/Import';
import { LockScreen } from './features/Lock';
import { Onboarding } from './features/Onboarding';
import { Planning } from './features/Planning';
import { PrivacyCenter } from './features/Privacy';
import { Reports } from './features/Reports';
import { SelfTest } from './features/SelfTest';
import { Settings } from './features/Settings';
import { Transactions } from './features/Transactions';
import { Welcome } from './features/Welcome';

export function App() {
  const session = useSession();
  const { phase } = session;
  if (phase.kind === 'loading') return <div className="boot" aria-busy="true"><p className="boot-title">Loading Clarity…</p></div>;
  if (phase.kind === 'error') return <StartupProblem message={phase.message} />;
  if (phase.kind === 'welcome') return <RouterProvider><PublicRoutes /></RouterProvider>;
  if (phase.kind === 'locked') return <LockScreen />;
  return (
    <RouterProvider>
      <Unlocked />
    </RouterProvider>
  );
}

export function StartupProblem({ message }: { message: string }) {
  return (
    <div className="boot" role="alert">
      <p className="boot-title">Clarity couldn't start</p>
      <p className="boot-hint now">{message}</p>
      <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => window.location.reload()}>Try again</button>
    </div>
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
  { to: '/budget', label: 'Budget', icon: PieChart, key: '3' },
  { to: '/planning', label: TERMS.tabs.planning, icon: CalendarRange, key: '4' },
  { to: '/reports', label: 'Reports', icon: BarChart3, key: '5' },
  { to: '/settings', label: TERMS.tabs.settings, icon: SettingsIcon, key: '6' },
];

function Shell() {
  const session = useSession();
  const { path, search, navigate } = useRouter();
  const [add, setAdd] = useState<AddPrefill | null>(null);
  const [afford, setAfford] = useState(false);
  const [explain, setExplain] = useState<Explanation | null>(null);
  const [help, setHelp] = useState(false);
  const [more, setMore] = useState(false);
  const data = useData();
  const demo = session.phase.kind === 'ready' && session.phase.demo;

  const ui = useMemo<UiApi>(() => ({ openAdd: (p) => setAdd(p ?? {}), openAfford: () => setAfford(true), explain: setExplain }), []);
  const anyOpen = add !== null || afford || explain !== null || help || more;

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
  if (path === '/transactions') page = <Transactions key={search} />;
  else if (path === '/budget') page = <Budget />;
  else if (path === '/planning') page = <Planning />;
  else if (path === '/reports') page = <Reports />;
  else if (path === '/settings') page = <Settings />;
  else if (path === '/import') page = <ImportPage />;
  else if (path === '/privacy') page = <PrivacyCenter />;
  else if (path === '/dev/self-test') page = <SelfTest />;
  else page = <Home />;

  const item = (n: (typeof NAV)[number]) => (
    <Link key={n.to} to={n.to} className="nav-item">
      <n.icon size={17} strokeWidth={1.9} /> {n.label} <kbd>{n.key}</kbd>
    </Link>
  );
  const tab = (n: (typeof NAV)[number]) => (
    <Link key={n.to} to={n.to} className="tab">
      <n.icon size={21} strokeWidth={1.9} />
      {n.label}
    </Link>
  );
  const inMore = ['/budget', '/reports', '/settings', '/import', '/privacy', '/dev/self-test'].includes(path);

  return (
    <UiCtx.Provider value={ui}>
      {demo && (
        <div className="demo-banner" role="note">
          <span><strong>Sample data.</strong> Fictional numbers for exploring; nothing here is saved.</span>
          <button className="btn btn-sm btn-secondary" onClick={session.exitDemo}>Exit demo</button>
        </div>
      )}
      <div className={`shell ${demo ? 'with-banner' : ''}`}>
        <nav className="sidebar" aria-label="Main">
          <div className="brand"><img src="/favicon.svg" alt="" /> {TERMS.appName}</div>
          <div className="nav-group">{NAV.slice(0, 5).map(item)}</div>
          <button className="btn btn-primary btn-block sidebar-add" onClick={() => setAdd({})}><Plus size={16} /> {TERMS.addTransaction}</button>
          <div className="nav-group">
            <Link to="/import" className="nav-item"><Upload size={17} strokeWidth={1.9} /> {TERMS.importStatement}</Link>
            {item(NAV[5]!)}
          </div>
          <div className="sidebar-foot">
            <Link to="/privacy" className="privacy-chip"><ShieldCheck size={16} /> <span>Stored only on this device, encrypted</span></Link>
            {!demo && <button className="nav-item" onClick={session.lock}><Lock size={17} strokeWidth={1.9} /> Lock</button>}
          </div>
        </nav>
        <main className="main" id="main">
          <div className="main-inner" key={path}>{page}</div>
        </main>
      </div>

      {/* phone-width navigation */}
      <nav className="tabbar" aria-label="Main (compact)">
        {tab(NAV[0]!)}
        {tab(NAV[1]!)}
        <button className="tab-add" aria-label={TERMS.addTransaction} onClick={() => setAdd({})}><Plus size={26} strokeWidth={2.3} /></button>
        {tab(NAV[3]!)}
        <button className="tab" aria-current={inMore ? 'page' : undefined} onClick={() => setMore(true)}><Ellipsis size={21} strokeWidth={1.9} />More</button>
      </nav>

      {add !== null && <AddTransactionDialog prefill={add} onClose={() => setAdd(null)} />}
      {afford && <AffordDialog onClose={() => setAfford(false)} />}
      {explain && <ExplainDialog ex={explain} currency={data.settings.baseCurrency} onClose={() => setExplain(null)} />}
      {more && (
        <Dialog title="More" onClose={() => setMore(false)}>
          <div className="more-list" onClick={() => setMore(false)}>
            <Link to="/budget" className="nav-item"><PieChart size={19} /> Budget</Link>
            <Link to="/reports" className="nav-item"><BarChart3 size={19} /> Reports</Link>
            <Link to="/import" className="nav-item"><Upload size={19} /> {TERMS.importStatement}</Link>
            <Link to="/settings" className="nav-item"><SettingsIcon size={19} /> {TERMS.tabs.settings}</Link>
            <Link to="/privacy" className="nav-item"><ShieldCheck size={19} /> {TERMS.privacyCenter}</Link>
            {!demo && <button className="nav-item" onClick={session.lock}><Lock size={19} /> Lock</button>}
          </div>
        </Dialog>
      )}
      {help && (
        <Dialog title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <div className="list">
            {[
              ['N', TERMS.addTransaction], ['/', 'Search transactions'], ['1 – 6', 'Home, Transactions, Budget, Planning, Reports, Settings'],
              ['↑ ↓', 'Move between transactions'], ['E or Enter', 'Edit selected transaction'], ['Delete', 'Delete selected transaction'],
              ['← →', 'Move along the forecast chart (when focused)'], ['Esc', 'Close dialog'], ['?', 'Show this help'],
            ].map(([k, d]) => (
              <div key={k} className="kv"><span>{d}</span><kbd>{k}</kbd></div>
            ))}
          </div>
        </Dialog>
      )}
    </UiCtx.Provider>
  );
}
