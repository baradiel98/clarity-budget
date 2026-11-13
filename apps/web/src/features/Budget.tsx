import { AlertTriangle, ChevronLeft, ChevronRight, PieChart } from 'lucide-react';
import { useMemo, useState } from 'react';
import { updateCategory } from '@clarity/data';
import { budgetSummary, type BudgetRow } from '@clarity/engine';
import { centsToDecimalString, daysInMonth, endOfMonth, formatMonthYear, parseAmountInput, parseISO, type Cents } from '@clarity/shared';
import { useRouter } from '../lib/router';
import { useData, useRun, useSession } from '../state/session';
import { categoryColors } from '../ui/categoryColor';
import { CategoryIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { useToast } from '../ui/Toast';

const shiftMonth = (month: string, by: number) => {
  const idx = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${String(Math.floor(idx / 12)).padStart(4, '0')}-${String((idx % 12) + 1).padStart(2, '0')}`;
};

/** Monthly budget per category against actual spending. All figures come from the engine's budgetSummary. */
export function Budget() {
  const data = useData();
  const { today } = useSession();
  const { navigate } = useRouter();
  const cur = data.settings.baseCurrency;
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);
  const go = (step: 1 | -1) => { setDir(step > 0 ? 'next' : 'prev'); setMonth(shiftMonth(month, step)); };
  const from = `${month}-01`;
  const to = endOfMonth(from);
  const b = useMemo(() => budgetSummary(data.categories, data.transactions, from, to), [data.categories, data.transactions, from, to]);
  const colors = useMemo(() => categoryColors(data.categories), [data.categories]);
  const groups = useMemo(() => {
    const m = new Map<string, BudgetRow[]>();
    for (const r of b.rows) m.set(r.group, [...(m.get(r.group) ?? []), r]);
    return [...m];
  }, [b.rows]);
  const isCurrent = month === thisMonth;
  const { y, m, d } = parseISO(isCurrent ? today : to);
  const monthPct = Math.round((d * 100) / daysInMonth(y, m));
  const totalPct = b.budgetedCents > 0 ? Math.min(100, Math.round((Math.max(0, b.spentBudgetedCents) * 100) / b.budgetedCents)) : 0;
  const open = (categoryId: string) => navigate(`/transactions?category=${categoryId}&from=${from}&to=${to}`);
  const anyBudget = b.rows.some((r) => r.budgetCents !== null);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Budget</h1>
          <div className="sub muted t-callout">A monthly amount for each category you want to keep an eye on. Budgets repeat every month.</div>
        </div>
        <div className="month-nav" role="group" aria-label="Month">
          <button className="icon-btn" aria-label="Previous month" onClick={() => go(-1)}><ChevronLeft size={18} /></button>
          <span className="label" aria-live="polite">{formatMonthYear(from)}</span>
          <button className="icon-btn" aria-label="Next month" disabled={month >= thisMonth} onClick={() => go(1)}><ChevronRight size={18} /></button>
        </div>
      </div>

      <div className="stack month-body" key={month} data-dir={dir ?? undefined}>
        <section className="card" aria-label="Budget summary">
          <div className="summary">
            <div>
              <div className="k">{b.remainingCents < 0 ? 'Over budget' : 'Left to spend'}</div>
              <div className={`v money ${b.remainingCents < 0 ? 'neg' : ''}`} data-testid="budget-left"><Money cents={Math.abs(b.remainingCents)} currency={cur} animate /></div>
              <div className="s">{anyBudget ? (b.overCount > 0 ? `${b.overCount} ${b.overCount === 1 ? 'category is' : 'categories are'} over budget` : 'Every budgeted category is within its amount') : 'No budgets set yet'}</div>
            </div>
            <div>
              <div className="k">Budgeted</div>
              <div className="v money" data-testid="budget-total"><Money cents={b.budgetedCents} currency={cur} animate /></div>
              <div className="s">per month</div>
            </div>
            <div>
              <div className="k">Spent</div>
              <div className="v money" data-testid="budget-spent"><Money cents={b.spentBudgetedCents} currency={cur} animate /></div>
              <div className="s">{b.spentUnbudgetedCents > 0 ? <>plus <Money cents={b.spentUnbudgetedCents} currency={cur} /> not budgeted</> : 'in budgeted categories'}</div>
            </div>
          </div>
          <div className={`meter lg ${b.remainingCents < 0 ? 'over' : ''}`} role="img" aria-label={anyBudget ? `${totalPct}% of the budget spent${isCurrent ? `, ${monthPct}% of the month gone` : ''}` : 'No budget set'}>
            <span style={{ width: `${totalPct}%` }} />
            {isCurrent && anyBudget && <i style={{ left: `${monthPct}%` }} />}
          </div>
          {isCurrent && anyBudget && <p className="hint" style={{ marginTop: 8 }}>The small mark shows how far through the month you are ({monthPct}%).</p>}
        </section>

        <section className="card" aria-label="Categories">
          {!anyBudget && (
            <div className="callout" style={{ marginBottom: 8 }}>
              <PieChart size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              Type an amount in the Budget column for any category. Leave it empty for categories you don't want to track.
            </div>
          )}
          <div className="budget-row head" aria-hidden>
            <span>Category</span><span>Progress</span><span className="right">Spent</span><span className="right">Budget</span><span className="right">Left</span>
          </div>
          {groups.map(([group, rows]) => (
            <div key={group} role="group" aria-label={group}>
              <div className="budget-group">{group}</div>
              {rows.map((r) => <Row key={r.categoryId} r={r} />)}
            </div>
          ))}
          {b.uncategorizedCents > 0 && (
            <div>
              <div className="budget-group">Uncategorized</div>
              <div className="budget-row">
                <span className="name"><span className="cat-icon sm"><CategoryIcon name="tag" size={15} /></span><button onClick={() => open('__none')}>Uncategorized spending</button></span>
                <span className="col-meter" />
                <span className="right num col-spent"><Money cents={b.uncategorizedCents} currency={cur} /></span>
                <span />
                <span className="right col-left faint">Not budgeted</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );

  function Row({ r }: { r: BudgetRow }) {
    const pct = r.budgetCents && r.budgetCents > 0 ? Math.min(100, Math.round((Math.max(0, r.spentCents) * 100) / r.budgetCents)) : r.over ? 100 : 0;
    const idle = r.budgetCents === null && r.spentCents === 0;
    return (
      <div className={`budget-row ${idle ? 'idle' : ''}`} data-testid={`budget-${r.categoryId}`}>
        <span className="name">
          <span className="cat-icon sm" style={{ color: colors.get(r.categoryId) }}><CategoryIcon name={r.icon} size={15} /></span>
          <button onClick={() => open(r.categoryId)} aria-label={`${r.name}: view transactions`}>{r.name}</button>
        </span>
        <span className="col-meter">
          {r.budgetCents !== null && (
            <div className={`meter ${r.over ? 'over' : ''}`} role="img" aria-label={`${pct}% of budget spent`}>
              <span style={{ width: `${pct}%` }} />
              {isCurrent && <i style={{ left: `${monthPct}%` }} />}
            </div>
          )}
        </span>
        <span className="right num col-spent"><span className="sr-only">Spent </span><Money cents={r.spentCents} currency={cur} /></span>
        <BudgetInput key={`${r.categoryId}:${r.budgetCents}`} row={r} />
        <span className="right col-left">
          {r.remainingCents === null ? (
            <span className="faint">{r.spentCents > 0 ? 'Not budgeted' : '—'}</span>
          ) : r.over ? (
            <span key="over" className="left-text neg value-in"><AlertTriangle size={14} /> Over by <Money cents={-r.remainingCents} currency={cur} animate /></span>
          ) : (
            <span key="left" className="left-text"><Money cents={r.remainingCents} currency={cur} animate /> left</span>
          )}
        </span>
      </div>
    );
  }
}

function BudgetInput({ row }: { row: BudgetRow }) {
  const data = useData();
  const run = useRun();
  const toast = useToast();
  const cur = data.settings.baseCurrency;
  const initial = row.budgetCents === null ? '' : centsToDecimalString(row.budgetCents);
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const commit = async () => {
    const text = value.trim();
    if (text === initial) return;
    const next: Cents | null = text === '' ? null : parseAmountInput(text, cur);
    if (text !== '' && next === null) return setInvalid(true);
    setInvalid(false);
    const r = await run((ctx) => updateCategory(ctx, row.categoryId, { budgetCents: next }), { undoLabel: `Budget for ${row.name}` });
    if (!r.ok) {
      setInvalid(true);
      toast({ message: r.errors[0]?.message ?? 'Could not save the budget', tone: 'error' });
    }
  };
  return (
    <input
      className="input num"
      inputMode="decimal"
      placeholder="Set"
      aria-label={`Monthly budget for ${row.name}`}
      aria-invalid={invalid}
      value={value}
      onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setValue(initial);
      }}
    />
  );
}
