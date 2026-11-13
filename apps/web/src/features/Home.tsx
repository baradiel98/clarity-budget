import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, CircleAlert, Info, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { backupDue, engineInput } from '@clarity/data';
import { buildDashboard, type UpcomingItem } from '@clarity/engine';
import { formatMonthYear, formatShortDate, formatWeekdayDate, INCOME_STATUS_LABEL, OCCURRENCE_STATUS_LABEL, TERMS } from '@clarity/shared';
import { useRouter } from '../lib/router';
import { useData, useSession, useStore } from '../state/session';
import { useUi } from '../state/ui';
import { ForecastChart } from '../ui/ForecastChart';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';

export function statusBadge(u: Pick<UpcomingItem, 'status' | 'isIncome'>) {
  const label = (u.isIncome ? INCOME_STATUS_LABEL : OCCURRENCE_STATUS_LABEL)[u.status];
  const tone = u.status === 'overdue' ? (u.isIncome ? 'warn' : 'neg') : u.status === 'estimated' || u.status === 'unknown' ? 'warn' : u.status === 'confirmed' ? 'pos' : '';
  return <span className={`badge ${tone}`}>{label}</span>;
}

export function Home() {
  const data = useData();
  const { today } = useSession();
  const ui = useUi();
  const { navigate } = useRouter();
  const cur = data.settings.baseCurrency;
  const d = useMemo(() => buildDashboard(engineInput(data, today)), [data, today]);
  const [lowMode, setLowMode] = useState<'month' | 'income'>('month');
  const { demo } = useStore();
  const backup = demo ? { due: false, reason: null } : backupDue(data, Date.now());
  const sts = d.safeToSpend;
  const lowest = lowMode === 'income' && d.lowestBeforeNextIncome ? d.lowestBeforeNextIncome : d.lowestThroughMonthEnd;

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="t-title1">{formatMonthYear(today)}</h1>
          <div className="sub muted t-callout">{formatWeekdayDate(today)}</div>
        </div>
        <button className="btn btn-primary" onClick={() => ui.openAdd()}><Plus size={16} /> {TERMS.addTransaction} <kbd>N</kbd></button>
      </div>

      {backup.due && (
        <div className="banner" role="note">
          <Info size={18} className="faint" />
          <span className="grow">{backup.reason} Back up to keep a copy you can restore on another device.</span>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings#backup')}>Back up now</button>
        </div>
      )}

      <div className="stack">
        {/* 1–2: headline numbers */}
        <div className="grid dash-top">
          <section className="card hero-card" aria-labelledby="h-me">
            <h2 className="card-title" id="h-me">{TERMS.projectedMonthEnd}</h2>
            <div className={`t-hero money ${d.monthEnd.cents < 0 ? 'neg' : ''}`} data-testid="month-end"><Money cents={d.monthEnd.cents} currency={cur} /></div>
            <div className="t-footnote muted">Based on your recorded balance, expected income, upcoming bills, and planned expenses.</div>
            <button className="btn-link" style={{ marginTop: 10 }} onClick={() => ui.explain(d.monthEnd.explanation)}>{TERMS.whyThisNumber}</button>
            <div className="facts">
              <div><div className="k">{TERMS.recordedBalance}</div><div className="v"><Money cents={d.balances.availableCashCents} currency={cur} /></div></div>
              <div><div className="k">Income expected</div><div className="v pos">{sumIn(d, 'in')}</div></div>
              <div><div className="k">Going out</div><div className="v">{sumIn(d, 'out')}</div></div>
            </div>
          </section>

          <section className="card" aria-labelledby="h-sts">
            <h2 className="card-title" id="h-sts">{TERMS.safeToSpend}</h2>
            <div className={`metric money ${sts.cents < 0 ? 'short' : ''}`} data-testid="safe-to-spend">
              {sts.cents < 0 ? <>{TERMS.shortBy} <Money cents={sts.shortfallCents} currency={cur} /></> : <Money cents={sts.cents} currency={cur} />}
            </div>
            <div className="t-footnote muted">
              Through {formatShortDate(sts.horizonEnd)}{sts.reserveCents > 0 ? <>, keeping <Money cents={sts.reserveCents} currency={cur} /> in reserve</> : ''}
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => ui.openAfford()}>{TERMS.canIAfford}</button>
              <button className="btn-link" onClick={() => ui.explain(sts.explanation)}>{TERMS.whyThisNumber}</button>
            </div>
            <div className="mini-lines">
              <div><span>Lowest point</span><span className={`num ${sts.lowPoint.cents < 0 ? 'neg' : ''}`}><Money cents={sts.lowPoint.cents} currency={cur} /> · {formatShortDate(sts.lowPoint.date)}</span></div>
              <div><span>Bills before then</span><span className="num"><Money cents={-sts.lowPoint.obligations.reduce((s, e) => s + e.cashDeltaCents, 0)} currency={cur} /></span></div>
              {sts.excludedIncome.length > 0 && <div><span>Income not counted</span><span>{sts.excludedIncome.length} item{sts.excludedIncome.length > 1 ? 's' : ''}</span></div>}
            </div>
          </section>

          <section className="card" aria-labelledby="h-cash">
            <h2 className="card-title" id="h-cash">{TERMS.availableCash}</h2>
            <div className="metric money" data-testid="available-cash"><Money cents={d.balances.availableCashCents} currency={cur} /></div>
            <div className="t-footnote muted">
              {d.balances.cardOwedCents > 0 ? <><Money cents={d.balances.cardOwedCents} currency={cur} /> {TERMS.cardOwed.toLowerCase()}</> : 'Across your spendable accounts'}
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn-link" onClick={() => ui.explain(d.recordedBalanceExplanation)}>{TERMS.whyThisNumber}</button>
            </div>
            <div className="mini-lines">
              {d.balances.lines.slice(0, 4).map((l) => (
                <div key={l.accountId}>
                  <span>{l.name}{l.type === 'credit_card' ? ' (owed)' : !l.countsAsCash ? ' (not spendable)' : ''}</span>
                  <span className="num"><Money cents={l.type === 'credit_card' ? -l.balanceCents : l.balanceCents} currency={cur} /></span>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* 3: where the money is heading */}
        <div className={`grid ${d.warnings.length ? 'dash-mid' : ''}`}>
          <section className="card" aria-labelledby="h-fc">
            <div className="card-head">
              <h2 className="card-title" id="h-fc">Where your cash is heading</h2>
              {d.lowestBeforeNextIncome && (
                <Segmented label="Lowest balance window" value={lowMode} onChange={setLowMode} options={[{ value: 'month', label: 'Through month-end' }, { value: 'income', label: 'Before next income' }]} />
              )}
            </div>
            <ForecastChart forecast={d.forecast} currency={cur} low={lowest} monthEnd={d.monthEnd.date} reserve={data.settings.minReserveCents} />
            <div className="facts">
              <div>
                <div className="k">{lowMode === 'income' && d.lowestBeforeNextIncome ? TERMS.lowestBeforeIncome : TERMS.lowestBalance}</div>
                <div className={`v ${lowest.cents < 0 ? 'neg' : ''}`} data-testid="lowest"><Money cents={lowest.cents} currency={cur} /> <span className="faint t-footnote">on {formatShortDate(lowest.date)}</span></div>
              </div>
              <div><div className="k">{TERMS.endOfDay}</div><div className="v"><Money cents={d.endOfDay.cents} currency={cur} /></div></div>
              <div>
                <div className="k">Next income</div>
                <div className="v">{d.nextIncome ? <>{formatShortDate(d.nextIncome.date)} · <Money cents={d.nextIncome.amountCents} currency={cur} /></> : <span className="faint">None scheduled</span>}</div>
              </div>
            </div>
            <p className="t-footnote muted" style={{ marginBottom: 0 }}>
              {lowest.explanation.summary} <button className="btn-link" onClick={() => ui.explain(lowest.explanation)}>{TERMS.whyThisNumber}</button>
            </p>
          </section>

          {/* 4: warnings (only when present) */}
          {d.warnings.length > 0 && (
            <section className="card" aria-labelledby="h-warn" data-testid="warnings">
              <h2 className="card-title" id="h-warn">Needs attention</h2>
              <div>
                {d.warnings.slice(0, 5).map((w) => (
                  <div key={w.id} className="warning-row">
                    {w.severity === 'critical' ? <CircleAlert size={18} className="neg" /> : w.severity === 'warning' ? <AlertTriangle size={18} className="warn" /> : <Info size={18} className="faint" />}
                    <div>
                      <div className="t">{w.title}</div>
                      <div className="d">{w.detail}</div>
                    </div>
                  </div>
                ))}
                {d.warnings.length > 5 && <button className="btn-link" onClick={() => navigate('/planning')}>{d.warnings.length - 5} more in Planning</button>}
              </div>
            </section>
          )}
        </div>

        {/* 5: upcoming */}
        <section className="card" aria-labelledby="h-up">
          <div className="card-head">
            <h2 className="card-title" id="h-up">{TERMS.upcoming} · next 14 days</h2>
            <button className="btn-link" onClick={() => navigate('/planning')}>Open Planning</button>
          </div>
          {d.upcoming.length === 0 ? (
            <div className="empty">
              <CalendarClock size={28} />
              <div>No bills, paychecks or planned expenses in the next two weeks.</div>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/planning')}>Add a bill or income</button>
            </div>
          ) : (
            <div className="list" data-testid="upcoming">
              {d.upcoming.map((u) => (
                <div key={u.id} className="list-row">
                  <div className={`cat-icon ${u.isIncome ? 'inflow' : ''}`}>{u.isIncome ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</div>
                  <div>
                    <div className="title">{u.label}</div>
                    <div className="meta">{formatWeekdayDate(u.date)} {statusBadge(u)}</div>
                  </div>
                  <div className="row">
                    <span className={`num ${u.cents > 0 ? 'pos' : ''}`} style={{ fontWeight: 600 }}>
                      {u.status === 'unknown' ? <span className="faint">—</span> : <Money cents={u.cents} currency={cur} sign="always" />}
                    </span>
                    {u.occurrence && u.status !== 'skipped' && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() =>
                          ui.openAdd({
                            occurrenceRef: { recurringId: u.occurrence!.recurringId, originalDate: u.occurrence!.originalDate },
                            occurrenceName: u.label,
                            amountCents: u.occurrence!.amountCents || undefined,
                          })
                        }
                      >
                        {u.isIncome ? 'Record' : 'Mark paid'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );

  function sumIn(dash: typeof d, dir: 'in' | 'out') {
    let total = 0;
    for (const day of dash.forecast.days) {
      if (day.date > dash.monthEnd.date) break;
      for (const e of day.events) if (dir === 'in' ? e.cashDeltaCents > 0 : e.cashDeltaCents < 0) total += e.cashDeltaCents;
    }
    return <Money cents={dir === 'out' ? -total : total} currency={cur} />;
  }
}
