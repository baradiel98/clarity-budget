import { ArrowDown, ArrowUp, ReceiptText, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteTransaction, type Op } from '@clarity/data';
import { periodTotals } from '@clarity/engine';
import { addDays, endOfMonth, formatMonthYear, formatShortDate, startOfMonth, TERMS, type Transaction } from '@clarity/shared';
import { useRouter } from '../lib/router';
import { useData, useRun, useSession, useStore } from '../state/session';
import { useUi } from '../state/ui';
import { categoryColors } from '../ui/categoryColor';
import { CategoryIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { useToast } from '../ui/Toast';
import { CategorySelect } from './AddTransaction';

type Period = 'this' | 'last' | '90' | 'year' | 'all' | 'custom';
type Sort = { key: 'date' | 'merchant' | 'amount'; dir: 1 | -1 };
const PAGE = 300;

export function Transactions() {
  const data = useData();
  const { today } = useSession();
  const { store } = useStore();
  const run = useRun();
  const ui = useUi();
  const toast = useToast();
  const { navigate, search } = useRouter();
  const cur = data.settings.baseCurrency;
  // Links from Budget and Reports arrive as /transactions?category=…&from=…&to=…
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const linked = params.has('from') || params.has('category');
  const colors = useMemo(() => categoryColors(data.categories), [data.categories]);

  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>(params.has('from') ? 'custom' : 'this');
  const [from, setFrom] = useState(params.get('from') ?? startOfMonth(today));
  const [to, setTo] = useState(params.get('to') ?? endOfMonth(today));
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState(params.get('category') ?? '');
  const [type, setType] = useState<'all' | 'expense' | 'income' | 'transfer'>('all');
  const [sort, setSort] = useState<Sort>({ key: 'date', dir: -1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);
  const tableRef = useRef<HTMLTableElement>(null);

  const range = useMemo((): [string, string] => {
    switch (period) {
      case 'this': return [startOfMonth(today), endOfMonth(today)];
      case 'last': { const s = startOfMonth(addDays(startOfMonth(today), -1)); return [s, endOfMonth(s)]; }
      case '90': return [addDays(today, -89), today];
      case 'year': return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
      case 'all': return ['0000-01-01', '9999-12-31'];
      case 'custom': return [from || '0000-01-01', to || '9999-12-31'];
    }
  }, [period, today, from, to]);

  const accounts = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const categories = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = data.transactions.filter((t) => {
      if (t.date < range[0] || t.date > range[1]) return false;
      if (accountId && t.accountId !== accountId) return false;
      if (categoryId === '__none' ? t.categoryId !== null || t.kind === 'transfer' || t.kind === 'adjustment' || (t.splits?.length ?? 0) > 0 : categoryId && t.categoryId !== categoryId && !t.splits?.some((s) => s.categoryId === categoryId)) return false;
      if (type === 'expense' && t.kind !== 'expense' && t.kind !== 'refund') return false;
      if (type === 'income' && t.kind !== 'income') return false;
      if (type === 'transfer' && t.kind !== 'transfer') return false;
      if (needle) {
        const hay = `${t.merchant} ${t.notes} ${t.provenance.rawDescription ?? ''} ${categories.get(t.categoryId ?? '')?.name ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    const dir = sort.dir;
    list.sort((a, b) => {
      if (sort.key === 'amount') return (a.amountCents - b.amountCents) * dir;
      if (sort.key === 'merchant') return a.merchant.localeCompare(b.merchant) * dir;
      return (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt) * dir;
    });
    return list;
  }, [data.transactions, range, accountId, categoryId, type, q, sort, categories]);

  const totals = useMemo(() => periodTotals(rows, '0000-01-01', '9999-12-31'), [rows]);
  const visible = rows.slice(0, limit);

  const remove = async (ids: string[]) => {
    const seen = new Set<string>();
    const r = await run((ctx) => {
      const ops: Op[] = [];
      for (const id of ids) {
        const t = ctx.data.transactions.find((x) => x.id === id);
        if (!t || seen.has(t.transferGroupId ?? t.id)) continue;
        seen.add(t.transferGroupId ?? t.id);
        ops.push(...deleteTransaction(ctx, id));
      }
      return ops;
    }, { undoLabel: 'Delete' });
    if (r.ok) {
      setSelected(new Set());
      toast({ message: ids.length === 1 ? 'Transaction deleted' : `${ids.length} transactions deleted`, action: { label: 'Undo', run: () => void store.undo() } });
    }
  };

  const recategorize = async (cat: string | null) => {
    const ids = [...selected];
    const r = await run((ctx) => {
      const ops: Op[] = [];
      for (const id of ids) {
        const t = ctx.data.transactions.find((x) => x.id === id);
        if (!t || t.kind === 'transfer' || t.kind === 'adjustment' || t.splits?.length) continue;
        ops.push({ t: 'put', table: 'transactions', value: { ...t, categoryId: cat, updatedAt: ctx.now } });
      }
      return ops;
    }, { undoLabel: 'Recategorize' });
    if (r.ok) toast({ message: `Category updated for ${ids.length}`, action: { label: 'Undo', run: () => void store.undo() } });
  };

  // Keyboard: ↑/↓ to move, Enter/E to edit, Delete to delete.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [role="dialog"]') || document.querySelector('[role="dialog"]')) return;
      const idx = visible.findIndex((r) => r.id === cursor);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = visible[Math.max(0, Math.min(visible.length - 1, idx + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) {
          setCursor(next.id);
          document.querySelector(`[data-row="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
        }
      } else if ((e.key === 'Enter' || e.key === 'e' || e.key === 'E') && cursor) {
        e.preventDefault();
        ui.openAdd({ editId: cursor });
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && cursor) {
        e.preventDefault();
        void remove([cursor]);
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && store.canUndo) {
        e.preventDefault();
        void store.undo().then((l) => l && toast({ message: `Undone: ${l}` }));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const header = (key: Sort['key'], label: string, right = false) => (
    <th className={right ? 'right' : ''} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : key === 'merchant' ? 1 : -1 })}>
        {label} {sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  let lastMonth = '';
  const allChecked = visible.length > 0 && visible.every((r) => selected.has(r.id));

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{TERMS.tabs.transactions}</h1>
          <div className="sub muted t-callout">{rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}{period === 'this' ? ` in ${formatMonthYear(today)}` : ''}</div>
        </div>
        <div className="page-actions">
          {linked && <button className="btn btn-ghost" onClick={() => navigate('/transactions')}>Clear filters</button>}
          <button className="btn btn-secondary" onClick={() => navigate('/import')}><Upload size={15} /> {TERMS.importStatement}</button>
          <button className="btn btn-primary hide-mobile" onClick={() => ui.openAdd()}>{TERMS.addTransaction} <kbd>N</kbd></button>
        </div>
      </div>

      <div className="toolbar" role="search">
        <div className="search">
          <Search size={16} />
          <input id="tx-search" className="input" placeholder="Search merchants, notes, categories" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
        </div>
        <select className="select" value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">
          <option value="this">This month</option>
          <option value="last">Last month</option>
          <option value="90">Last 90 days</option>
          <option value="year">This year</option>
          <option value="all">All time</option>
          <option value="custom">Custom range</option>
        </select>
        {period === 'custom' && (
          <>
            <input className="input" style={{ width: 156, flex: 'none' }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <input className="input" style={{ width: 156, flex: 'none' }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
          </>
        )}
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)} aria-label="Account">
          <option value="">All accounts</option>
          {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          <option value="__none">Uncategorized</option>
          {data.categories.filter((c) => !c.archived || c.id === categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Type">
          <option value="all">All types</option>
          <option value="expense">Spending</option>
          <option value="income">Income</option>
          <option value="transfer">Transfers</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div className="banner" role="region" aria-label="Bulk actions">
          <strong>{selected.size} selected</strong>
          <span className="grow" />
          <div style={{ width: 220 }}><CategorySelect value={null} onChange={(v) => void recategorize(v)} kind="expense" /></div>
          <button className="btn btn-secondary btn-sm" onClick={() => void remove([...selected])}><Trash2 size={14} /> Delete</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="card flush">
        <div className="totals" data-testid="tx-totals">
          <div><div className="k">Income</div><div className="v pos num"><Money cents={totals.incomeCents} currency={cur} /></div></div>
          <div><div className="k">Spending</div><div className="v num"><Money cents={totals.spendingCents} currency={cur} /></div></div>
          <div><div className="k">Net</div><div className={`v num ${totals.netCents < 0 ? 'neg' : ''}`}><Money cents={totals.netCents} currency={cur} sign="always" /></div></div>
        </div>
        {rows.length === 0 ? (
          <div className="empty">
            <div className="ico"><ReceiptText size={24} /></div>
            <div className="t-headline">{data.transactions.length ? 'No transactions match these filters' : 'No transactions yet'}</div>
            <div className="t-callout">{data.transactions.length ? 'Try a different period or clear the search.' : 'Add your first purchase, or import a statement from your bank.'}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => ui.openAdd()}>{TERMS.addTransaction}</button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/import')}>{TERMS.importStatement}</button>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data" ref={tableRef}>
              <thead>
                <tr>
                  <th className="w-check"><input type="checkbox" aria-label="Select all" checked={allChecked} onChange={() => setSelected(allChecked ? new Set() : new Set(visible.map((r) => r.id)))} /></th>
                  {header('date', 'Date')}
                  {header('merchant', 'Merchant')}
                  <th className="col-cat">Category</th>
                  <th className="col-acct">Account</th>
                  {header('amount', 'Amount', true)}
                </tr>
              </thead>
              <tbody>
                {visible.flatMap((t) => {
                  const out = [];
                  const m = t.date.slice(0, 7);
                  if (sort.key === 'date' && m !== lastMonth) {
                    lastMonth = m;
                    const mt = periodTotals(rows.filter((r) => r.date.startsWith(m)), '0000-01-01', '9999-12-31');
                    out.push(
                      <tr key={`g${m}`} className="group">
                        <td className="w-check" />
                        <td colSpan={2}>{formatMonthYear(`${m}-01`)}</td>
                        <td className="col-cat" /><td className="col-acct" />
                        <td className="right num">{mt.count ? <Money cents={mt.netCents} currency={cur} sign="always" /> : ''}</td>
                      </tr>,
                    );
                  }
                  out.push(<Row key={t.id} t={t} />);
                  return out;
                })}
              </tbody>
            </table>
            {rows.length > limit && (
              <div className="row" style={{ justifyContent: 'center', padding: 14 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function Row({ t }: { t: Transaction }) {
    const cat = t.categoryId ? categories.get(t.categoryId) : undefined;
    const acct = accounts.get(t.accountId);
    const other = t.transferGroupId ? data.transactions.find((x) => x.transferGroupId === t.transferGroupId && x.id !== t.id) : undefined;
    const icon = t.kind === 'transfer' ? 'transfer' : t.kind === 'adjustment' ? 'adjustment' : cat?.icon;
    const name = t.kind === 'transfer' ? `${t.amountCents < 0 ? 'To' : 'From'} ${other ? accounts.get(other.accountId)?.name ?? '' : ''}` : t.merchant || (t.kind === 'income' ? 'Income' : '—');
    const catName = t.splits?.length ? t.splits.map((x) => categories.get(x.categoryId)?.name).join(', ') : t.kind === 'transfer' ? 'Transfer' : t.kind === 'adjustment' ? 'Adjustment' : cat?.name ?? 'Uncategorized';
    return (
      <tr
        data-row={t.id}
        aria-selected={cursor === t.id || selected.has(t.id)}
        onClick={() => setCursor(t.id)}
        onDoubleClick={() => ui.openAdd({ editId: t.id })}
      >
        <td className="w-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" aria-label={`Select ${t.merchant}`} checked={selected.has(t.id)} onChange={() => { const s = new Set(selected); if (s.has(t.id)) s.delete(t.id); else s.add(t.id); setSelected(s); }} />
        </td>
        <td className="num muted" style={{ whiteSpace: 'nowrap' }}>{formatShortDate(t.date)}</td>
        <td>
          <div className="tx-name">
            <span className={`cat-icon sm ${t.amountCents > 0 && t.kind !== 'transfer' ? 'inflow' : ''}`}><CategoryIcon name={icon} size={15} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn-link" onClick={() => ui.openAdd({ editId: t.id })}>{name}</button>
                {t.status === 'pending' && <span className="badge warn">Pending</span>}
                {t.kind === 'refund' && <span className="badge pos">Refund</span>}
                {t.kind === 'adjustment' && <span className="badge" title={t.adjustmentReason}>Adjustment</span>}
                {t.splits?.length ? <span className="badge">Split</span> : null}
                {t.provenance.source === 'import' && <span className="badge hide-mobile" title={t.provenance.rawDescription}>Imported</span>}
                {t.date > today && <span className="badge accent">Planned</span>}
              </div>
              <div className="tx-sub">{catName} · {acct?.name}</div>
            </div>
          </div>
        </td>
        <td className="col-cat">
          <span className="cat-cell">
            {t.kind !== 'transfer' && t.kind !== 'adjustment' && !t.splits?.length && <span className="dot" style={{ background: t.categoryId ? colors.get(t.categoryId) : undefined }} />}
            {t.kind === 'transfer' || cat || t.splits?.length ? catName : <span className="faint">Uncategorized</span>}
          </span>
        </td>
        <td className="muted col-acct">{acct?.name}</td>
        <td className={`right num ${t.amountCents > 0 && t.kind !== 'transfer' ? 'pos' : ''}`} style={{ fontWeight: 600 }}>
          <Money cents={t.amountCents} currency={cur} sign="always" />
        </td>
      </tr>
    );
  }
}
