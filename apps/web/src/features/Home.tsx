import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, CircleAlert, CircleHelp, Info, Plus, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import { backupDue, engineInput } from '@clarity/data';
import { buildDashboard, buildForecast, cashHistory, type Explanation, type UpcomingItem } from '@clarity/engine';
import { addDays, formatMonthYear, formatShortDate, formatWeekdayDate, INCOME_STATUS_LABEL, OCCURRENCE_STATUS_LABEL, TERMS } from '@clarity/shared';
import { useRouter } from '../lib/router';
import { useData, useSession, useStore } from '../state/session';
import { useUi } from '../state/ui';
import { ForecastChart } from '../ui/ForecastChart';
import { CategoryIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';

export function statusBadge(u: Pick<UpcomingItem, 'status' | 'isIncome'>) {
  const label = (u.isIncome ? INCOME_STATUS_LABEL : OCCURRENCE_STATUS_LABEL)[u.status];
  const tone = u.status === 'overdue' ? (u.isIncome ? 'warn' : 'neg') : u.status === 'estimated' || u.status === 'unknown' ? 'warn' : u.status === 'confirmed' ? 'pos' : '';
  return <span className={`badge ${tone}`}>{label}</span>;
}

type Range = 'month' | '30' | '90';

export function Home() {
  const data = useData();
  const { today } = useSession();
  const { demo } = useStore();
  const ui = useUi();
  const { navigate } = useRouter();
  const cur = data.settings.baseCurrency;
  const d = useMemo(() => buildDashboard(engineInput(data, today)), [data, today]);
  const [range, setRange] = useState<Range>('month');
  const backup = demo ? { due: false, reason: null } : backupDue(data, Date.now());
  const sts = d.safeToSpend;

  const forecast = useMemo(
    () =>
      range === 'month'
        ? d.forecast
        : buildForecast({ today, horizonEnd: addDays(today, Number(range)), accounts: data.accounts, transactions: data.transactions, recurring: data.recurring, exceptions: data.exceptions, baseCurrency: cur, includeEstimatedIncome: true }),
    [range, d.forecast, data, today, cur],
  );
  const history = useMemo(() => cashHistory(data.accounts, data.transactions, addDays(today, -14), addDays(today, -1), cur), [data.accounts, data.transactions, today, cur]);

  const delta = d.monthEnd.cents - d.balances.availableCashCents;
  const billsBefore = sts.lowPoint.obligations.reduce((s, e) => s + e.cashDeltaCents, 0);
  const incomeBefore = sts.lowPoint.incomeBefore.reduce((s, e) => s + e.cashDeltaCents, 0);
  const cats = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
  const recent = useMemo(
    () => data.transactions.filter((t) => t.date <= today && (t.kind !== 'transfer' || t.amountCents < 0)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt)).slice(0, 6),
    [data.transactions, today],
  );

  const Why = ({ ex, label }: { ex: Explanation; label: string }) => (
    <button className="why" aria-label={`${TERMS.whyThisNumber} ${label}`} title={TERMS.whyThisNumber} onClick={() => ui.explain(ex)}>
      <CircleHelp size={15} />
    </button>
  );

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{formatMonthYear(today)}</h1>
          <div className="sub muted t-callout">{formatWeekdayDate(today)}</div>
        </div>
        <div className="page-actions hide-mobile">
          <button className="btn btn-primary" onClick={() => ui.openAdd()}><Plus size={16} /> {TERMS.addTransaction} <kbd>N</kbd></button>
        </div>
      </div>

      {backup.due && (
        <div className="banner" role="note">
          <Info size={18} className="faint" />
          <span className="grow">{backup.reason} Back up to keep a copy you can restore on another device.</span>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings#backup')}>Back up now</button>
        </div>
      )}

      <div className="stack">
        <div className="overview">
          {/* 1. Where you are heading */}
          <section className="card outlook" aria-labelledby="h-me">
            <div className="row between wrap">
              <h2 className="overline" id="h-me">{TERMS.projectedMonthEnd}</h2>
              <Segmented label="Chart range" value={range} onChange={setRange} options={[{ value: 'month', label: 'Month-end' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            </div>
            <div className={`t-hero money ${d.monthEnd.cents < 0 ? 'neg' : ''}`} data-testid="month-end"><Money cents={d.monthEnd.cents} currency={cur} /></div>
            <div className="delta">
              {delta >= 0 ? <TrendingUp size={16} className="pos" /> : <TrendingDown size={16} className="neg" />}
              <span>
                <Money cents={Math.abs(delta)} currency={cur} /> {delta >= 0 ? 'more' : 'less'} than you have today, by {formatShortDate(d.monthEnd.date)}.{' '}
                <button className="btn-link" onClick={() => ui.explain(d.monthEnd.explanation)}>{TERMS.whyThisNumber}</button>
              </span>
            </div>
            <ForecastChart history={history} forecast={forecast} currency={cur} reserve={data.settings.minReserveCents} monthEnd={d.monthEnd.date} />
          </section>

          <div className="side">
          {/* 2. Safe to Spend: the signature number, with its own arithmetic from the engine */}
          <section className="card sts" aria-labelledby="h-sts">
            <h2 className="overline" id="h-sts">{TERMS.safeToSpend}</h2>
            <div className={`metric money ${sts.cents < 0 ? 'short' : ''}`} data-testid="safe-to-spend">
              {sts.cents < 0 ? <>{TERMS.shortBy} <Money cents={sts.shortfallCents} currency={cur} /></> : <Money cents={sts.cents} currency={cur} />}
            </div>
            <p className="t-callout muted">
              {sts.cents < 0 ? 'What is scheduled is more than your cash and reserve cover' : 'What you can spend today and still cover everything scheduled'} through {formatShortDate(sts.horizonEnd)}.
            </p>
            <div className="eq" data-testid="sts-breakdown">
              <div><span>{TERMS.availableCash} now</span><span className="num"><Money cents={sts.availableCashCents} currency={cur} /></span></div>
              {incomeBefore !== 0 && <div><span>Income before the lowest point <span className="sub">({sts.lowPoint.incomeBefore.length})</span></span><span className="num pos"><Money cents={incomeBefore} currency={cur} sign="always" /></span></div>}
              {billsBefore !== 0 && <div><span>Bills and transfers through {formatShortDate(sts.lowPoint.date)} <span className="sub">({sts.lowPoint.obligations.length})</span></span><span className="num"><Money cents={billsBefore} currency={cur} sign="always" /></span></div>}
              <div><span>Lowest point <span className="sub">· {formatShortDate(sts.lowPoint.date)}</span></span><span className={`num ${sts.lowPoint.cents < 0 ? 'neg' : ''}`}><Money cents={sts.lowPoint.cents} currency={cur} /></span></div>
              <div><span>{TERMS.minReserve}</span><span className="num"><Money cents={-sts.reserveCents} currency={cur} sign={sts.reserveCents ? 'always' : 'auto'} /></span></div>
              <div className="total"><span>{sts.cents < 0 ? TERMS.shortBy : TERMS.safeToSpend}</span><span className={`num ${sts.cents < 0 ? 'neg' : ''}`}><Money cents={sts.cents < 0 ? sts.shortfallCents : sts.cents} currency={cur} /></span></div>
            </div>
            {sts.excludedIncome.length > 0 && <p className="hint" style={{ marginBottom: 14 }}>{sts.excludedIncome.length} income item{sts.excludedIncome.length > 1 ? 's are' : ' is'} not counted because the amount is estimated, unknown or not yet recorded.</p>}
            <div className="sts-actions">
              <button className="btn btn-secondary" onClick={() => ui.openAfford()}>{TERMS.canIAfford}</button>
              <button className="btn-link" data-testid="why-sts" onClick={() => ui.explain(sts.explanation)}>{TERMS.whyThisNumber}</button>
            </div>
          </section>
          <section className="card next-income" aria-label="Next income">
            <div className={`cat-icon ${d.nextIncome ? 'inflow' : ''}`}><ArrowDownLeft size={17} /></div>
            {d.nextIncome ? (
              <>
                <div style={{ minWidth: 0 }}>
                  <div className="overline">Next income</div>
                  <div className="t-callout">{d.nextIncome.name} · {formatWeekdayDate(d.nextIncome.date)}</div>
                </div>
                <div className="num pos" style={{ fontWeight: 600 }}><Money cents={d.nextIncome.amountCents} currency={cur} sign="always" /></div>
              </>
            ) : (
              <div style={{ minWidth: 0 }}>
                <div className="overline">Next income</div>
                <div className="t-callout muted">None with a known amount is scheduled. <button className="btn-link" onClick={() => navigate('/planning')}>Add income</button></div>
              </div>
            )}
          </section>
          </div>
        </div>

        {/* 3. Supporting figures */}
        <section className="stats" aria-label="Key balances">
          <div className="stat">
            <div className="k">{TERMS.recordedBalance} <Why ex={d.recordedBalanceExplanation} label={TERMS.recordedBalance} /></div>
            <div className="v money" data-testid="available-cash"><Money cents={d.balances.availableCashCents} currency={cur} /></div>
            <div className="s">{d.balances.cardOwedCents > 0 ? <><Money cents={d.balances.cardOwedCents} currency={cur} /> {TERMS.cardOwed.toLowerCase()}</> : 'Across spendable accounts'}</div>
          </div>
          <div className="stat">
            <div className="k">{TERMS.lowestBalance} <Why ex={d.lowestThroughMonthEnd.explanation} label={TERMS.lowestBalance} /></div>
            <div className={`v money ${d.lowestThroughMonthEnd.cents < 0 ? 'neg' : ''}`} data-testid="lowest"><Money cents={d.lowestThroughMonthEnd.cents} currency={cur} /></div>
            <div className="s">{formatShortDate(d.lowestThroughMonthEnd.date)} · through month-end</div>
          </div>
          <div className="stat">
            <div className="k">{TERMS.lowestBeforeIncome} {d.lowestBeforeNextIncome && <Why ex={d.lowestBeforeNextIncome.explanation} label={TERMS.lowestBeforeIncome} />}</div>
            {d.lowestBeforeNextIncome ? (
              <>
                <div className={`v money ${d.lowestBeforeNextIncome.cents < 0 ? 'neg' : ''}`}><Money cents={d.lowestBeforeNextIncome.cents} currency={cur} /></div>
                <div className="s">{formatShortDate(d.lowestBeforeNextIncome.date)} · next income {formatShortDate(d.lowestBeforeNextIncome.nextIncome.date)}</div>
              </>
            ) : (
              <>
                <div className="v faint">—</div>
                <div className="s">No income with a known amount is scheduled</div>
              </>
            )}
          </div>
          <div className="stat">
            <div className="k">{TERMS.endOfDay} <Why ex={d.endOfDay.explanation} label={TERMS.endOfDay} /></div>
            <div className={`v money ${d.endOfDay.cents < 0 ? 'neg' : ''}`}><Money cents={d.endOfDay.cents} currency={cur} /></div>
            <div className="s">After anything scheduled today</div>
          </div>
        </section>

        <div className="grid cols-2">
          {/* 4. What is coming */}
          <section className="card" aria-labelledby="h-up">
            <div className="card-head">
              <h2 className="card-title" id="h-up">{TERMS.upcoming} <span className="faint" style={{ fontWeight: 500 }}>· next 14 days</span></h2>
              <button className="btn-link" onClick={() => navigate('/planning')}>Open Planning</button>
            </div>
            {d.upcoming.length === 0 ? (
              <div className="empty">
                <div className="ico"><CalendarClock size={24} /></div>
                <div className="t-headline">Nothing scheduled</div>
                <div className="t-callout">No bills, paychecks or planned expenses in the next two weeks.</div>
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => navigate('/planning')}>Add a bill or income</button>
              </div>
            ) : (
              <div className="list" data-testid="upcoming">
                {d.upcoming.map((u) => (
                  <div key={u.id} className="list-row">
                    <div className={`cat-icon ${u.isIncome ? 'inflow' : ''}`}>{u.isIncome ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="title">{u.label}</div>
                      <div className="meta">{formatWeekdayDate(u.date)} {statusBadge(u)}{!u.affectsCash && <span>Charged to a card, not from cash</span>}</div>
                    </div>
                    <div className="row">
                      <span className={`num ${u.cents > 0 ? 'pos' : ''}`} style={{ fontWeight: 600 }}>
                        {u.status === 'unknown' ? <span className="faint">—</span> : <Money cents={u.cents} currency={cur} sign="always" />}
                      </span>
                      {u.occurrence && u.status !== 'skipped' && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => ui.openAdd({ occurrenceRef: { recurringId: u.occurrence!.recurringId, originalDate: u.occurrence!.originalDate }, occurrenceName: u.label, amountCents: u.occurrence!.amountCents || undefined })}
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

          <div className="stack" style={{ alignContent: 'start' }}>
            {/* 5. Things that need attention (only when there are any) */}
            {d.warnings.length > 0 && (
              <section className="card" aria-labelledby="h-warn" data-testid="warnings">
                <div className="card-head"><h2 className="card-title" id="h-warn">Needs attention</h2></div>
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
              </section>
            )}

            {/* 6. Recent activity */}
            <section className="card" aria-labelledby="h-recent">
              <div className="card-head">
                <h2 className="card-title" id="h-recent">Recent transactions</h2>
                <button className="btn-link" onClick={() => navigate('/transactions')}>View all</button>
              </div>
              {recent.length === 0 ? (
                <div className="empty" style={{ padding: '20px 0' }}>
                  <div className="t-callout">Nothing recorded yet. Add a purchase or import a statement.</div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => ui.openAdd()}>{TERMS.addTransaction}</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate('/import')}>{TERMS.importStatement}</button>
                  </div>
                </div>
              ) : (
                <div className="list" data-testid="recent">
                  {recent.map((t) => {
                    const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
                    const inflow = t.amountCents > 0 && t.kind !== 'transfer';
                    return (
                      <button key={t.id} className="list-row" onClick={() => ui.openAdd({ editId: t.id })} aria-label={`Edit ${t.merchant || t.kind}`}>
                        <span className={`cat-icon ${inflow ? 'inflow' : ''}`}><CategoryIcon name={t.kind === 'transfer' ? 'transfer' : t.kind === 'adjustment' ? 'adjustment' : cat?.icon} /></span>
                        <span style={{ minWidth: 0 }}>
                          <span className="title" style={{ display: 'block' }}>{t.kind === 'transfer' ? 'Transfer' : t.merchant || (t.kind === 'income' ? 'Income' : '—')}</span>
                          <span className="meta">{formatShortDate(t.date)} · {t.kind === 'transfer' ? 'Between accounts' : cat?.name ?? 'Uncategorized'}</span>
                        </span>
                        <span className={`num ${inflow ? 'pos' : ''}`} style={{ fontWeight: 600 }}><Money cents={t.kind === 'transfer' ? Math.abs(t.amountCents) : t.amountCents} currency={cur} sign={t.kind === 'transfer' ? 'never' : 'always'} /></span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
