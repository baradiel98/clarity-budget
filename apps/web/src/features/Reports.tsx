import { BarChart3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { monthlySeries, monthsEnding, spendingByCategory } from '@clarity/engine';
import { endOfMonth, formatCents, formatMonthYear, minISO, monthNameShort, TERMS } from '@clarity/shared';
import { useRouter } from '../lib/router';
import { useData, useSession } from '../state/session';
import { useUi } from '../state/ui';
import { categoryColors } from '../ui/categoryColor';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';

/** Income vs spending by month and spending by category. Only recorded transactions; nothing estimated. */
export function Reports() {
  const data = useData();
  const { today } = useSession();
  const { navigate } = useRouter();
  const ui = useUi();
  const cur = data.settings.baseCurrency;
  const [span, setSpan] = useState<'6' | '12'>('6');
  const months = useMemo(() => monthsEnding(today, Number(span)), [today, span]);
  const series = useMemo(() => monthlySeries(data.transactions, months, today), [data.transactions, months, today]);
  const [picked, setPicked] = useState<string | null>(null);
  const sel = picked && months.includes(picked) ? picked : months[months.length - 1]!;
  const from = `${sel}-01`;
  const to = minISO(endOfMonth(from), today);
  const colors = useMemo(() => categoryColors(data.categories), [data.categories]);
  const byCat = useMemo(() => {
    const m = spendingByCategory(data.transactions, from, to);
    const names = new Map(data.categories.map((c) => [c.id, c.name]));
    const rows = [...m].filter(([, v]) => v > 0).map(([id, v]) => ({ id, name: id ? names.get(id) ?? 'Unknown category' : 'Uncategorized', cents: v }));
    rows.sort((a, b) => b.cents - a.cents);
    return rows;
  }, [data.transactions, data.categories, from, to]);
  const catTotal = byCat.reduce((s, r) => s + r.cents, 0);
  const max = Math.max(1, ...series.map((p) => Math.max(p.incomeCents, p.spendingCents)));
  const totals = series.reduce((a, p) => ({ income: a.income + p.incomeCents, spending: a.spending + p.spendingCents }), { income: 0, spending: 0 });
  const hasAny = series.some((p) => p.count > 0);
  const label = (month: string) => `${monthNameShort(Number(month.slice(5, 7)))}${month.endsWith('-01') || month === months[0] ? ` ’${month.slice(2, 4)}` : ''}`;
  const selPoint = series.find((p) => p.month === sel)!;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <div className="sub muted t-callout">What you recorded: income, spending and where it went. Transfers between your accounts are never counted.</div>
        </div>
        <Segmented label="Period" value={span} onChange={setSpan} options={[{ value: '6', label: '6 months' }, { value: '12', label: '12 months' }]} />
      </div>

      {!hasAny ? (
        <div className="card empty">
          <div className="ico"><BarChart3 size={24} /></div>
          <div className="t-headline">Nothing to report yet</div>
          <div className="t-callout">Reports appear once you add or import transactions.</div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={() => ui.openAdd()}>{TERMS.addTransaction}</button>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate('/import')}>{TERMS.importStatement}</button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="grid dash-mid">
            <section className="card" aria-labelledby="r-ie">
              <div className="card-head">
                <h2 className="card-title" id="r-ie">Income and spending</h2>
                <div className="legend" style={{ marginTop: 0 }} aria-hidden><span><i className="in" /> Income</span><span><i className="spend" /> Spending</span></div>
              </div>
              <div className="bars" role="group" aria-label="Months. Choose one to see its categories.">
                {series.map((p, i) => (
                  <button key={p.month} className="bar-col" aria-pressed={p.month === sel} onClick={() => setPicked(p.month)} data-testid={`bar-${p.month}`}
                    aria-label={`${formatMonthYear(`${p.month}-01`)}: income ${formatCents(p.incomeCents, cur)}, spending ${formatCents(p.spendingCents, cur)}`}
                    title={`${formatMonthYear(`${p.month}-01`)}\nIncome ${formatCents(p.incomeCents, cur)}\nSpending ${formatCents(p.spendingCents, cur)}`}>
                    <span className="bar-pair">
                      <span className="bar in" style={{ height: `${(p.incomeCents * 100) / max}%`, ['--i' as string]: i }} />
                      <span className="bar out" style={{ height: `${(Math.max(0, p.spendingCents) * 100) / max}%`, ['--i' as string]: i }} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="bar-labels" aria-hidden>{series.map((p) => <span key={p.month} className={p.month === sel ? 'on' : ''}>{label(p.month)}</span>)}</div>
            </section>

            <section className="card" aria-labelledby="r-sel">
              <div className="card-head"><h2 className="card-title" id="r-sel">{formatMonthYear(from)}{sel === today.slice(0, 7) ? ' so far' : ''}</h2></div>
              <div className="eq" style={{ margin: 0 }}>
                <div><span>Income</span><span className="num pos"><Money cents={selPoint.incomeCents} currency={cur} /></span></div>
                <div><span>Spending</span><span className="num"><Money cents={selPoint.spendingCents} currency={cur} /></span></div>
                <div className="total"><span>Net</span><span className={`num ${selPoint.netCents < 0 ? 'neg' : ''}`} data-testid="report-net"><Money cents={selPoint.netCents} currency={cur} sign="always" /></span></div>
              </div>
              <button className="btn-link" onClick={() => navigate(`/transactions?from=${from}&to=${to}`)}>View these transactions</button>
            </section>
          </div>

          <div className="grid cols-2">
            <section className="card" aria-labelledby="r-cat">
              <div className="card-head">
                <h2 className="card-title" id="r-cat">Spending by category <span className="faint" style={{ fontWeight: 500 }}>· {formatMonthYear(from)}</span></h2>
              </div>
              {byCat.length === 0 ? (
                <p className="t-callout muted">No spending recorded in this month.</p>
              ) : (
                <div data-testid="report-categories">
                  {byCat.map((r) => (
                    <button key={r.id ?? 'none'} className="hbar" onClick={() => navigate(`/transactions?category=${r.id ?? '__none'}&from=${from}&to=${to}`)} aria-label={`${r.name}: ${formatCents(r.cents, cur)}, ${Math.round((r.cents * 100) / catTotal)}% of spending. View transactions.`}>
                      <span className="name"><span className="dot" style={{ background: r.id ? colors.get(r.id) : undefined }} /> {r.name}</span>
                      <span className="num" style={{ fontWeight: 600 }}><Money cents={r.cents} currency={cur} /><span className="pct">{Math.round((r.cents * 100) / catTotal)}%</span></span>
                      <span className="track"><span className="fill" style={{ width: `${(r.cents * 100) / byCat[0]!.cents}%`, background: r.id ? colors.get(r.id) : 'var(--c-chart-neutral)' }} /></span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="card flush" aria-labelledby="r-tbl">
              <div style={{ padding: '22px 24px 8px' }}><h2 className="card-title" id="r-tbl">Month by month</h2></div>
              <div className="table-wrap">
                <table className="data" data-testid="report-table">
                  <thead><tr><th>Month</th><th className="right">Income</th><th className="right">Spending</th><th className="right">Net</th></tr></thead>
                  <tbody>
                    {[...series].reverse().map((p) => (
                      <tr key={p.month} aria-selected={p.month === sel} onClick={() => setPicked(p.month)} style={{ cursor: 'pointer' }}>
                        <td>{formatMonthYear(`${p.month}-01`)}{p.month === today.slice(0, 7) ? <span className="faint"> · so far</span> : ''}</td>
                        <td className="right num">{p.count ? <Money cents={p.incomeCents} currency={cur} /> : <span className="faint">—</span>}</td>
                        <td className="right num">{p.count ? <Money cents={p.spendingCents} currency={cur} /> : <span className="faint">—</span>}</td>
                        <td className={`right num ${p.netCents < 0 ? 'neg' : ''}`} style={{ fontWeight: 600 }}>{p.count ? <Money cents={p.netCents} currency={cur} sign="always" /> : <span className="faint">—</span>}</td>
                      </tr>
                    ))}
                    <tr className="group">
                      <td>Total, {span} months</td>
                      <td className="right num"><Money cents={totals.income} currency={cur} /></td>
                      <td className="right num"><Money cents={totals.spending} currency={cur} /></td>
                      <td className="right num"><Money cents={totals.income - totals.spending} currency={cur} sign="always" /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
