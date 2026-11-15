import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CalendarClock, CircleAlert, CircleHelp, Info, TrendingDown, TrendingUp } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { backupDue, buildHomeView, recentRow, upcomingLaterPreview } from '@clarity/data';
import { buildForecast, cashHistory, type Explanation, type UpcomingItem } from '@clarity/engine';
import { addDays, formatCents, formatMonthYear, formatShortDate, formatWeekdayDate, INCOME_STATUS_LABEL, LOWEST_MONTH_SUB, LOWEST_THROUGH, OCCURRENCE_STATUS_LABEL, STATUS_HELP, TERMS, UPCOMING_LATER_TITLE, UPCOMING_NOTE } from '@clarity/shared';
import { isFresh } from '../state/fresh';
import { CaptureLauncher } from './Capture';
import { useRouter } from '../lib/router';
import { useData, useSession, useStore } from '../state/session';
import { useUi } from '../state/ui';
import { ForecastChart } from '../ui/ForecastChart';
import { CategoryIcon } from '../ui/icons';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';

export function statusBadge(u: Pick<UpcomingItem, 'status' | 'isIncome'>) {
  const label = (u.isIncome ? INCOME_STATUS_LABEL : OCCURRENCE_STATUS_LABEL)[u.status];
  const tone = u.status === 'overdue' ? (u.isIncome ? 'warn' : 'neg') : u.status === 'estimated' ? 'warn est' : u.status === 'unknown' ? 'warn' : u.status === 'confirmed' ? 'pos' : u.status === 'scheduled_tx' ? 'accent' : '';
  const help = STATUS_HELP[u.status]?.(u.isIncome) ?? '';
  return <span className={`badge ${tone}`} title={help}>{label}<span className="sr-only">: {help}</span></span>;
}

type Range = 'month' | '30' | '90';

export function Home() {
  const data = useData();
  const { today } = useSession();
  const { demo } = useStore();
  const ui = useUi();
  const { navigate } = useRouter();
  const cur = data.settings.baseCurrency;
  const view = useMemo(() => buildHomeView(data, today), [data, today]);
  const d = view.dashboard;
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

  const later = upcomingLaterPreview(d);
  const { monthEndDeltaCents: delta, show, recent } = view;
  const cats = useMemo(() => new Map(data.categories.map((c) => [c.id, c])), [data.categories]);
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
      </div>

      {backup.due && (
        <div className="banner" role="note">
          <Info size={18} className="faint" />
          <span className="grow">{backup.reason} Back up to keep a copy you can restore on another device.</span>
          <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings#backup')}>Back up now</button>
        </div>
      )}

      <div className="stack stagger">
        <CaptureLauncher onOpen={() => navigate('/capture')} />
        <div className="overview">
          {/* Phase 4B.2 hierarchy: 1. what you have (recorded balance), 2. what you can safely spend (Safe to Spend, beside
              it), 3. where you are heading (month-end and the forecast). A supporting figure is shown only when it isn't the
              very same amount and date as one already on screen (view.show). */}
          <section className="card hero-card" aria-labelledby="h-bal">
            <div className="hero-k">
              <h2 className="overline" id="h-bal">{TERMS.recordedBalance}</h2>
              <Why ex={d.recordedBalanceExplanation} label={TERMS.recordedBalance} />
            </div>
            <div className={`t-hero fit money ${d.balances.availableCashCents < 0 ? 'neg' : ''}`} style={fitChars(formatCents(d.balances.availableCashCents, cur))} data-testid="available-cash"><Money cents={d.balances.availableCashCents} currency={cur} animate /></div>
            <div className="hero-sub muted t-callout">{d.balances.cardOwedCents > 0 ? <>Across spendable accounts · <Money cents={d.balances.cardOwedCents} currency={cur} /> {TERMS.cardOwed.toLowerCase()}</> : 'Across spendable accounts'}</div>
          </section>

          {/* 3. Where you are heading (on narrow windows this comes after Safe to Spend) */}
          <section className="card outlook" aria-label="Where you are heading">
            <div className="outlook-figures" data-testid="outlook-figures">
              <div className="fig">
                <div className="k">{TERMS.projectedMonthEnd} <Why ex={d.monthEnd.explanation} label={TERMS.projectedMonthEnd} /></div>
                <div className={`v money ${d.monthEnd.cents < 0 ? 'neg' : ''}`} data-testid="month-end"><Money cents={d.monthEnd.cents} currency={cur} animate /></div>
                <div className="s delta">
                  {delta >= 0 ? <TrendingUp size={14} className="pos" /> : <TrendingDown size={14} className="neg" />}
                  <span><Money cents={Math.abs(delta)} currency={cur} /> {delta >= 0 ? 'more' : 'less'} than you have today, by {formatShortDate(d.monthEnd.date)}.</span>
                </div>
              </div>
              {show.monthLow && (
                <div className="fig" data-testid="lowest-month">
                  <div className="k">{TERMS.lowestBalance} <Why ex={d.lowestThroughMonthEnd.explanation} label={TERMS.lowestBalance} /></div>
                  <div className={`v money ${d.lowestThroughMonthEnd.cents < 0 ? 'neg' : ''}`} data-testid="lowest"><Money cents={d.lowestThroughMonthEnd.cents} currency={cur} animate /></div>
                  <div className="s">{LOWEST_MONTH_SUB(formatShortDate(d.lowestThroughMonthEnd.date), formatShortDate(d.monthEnd.date))}</div>
                </div>
              )}
              {show.lowBeforeIncome && d.lowestBeforeNextIncome && (
                <div className="fig" data-testid="lowest-before-income">
                  <div className="k">{TERMS.lowestBeforeIncome} <Why ex={d.lowestBeforeNextIncome.explanation} label={TERMS.lowestBeforeIncome} /></div>
                  <div className={`v money ${d.lowestBeforeNextIncome.cents < 0 ? 'neg' : ''}`}><Money cents={d.lowestBeforeNextIncome.cents} currency={cur} animate /></div>
                  <div className="s">{formatShortDate(d.lowestBeforeNextIncome.date)} · next income {formatShortDate(d.lowestBeforeNextIncome.nextIncome.date)}</div>
                </div>
              )}
              {show.endOfDay && (
                <div className="fig" data-testid="end-of-day">
                  <div className="k">{TERMS.endOfDay} <Why ex={d.endOfDay.explanation} label={TERMS.endOfDay} /></div>
                  <div className={`v money ${d.endOfDay.cents < 0 ? 'neg' : ''}`}><Money cents={d.endOfDay.cents} currency={cur} animate /></div>
                  <div className="s">After what is scheduled today</div>
                </div>
              )}
            </div>

            <div className="row between wrap chart-head">
              <span className="overline">Cash over time</span>
              <Segmented label="Chart range" value={range} onChange={setRange} options={[{ value: 'month', label: 'Month-end' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            </div>
            <ForecastChart history={history} forecast={forecast} currency={cur} reserve={data.settings.minReserveCents} monthEnd={d.monthEnd.date} />
          </section>

          <div className="side">
          {/* 2. Safe to Spend: the headline amount and its status; the full arithmetic is behind "Why this number?" */}
          <section className="card sts" aria-labelledby="h-sts">
            <h2 className="overline" id="h-sts">{TERMS.safeToSpend}</h2>
            <div className={`metric fit money ${sts.cents < 0 ? 'short' : ''}`} style={fitChars((sts.cents < 0 ? `${TERMS.shortBy} ` : '') + formatCents(sts.cents < 0 ? sts.shortfallCents : sts.cents, cur))} data-testid="safe-to-spend">
              {sts.cents < 0 ? <>{TERMS.shortBy} <Money cents={sts.shortfallCents} currency={cur} animate /></> : <Money cents={sts.cents} currency={cur} animate />}
            </div>
            <p className="t-callout muted">
              {sts.cents < 0 ? `What is scheduled is more than your cash and reserve cover through ${formatShortDate(sts.horizonEnd)}.` : <span className={sts.dependableIncome ? undefined : 'warn'} data-testid="sts-caption">{sts.caption}</span>} Your balance is lowest on {formatShortDate(sts.lowPoint.date)}.
            </p>
            {show.stsLow && (
              <div className="sts-low" data-testid="sts-low">
                <span>{LOWEST_THROUGH(formatShortDate(sts.horizonEnd))} <span className="sub">· {formatShortDate(sts.lowPoint.date)}</span></span>
                <span className={`num ${sts.lowPoint.cents < 0 ? 'neg' : ''}`}><Money cents={sts.lowPoint.cents} currency={cur} /></span>
              </div>
            )}
            {sts.nextAfterNote && <p className="sts-note" data-testid="sts-next">{sts.nextAfterNote}</p>}
            {sts.excludedIncome.length > 0 && <p className="hint" data-testid="sts-excluded" style={{ marginBottom: 14 }}>{sts.excludedIncome.length} income item{sts.excludedIncome.length > 1 ? 's are' : ' is'} not counted because the amount is estimated, unknown or not yet recorded.</p>}
            <div className="sts-actions">
              <button className="btn btn-secondary" onClick={() => ui.openAfford()}>{TERMS.canIAfford}</button>
              <button className="btn-link" data-testid="why-sts" onClick={() => ui.explain(view.stsExplanation)}>{TERMS.whyThisNumber}</button>
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

        <div className="grid cols-2">
          {/* 4. What is coming */}
          <section className="card" aria-labelledby="h-up">
            <div className="card-head">
              <h2 className="card-title" id="h-up">{TERMS.upcoming} <span className="faint" style={{ fontWeight: 500 }}>· through {formatShortDate(d.upcomingUntil)}</span></h2>
              <button className="btn-link" onClick={() => navigate('/planning')}>Open Planning</button>
            </div>
            {d.upcoming.length === 0 && d.upcomingLater.length === 0 ? (
              <div className="empty">
                <div className="ico"><CalendarClock size={24} /></div>
                <div className="t-headline">Nothing scheduled</div>
                <div className="t-callout">No bills, paychecks or planned expenses through {formatShortDate(d.upcomingLaterUntil)}.</div>
                <button className="btn btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => navigate('/planning')}>Add a bill or income</button>
              </div>
            ) : (
              <>
              <p className="hint upcoming-note">{UPCOMING_NOTE}</p>
              {d.upcoming.length === 0 && <p className="t-callout muted" data-testid="upcoming-none">Nothing scheduled through {formatShortDate(d.upcomingUntil)}.</p>}
              <div className="list" data-testid="upcoming">
                {d.upcoming.map((u) => (
                  <div key={u.id} className="list-row up-row">
                    <div className={`cat-icon up-icon ${u.isIncome ? 'inflow' : ''}`}>{u.isIncome ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</div>
                    <div className="up-main">
                      <div className="title">{u.label}</div>
                      <div className="meta">{formatWeekdayDate(u.date)} {statusBadge(u)}{!u.affectsCash && <span>Charged to a card, not from cash</span>}</div>
                    </div>
                    <span className={`up-amount num ${u.cents > 0 ? 'pos' : ''}`}>
                      {u.status === 'unknown' ? <span className="faint">—</span> : <>{u.status === 'estimated' && <span className="approx" aria-label="about">≈</span>}<Money cents={u.cents} currency={u.currency ?? cur} sign="always" /></>}
                    </span>
                    {u.occurrence && u.status !== 'skipped' && (
                      <button
                        className="btn btn-secondary btn-sm up-action"
                        aria-label={`${u.isIncome ? 'Record' : 'Mark paid'}: ${u.label}`}
                        onClick={() => ui.openAdd({ occurrenceRef: { recurringId: u.occurrence!.recurringId, originalDate: u.occurrence!.originalDate }, occurrenceName: u.label, amountCents: u.occurrence!.amountCents || undefined })}
                      >
                        {u.isIncome ? 'Record' : 'Mark paid'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {later.shown.length > 0 && (
                <div className="up-later" data-testid="upcoming-later" aria-labelledby="h-later">
                  <h3 className="overline" id="h-later">{UPCOMING_LATER_TITLE}</h3>
                  <ul className="up-later-list">
                    {later.shown.map((u) => (
                      <li key={u.id}>
                        <span className="up-later-date">{formatShortDate(u.date)}</span>
                        <span className="up-later-name">{u.label}{u.status === 'estimated' && <span className="sr-only"> (estimated)</span>}{!u.affectsCash && <span className="faint"> · card</span>}</span>
                        <span className={`num ${u.cents > 0 ? 'pos' : ''}`}>{u.status === 'unknown' ? <span className="faint">—</span> : <>{u.status === 'estimated' && <span className="approx" aria-hidden>≈</span>}<Money cents={u.cents} currency={u.currency ?? cur} sign="always" /></>}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="hint up-later-more">
                    {later.more > 0 ? `${later.more} more through ${formatShortDate(later.until)}. ` : `Safe to Spend looks through ${formatShortDate(later.until)}. `}
                    <button className="btn-link" onClick={() => navigate('/planning')}>See all in Planning</button>
                  </p>
                </div>
              )}
              </>
            )}
          </section>

          <div className="stack" style={{ alignContent: 'start' }}>
            {/* 5. Things that need attention (only when there are any) */}
            {d.warnings.length > 0 && (
              <section className="card" aria-labelledby="h-warn" data-testid="warnings">
                <div className="card-head"><h2 className="card-title" id="h-warn">Needs attention</h2></div>
                {d.warnings.slice(0, 5).map((w) => (
                  <div key={w.id} className="warning-row">
                    {w.severity === 'critical' ? <span className="attention neg warn-ico"><CircleAlert size={18} className="neg" /></span> : w.severity === 'warning' ? <span className="attention warn-ico"><AlertTriangle size={18} className="warn" /></span> : <Info size={18} className="faint" />}
                    <div>
                      <div className="t">{w.title}</div>
                      <div className="d">{w.detail}</div>
                    </div>
                  </div>
                ))}
                {d.warnings.length > 5 && <button className="btn-link" data-testid="more-warnings" onClick={() => navigate('/planning#warnings')}>{d.warnings.length - 5} more in Planning</button>}
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
                    const r = recentRow(t, cat?.name);
                    return (
                      <button key={t.id} className={`list-row ${isFresh(t.id) ? 'fresh' : ''}`} onClick={() => ui.openAdd({ editId: t.id })} aria-label={`Edit ${t.merchant || t.kind}`}>
                        <span className={`cat-icon ${r.inflow ? 'inflow' : ''}`}><CategoryIcon name={t.kind === 'transfer' ? 'transfer' : t.kind === 'adjustment' ? 'adjustment' : cat?.icon} /></span>
                        <span style={{ minWidth: 0 }}>
                          <span className="title" style={{ display: 'block' }}>{r.title}</span>
                          <span className="meta">{formatShortDate(t.date)} · {r.meta}</span>
                        </span>
                        <span className={`num ${r.inflow ? 'pos' : ''}`} style={{ fontWeight: 600 }}><Money cents={r.cents} currency={cur} sign={r.sign} /></span>
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

/** Headline figures shrink to fit their card when the amount is long (e.g. −$1,227,867.89 on a 320px phone), never clip. */
function fitChars(text: string): CSSProperties {
  return { ['--chars' as string]: String(Math.max(text.length, 8)) };
}
