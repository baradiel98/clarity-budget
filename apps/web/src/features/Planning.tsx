import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarPlus, ChevronDown, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  catchUp, clearOccurrenceException, createRecurring, deleteRecurring, engineInput, estimateNote, paidThisMonth, warningsBesideCatchUp, recurringAmountView, setOccurrenceException, setRecurringPaused, updateRecurring,
  type RecurringAmountView,
  type RecurringInput,
} from '@clarity/data';
import {
  annualEquivalentCents, applyWeekendRule, balanceOnDate, buildDailyLedger, buildDashboard, ledgerAccounts, ledgerDayExplanation, buildForecast, computeSafeToSpend, describeSchedule, monthlyEquivalentCents, nextScheduleDate, planningWindowEnd, type Occurrence,
} from '@clarity/engine';
import {
  addDays, CATCHUP_ACTION_LABEL, INCOME_STATUS_LABEL, OCCURRENCE_STATUS_LABEL, STATUS_HELP, CATCHUP_COUNT, CATCHUP_DONE, CATCHUP_HINT, CATCHUP_TITLE, centsToDecimalString, LEDGER_ALL_CASH, LEDGER_COVER_BADGE, LEDGER_SHORTFALL_HINT, LEDGER_CARD_NOTE, LEDGER_DAY_DETAILS, LEDGER_DAY_LABEL, LEDGER_SHOW, endOfMonth, formatCents, formatShortDate, formatWeekdayDate, monthNameLong, PAID_DUE, PAID_EMPTY, PAID_HINT, PAID_TITLE, parseAmountInput, parseISO, TERMS, type RecurringAmount,
  type RecurringItem, type RecurringKind, type Schedule, type WeekendRule,
} from '@clarity/shared';
import { useData, useRun, useSession, useStore } from '../state/session';
import { useUi } from '../state/ui';
import { AmountInput } from '../ui/AmountInput';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';
import { useToast } from '../ui/Toast';
import { AccountSelect, CategorySelect } from './AddTransaction';
import { statusBadge } from './Home';
import { WarningList } from '../ui/WarningList';

type Group = 'income' | 'bills' | 'transfers';
const GROUP_KINDS: Record<Group, RecurringKind[]> = { income: ['income'], bills: ['bill', 'subscription'], transfers: ['transfer', 'savings'] };

export function Planning() {
  const data = useData();
  const { today } = useSession();
  const { store } = useStore();
  const ui = useUi();
  const run = useRun();
  const toast = useToast();
  const cur = data.settings.baseCurrency;
  const [target, setTarget] = useState(endOfMonth(today));
  const [edit, setEdit] = useState<{ item?: RecurringItem; kind: RecurringKind; once?: boolean } | null>(null);
  const [occAction, setOccAction] = useState<{ occ: Occurrence; action: 'move' | 'override' } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [paidOpen, setPaidOpen] = useState(false);
  // Actions menu (menu button pattern): focus moves into it, arrows move between items, Escape closes
  // and returns focus to the ··· button, Tab or a click outside closes it.
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeMenu = (refocus = true) => { setMenu(null); if (refocus) menuTrigger.current?.focus(); };
  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !menuTrigger.current?.contains(t)) setMenu(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menu]);
  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role=menuitem]')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const go = (k: number) => { e.preventDefault(); items[(k + items.length) % items.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
    else if (e.key === 'Tab') closeMenu(false);
  };

  const horizon = useMemo(() => planningWindowEnd(engineInput(data, today)), [data, today]);
  const stsScope = useMemo(() => computeSafeToSpend(engineInput(data, today)), [data, today]);
  // The complete warning list (Phase 4A.4.2): Home shows the first five and links here.
  const dash = useMemo(() => buildDashboard(engineInput(data, today)), [data, today]);
  // Phase 4B.4: per-item past-due warnings are listed (with their actions) in the catch-up review instead
  const allWarnings = useMemo(() => warningsBesideCatchUp(dash.warnings), [dash]);
  const pastDue = useMemo(() => catchUp(dash), [dash]);
  // show "All caught up" only after past-due items were resolved here (an empty review is simply not shown)
  const hadPastDue = useRef(pastDue.count > 0);
  if (pastDue.count > 0) hadPastDue.current = true;
  const catchUpRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.location.hash === '#catch-up') catchUpRef.current?.scrollIntoView({ block: 'start' });
  }, []);
  const warningsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.location.hash === '#warnings') warningsRef.current?.scrollIntoView({ block: 'start' });
  }, []);
  const forecast = useMemo(
    () => buildForecast({ today, horizonEnd: horizon, accounts: data.accounts, transactions: data.transactions, recurring: data.recurring, exceptions: data.exceptions, baseCurrency: cur, includeEstimatedIncome: true }),
    [data, today, horizon, cur],
  );
  const onDate = useMemo(() => balanceOnDate(engineInput(data, today), target), [data, today, target]);
  // Phase 5A: the schedule for all spendable cash (default) or one account, from the same forecast
  const [scope, setScope] = useState<string>('cash');
  const ledgerChoices = useMemo(() => ledgerAccounts(data.accounts, forecast), [data.accounts, forecast]);
  // Phase 5A.3 (F2): with only one account there is nothing to choose: show that account's own view (for a single
  // spendable account the figures are the same as all spendable cash), so its trail from the confirmed balance is there
  const scopeId = ledgerChoices.length === 1 ? ledgerChoices[0]!.id : scope !== 'cash' && ledgerChoices.some((a) => a.id === scope) ? scope : 'cash';
  const scopeAcct = data.accounts.find((a) => a.id === scopeId);
  const ledger = useMemo(() => buildDailyLedger(engineInput(data, today), scopeId === 'cash' ? { kind: 'cash' } : { kind: 'account', accountId: scopeId }, { forecast }), [data, today, scopeId, forecast]);
  const scopeName = scopeAcct?.name ?? LEDGER_ALL_CASH;
  const scopeCur = ledger.currency;
  const isCard = ledger.isCard;
  const dayDetails = (date: string) => { const ex = ledgerDayExplanation(engineInput(data, today), ledger, date, { forecast }); if (ex) ui.explain(ex); };

  const timeline = useMemo(() => {
    if (scopeId !== 'cash') {
      // one account: the ledger's own entries (the effect on this account), plus what isn't counted and skipped items
      const skippedHere = forecast.occurrences.filter((o) => o.status === 'skipped' && (o.accountId === scopeId || o.toAccountId === scopeId));
      return ledger.days.map((d) => {
        const items: { key: string; label: string; cents: number; currency?: string; occ?: Occurrence; status: Occurrence['status'] | 'scheduled_tx' | 'excluded'; isIncome: boolean; covered?: number; overdrawn?: boolean; infoOnly?: boolean }[] = d.entries.map((e) => ({
          key: e.eventId, label: e.label, cents: e.deltaCents, currency: scopeCur, ...(e.occurrence ? { occ: e.occurrence } : {}),
          ...(e.coveredCents ? { covered: e.coveredCents, overdrawn: e.basis === 'overdrawn' } : {}), ...(e.deltaCents === 0 ? { infoOnly: true } : {}),
          status: (e.basis === 'planned' ? 'scheduled_tx' : e.occurrence?.status ?? 'expected') as Occurrence['status'] | 'scheduled_tx',
          isIncome: e.deltaCents > 0,
        }));
        for (const e of d.notCounted) if (e.occurrence) items.push({ key: e.id, label: e.label, cents: 0, occ: e.occurrence, status: e.excluded === 'unknown_amount' ? 'unknown' : 'excluded', isIncome: true });
        for (const o of skippedHere) if (o.date === d.date) items.push({ key: `s:${o.key}`, label: o.name, cents: 0, occ: o, status: 'skipped', isIncome: o.kind === 'income' });
        return { date: d.date, end: d.endCents, items };
      }).filter((d) => d.items.length || d.date === today); // today always: its details show how the day starts
    }
    // An amount that isn't a cash effect is in the currency of the account it belongs to (Phase 4A.4.4).
    const ccy = (id?: string) => data.accounts.find((a) => a.id === id)?.currency ?? cur;
    const days: { date: string; end: number; items: { key: string; label: string; cents: number; currency?: string; occ?: Occurrence; status: Occurrence['status'] | 'scheduled_tx' | 'excluded'; isIncome: boolean; covered?: number; overdrawn?: boolean; infoOnly?: boolean }[] }[] = [];
    const occByDate = new Map<string, Occurrence[]>();
    for (const o of forecast.occurrences) if (o.status === 'skipped' || o.status === 'overdue') occByDate.set(o.status === 'overdue' ? today : o.date, [...(occByDate.get(o.status === 'overdue' ? today : o.date) ?? []), o]);
    for (const d of forecast.days) {
      const items: (typeof days)[number]['items'] = d.events.map((e) => ({
        key: e.id,
        label: e.label,
        cents: e.cashDeltaCents || (e.legs.find((l) => l.accountId === e.occurrence?.accountId)?.deltaCents ?? 0),
        currency: e.cashDeltaCents ? cur : ccy(e.occurrence?.accountId ?? e.legs[0]?.accountId),
        ...(e.occurrence ? { occ: e.occurrence } : {}),
        status: (e.source === 'scheduled_tx' ? 'scheduled_tx' : e.source === 'hypothetical' ? 'expected' : e.occurrence?.status ?? 'expected') as Occurrence['status'] | 'scheduled_tx' | 'excluded',
        isIncome: e.occurrence?.kind === 'income' || (e.source === 'scheduled_tx' && e.legs[0]!.deltaCents > 0),
      }));
      for (const e of forecast.excludedEvents) if (e.date === d.date && e.occurrence) items.push({ key: e.id, label: e.label, cents: 0, occ: e.occurrence, status: e.excluded === 'unknown_amount' ? 'unknown' : 'excluded', isIncome: true });
      for (const o of occByDate.get(d.date) ?? []) if (o.status === 'skipped') items.push({ key: `s:${o.key}`, label: o.name, cents: 0, occ: o, status: 'skipped', isIncome: o.kind === 'income' });
      if (items.length || d.date === today) days.push({ date: d.date, end: d.endCashCents, items });
    }
    return days;
  }, [forecast, today, data.accounts, cur, scopeId, ledger, scopeCur]);

  const items = (g: Group) => data.recurring.filter((r) => GROUP_KINDS[g].includes(r.kind));
  const totals = (g: Group) => {
    let m = 0;
    let a = 0;
    for (const r of items(g)) {
      if (r.paused || r.amount.type === 'unknown' || r.amount.type === 'card_full_balance') continue;
      m += monthlyEquivalentCents(r.schedule, r.amount.cents);
      a += annualEquivalentCents(r.schedule, r.amount.cents);
    }
    return { m, a };
  };

  const occAct = async (o: Occurrence, act: 'skip' | 'unskip') => {
    const r = await run((ctx) => (act === 'skip' ? setOccurrenceException(ctx, o, 'skip') : clearOccurrenceException(ctx, o)), { undoLabel: act === 'skip' ? `Skipped ${o.name}` : `Restored ${o.name}` });
    if (r.ok) toast({ message: act === 'skip' ? `${o.name} on ${formatShortDate(o.date)} skipped` : `${o.name} restored`, action: { label: 'Undo', run: () => void store.undo() } });
    setMenu(null);
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="t-title1">{TERMS.tabs.planning}</h1>
          <div className="sub muted t-callout">Income, bills and transfers that shape your forecast.</div>
        </div>
        <div className="row">
          <button className="btn btn-secondary" onClick={() => setEdit({ kind: 'bill', once: true })}><CalendarPlus size={15} /> Planned expense</button>
          <button className="btn btn-primary" onClick={() => setEdit({ kind: 'bill' })}><Plus size={15} /> Add bill</button>
        </div>
      </div>

      {(pastDue.count > 0 || hadPastDue.current) && (
        <section className="card catchup" id="catch-up" ref={catchUpRef} aria-labelledby="h-catch" data-testid="catch-up" style={{ marginBottom: 16 }}>
          <div className="card-head">
            <h2 className="card-title" id="h-catch">{CATCHUP_TITLE}{pastDue.count > 0 && <span className="faint" style={{ fontWeight: 500 }}> · {CATCHUP_COUNT(pastDue.count)}</span>}</h2>
          </div>
          {pastDue.count === 0 ? (
            <p className="t-callout muted" data-testid="catch-up-done" role="status" style={{ margin: 0 }}>{CATCHUP_DONE}</p>
          ) : (
            <>
              <p className="hint" style={{ marginTop: 0 }}>{CATCHUP_HINT}</p>
              <div className="catchup-groups">
                {pastDue.groups.map((g) => (
                  <div key={g.recurringId} className="catchup-group" role="group" aria-labelledby={`cu-${g.recurringId}`} data-testid="catch-up-group">
                    <h3 className="catchup-name" id={`cu-${g.recurringId}`}>{g.name}{g.items.length > 1 && <span className="faint"> · {g.items.length} past due</span>}</h3>
                    <ul className="catchup-list">
                      {g.items.map((u) => {
                        const o = u.occurrence!;
                        const due = formatShortDate(u.date);
                        const verb = u.isIncome ? 'Record' : 'Mark paid';
                        return (
                          <li key={u.id} className="catchup-row" data-testid="catch-up-row">
                            <span className="catchup-date">{formatWeekdayDate(u.date)}</span>
                            <span className="catchup-status"><span className="badge" title={STATUS_HELP.overdue(u.isIncome)}>{(u.isIncome ? INCOME_STATUS_LABEL : OCCURRENCE_STATUS_LABEL).overdue}<span className="sr-only">: {STATUS_HELP.overdue(u.isIncome)}</span></span>{!u.affectsCash && <span className="faint t-footnote"> Charged to a card</span>}</span>
                            <span className={`catchup-amt num ${u.cents > 0 ? 'pos' : ''}`}>{o.amountBasis === 'unknown' ? <span className="faint">—</span> : <>{o.amountBasis !== 'fixed' && o.amountBasis !== 'override' && o.amountBasis !== 'actual' && <span className="approx" aria-label="about">≈</span>}<Money cents={u.cents} currency={u.currency ?? cur} sign="always" /></>}</span>
                            <span className="catchup-acts">
                              <button className="btn btn-secondary btn-sm" aria-label={CATCHUP_ACTION_LABEL(verb, g.name, due)}
                                onClick={() => ui.openAdd({ occurrenceRef: { recurringId: o.recurringId, originalDate: o.originalDate }, occurrenceName: u.label, amountCents: o.amountCents || undefined })}>{verb}</button>
                              <button className="btn btn-ghost btn-sm" aria-label={CATCHUP_ACTION_LABEL('Skip', g.name, due)} onClick={() => void occAct(o, 'skip')}>Skip</button>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}
      {allWarnings.length > 0 && (
        <section className="card" id="warnings" ref={warningsRef} aria-labelledby="h-allwarn" data-testid="all-warnings" style={{ marginBottom: 16 }}>
          <div className="card-head"><h2 className="card-title" id="h-allwarn">Needs attention · {allWarnings.length}</h2><span className="hint">Every warning from your forecast</span></div>
          <WarningList warnings={allWarnings} currency={cur} />
        </section>
      )}
      <div className="grid plan-grid">
        <section className="card" aria-labelledby="tl">
          <div className="card-head"><h2 className="card-title" id="tl">Through {formatShortDate(horizon)}</h2><span className="hint">{scopeId === 'cash' ? 'Balance shown is projected available cash at the end of each day' : isCard ? `Amount owed on ${scopeName} at the end of each day` : `Projected balance of ${scopeName} at the end of each day`}</span></div>
          {ledgerChoices.length > 1 && (
            <label className="row ledger-scope" style={{ gap: 8, marginBottom: 8 }}>
              <span className="t-footnote muted">{LEDGER_SHOW}</span>
              <select className="input" style={{ width: 'auto', minWidth: 0, maxWidth: '100%' }} value={scopeId} onChange={(e) => setScope(e.target.value)} data-testid="ledger-scope" aria-label={`${LEDGER_SHOW}: account`}>
                <option value="cash">{LEDGER_ALL_CASH}</option>
                {ledgerChoices.map((a) => <option key={a.id} value={a.id}>{a.name}{a.archived ? ' (archived)' : ''}</option>)}
              </select>
            </label>
          )}
          {isCard && <p className="hint" data-testid="ledger-card-note" style={{ marginTop: 0 }}>{LEDGER_CARD_NOTE}</p>}
          {scopeAcct && ledger.days.some((d) => d.entries.some((e) => e.coveredCents && e.basis !== 'overdrawn')) && <p className="hint" data-testid="ledger-shortfall-hint" style={{ marginTop: 0 }}>{LEDGER_SHORTFALL_HINT(scopeAcct.name)}</p>}
          <p className="hint" data-testid="timeline-scope" style={{ marginTop: 0 }}>
              {horizon === stsScope.horizonEnd
                ? `Shows what's scheduled through ${formatShortDate(horizon)}, the end of the Safe to Spend forecast. Recurring items continue after that; see the lists.`
                : `Safe to Spend counts items through ${formatShortDate(stsScope.horizonEnd)}; items after that are shown here but not counted.`}
              {stsScope.nextAfterNote && horizon === stsScope.horizonEnd ? ` ${stsScope.nextAfterNote}` : ''}
            </p>
          {!timeline.some((d) => d.items.length) && <div className="empty"><div>Nothing scheduled yet.</div></div>}
          {timeline.length > 0 && (
            <div className="list" data-testid="timeline">
              {timeline.map((d) => (
                <div key={d.date} className="tl-day">
                  <div className="tl-head">
                    <strong className="t-footnote">{formatWeekdayDate(d.date)}</strong>
                    <span className="row" style={{ gap: 8 }}>
                      <span className={`t-footnote num ${!isCard && d.end < 0 ? 'neg' : 'muted'}`} data-testid="tl-day-end"><span className="sr-only">{isCard ? 'Owed at end of day: ' : 'Projected balance at end of day: '}</span>{isCard && <span aria-hidden>Owed </span>}<Money cents={isCard ? -d.end : d.end} currency={scopeCur} /></span>
                      <button type="button" className="btn-link t-footnote" data-testid="day-details" aria-label={LEDGER_DAY_LABEL(formatWeekdayDate(d.date), scopeName)} onClick={() => dayDetails(d.date)}>{LEDGER_DAY_DETAILS}</button>
                    </span>
                  </div>
                  {d.items.map((it) => (
                    <div key={it.key} className="tl-item">
                      <span className={`cat-icon tl-icon ${it.isIncome ? 'inflow' : ''}`}>{it.isIncome ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                      <span className="tl-label">
                        <span style={{ textDecoration: it.status === 'skipped' ? 'line-through' : undefined }} className={it.status === 'skipped' ? 'faint' : ''}>{it.label}</span>
                        {it.status === 'excluded' ? <span className="badge warn">Estimated, not in Safe to Spend</span> : it.status !== 'expected' && statusBadge({ status: it.status as Occurrence['status'], isIncome: it.isIncome })}
                        {it.covered ? <span className="badge warn" data-testid="covered-badge">{LEDGER_COVER_BADGE(formatCents(it.covered, it.currency ?? cur), it.overdrawn)}</span> : null}
                      </span>
                      <span className={`tl-amt num ${it.cents > 0 ? 'pos' : ''}`}>{it.status === 'unknown' || it.status === 'skipped' || it.infoOnly ? <span className="faint">—</span> : <>{it.status === 'estimated' && <span className="approx" aria-label="about">≈</span>}<Money cents={it.cents} currency={it.currency ?? cur} sign="always" /></>}</span>
                      {it.occ ? (
                        <button className="icon-btn tl-act" id={`act-${it.key}`} aria-label={`Actions for ${it.label}`} aria-haspopup="menu" aria-expanded={menu === it.key} onClick={(e) => { menuTrigger.current = e.currentTarget; setMenu(menu === it.key ? null : it.key); }}><MoreHorizontal size={16} /></button>
                      ) : <span className="tl-act" aria-hidden />}
                      {menu === it.key && it.occ && (
                        <div className="suggest" style={{ left: 'auto', width: 220 }} role="menu" aria-labelledby={`act-${it.key}`} ref={menuRef} onKeyDown={onMenuKey}>
                          {it.status === 'skipped' ? (
                            <button role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); void occAct(it.occ!, 'unskip'); }}>Restore</button>
                          ) : (
                            <>
                              <button role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); ui.openAdd({ occurrenceRef: { recurringId: it.occ!.recurringId, originalDate: it.occ!.originalDate }, occurrenceName: it.label, amountCents: it.occ!.amountCents || undefined }); }}>{it.isIncome ? 'Record as received' : 'Mark paid'}</button>
                              <button role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); void occAct(it.occ!, 'skip'); }}>Skip this one</button>
                              <button role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); setOccAction({ occ: it.occ!, action: 'move' }); }}>Move date</button>
                              <button role="menuitem" tabIndex={-1} onClick={() => { closeMenu(); setOccAction({ occ: it.occ!, action: 'override' }); }}>Change amount</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="stack" style={{ alignContent: 'start' }}>
          <section className="card" aria-labelledby="bod">
            <h2 className="card-title" id="bod">Balance on a date</h2>
            <input className="input" type="date" min={today} value={target} onChange={(e) => setTarget(e.target.value || today)} aria-label="Date" />
            <div className="metric money" data-testid="balance-on-date"><Money cents={onDate.cents} currency={cur} /></div>
            <div className="t-footnote muted">Projected available cash at the end of {formatShortDate(onDate.date)}.</div>
            <button className="btn-link" style={{ marginTop: 8 }} onClick={() => ui.explain(onDate.explanation)}>{TERMS.whyThisNumber}</button>
          </section>
          <PaidSection />
          {(['income', 'bills', 'transfers'] as Group[]).map((g) => (
            <section key={g} className="card" aria-labelledby={`g-${g}`}>
              <div className="card-head">
                <h2 className="card-title" id={`g-${g}`}>{g === 'income' ? 'Income' : g === 'bills' ? 'Bills & subscriptions' : 'Transfers & savings'}</h2>
                <button className="btn btn-ghost btn-sm" onClick={() => setEdit({ kind: g === 'income' ? 'income' : g === 'bills' ? 'bill' : 'savings' })}><Plus size={14} /> Add</button>
              </div>
              {items(g).length === 0 ? (
                <div className="t-callout muted">{g === 'income' ? 'No income added. Your forecast assumes no money coming in.' : g === 'bills' ? 'No bills yet.' : 'No scheduled transfers. Add a savings transfer or a card payment.'}</div>
              ) : (
                <>
                  <div className="list">
                    {items(g).map((r) => <ItemRow key={r.id} r={r} />)}
                  </div>
                  {totals(g).m > 0 && (
                    <div className="row between t-footnote muted" style={{ borderTop: '1px solid var(--c-border)', paddingTop: 10 }}>
                      <span>About <Money cents={totals(g).m} currency={cur} /> a month</span>
                      {g === 'bills' && <span><Money cents={totals(g).a} currency={cur} /> a year</span>}
                    </div>
                  )}
                </>
              )}
            </section>
          ))}
        </div>
      </div>

      {edit && <RecurringDialog item={edit.item} kind={edit.kind} once={edit.once ?? false} onClose={() => setEdit(null)} />}
      {occAction && <OccurrenceDialog occ={occAction.occ} action={occAction.action} onClose={() => setOccAction(null)} />}
    </div>
  );

  /**
   * Phase 4B.3: scheduled items a linked transaction settled this month (shared `paidThisMonth`: the engine's own
   * "confirmed" occurrences, once each). Collapsed by default so it never crowds the schedule; each row opens its
   * transaction in the normal Edit form.
   */
  function PaidSection() {
    const paid = paidThisMonth(data, today);
    const month = monthNameLong(parseISO(today).m);
    return (
      <section className="card paid" aria-labelledby="h-paid" data-testid="paid-history">
        <h2 className="card-title paid-head" id="h-paid">
          <button type="button" className="paid-toggle" aria-expanded={paidOpen} aria-controls="paid-list" onClick={() => setPaidOpen((v) => !v)} data-testid="paid-toggle">
            <span>{PAID_TITLE}</span>
            <span className="muted t-footnote" data-testid="paid-count">{paid.entries.length === 0 ? 'None yet' : `${paid.entries.length} item${paid.entries.length === 1 ? '' : 's'}`}</span>
            <ChevronDown size={16} className={`chev ${paidOpen ? 'open' : ''}`} aria-hidden />
          </button>
        </h2>
        {paidOpen && (
          <div id="paid-list">
            {paid.entries.length === 0 ? (
              <p className="t-callout muted" data-testid="paid-empty" style={{ margin: '10px 0 0' }}>{PAID_EMPTY(month)}</p>
            ) : (
              <>
                <p className="hint" style={{ margin: '8px 0 4px' }}>{PAID_HINT(month, 'Select')}</p>
                <ul className="paid-list" aria-label={PAID_TITLE}>
                  {paid.entries.map((e) => {
                    const verb = e.kind === 'income' ? 'Received' : 'Paid';
                    const where = e.toAccountName ? `${e.accountName} → ${e.toAccountName}` : e.accountName;
                    const due = e.dueDate !== e.paidDate ? PAID_DUE(formatShortDate(e.dueDate)) : null;
                    const amount = formatCents(e.amountCents, e.currency, { sign: 'always' });
                    return (
                      <li key={e.key}>
                        <button type="button" className="paid-row" data-testid="paid-row" onClick={() => ui.openAdd({ editId: e.tx.id })}
                          aria-label={`${e.name}. ${verb} ${formatShortDate(e.paidDate)}${due ? `, ${due}` : ''}. ${amount}, ${where}. ${e.statusLabel}. Open the transaction.`}>
                          <span className={`cat-icon paid-icon ${e.kind === 'income' ? 'inflow' : ''}`} aria-hidden>{e.kind === 'income' ? <ArrowDownLeft size={14} /> : e.toAccountName ? <ArrowLeftRight size={14} /> : <ArrowUpRight size={14} />}</span>
                          <span className="paid-main">
                            <span className="title">{e.name}</span>
                            <span className="meta">{verb} {formatShortDate(e.paidDate)}{due ? ` · ${due}` : ''} · {where}</span>
                            <span className={`badge ${e.pending ? 'warn' : ''}`} data-testid="paid-status">{e.statusLabel}</span>
                          </span>
                          <span className={`paid-amt num ${e.amountCents > 0 ? 'pos' : ''}`}>{amount}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
    );
  }

  function ItemRow({ r }: { r: RecurringItem }) {
    const next = nextScheduleDate(r.schedule, today);
    const effective = next ? applyWeekendRule(next, r.weekendRule) : null;
    const isIncome = r.kind === 'income';
    const view = recurringAmountView(r, data.transactions);
    return (
      <div className="item-row">
        <div className={`cat-icon ${isIncome ? 'inflow' : ''}`}>{isIncome ? <ArrowDownLeft size={16} /> : r.kind === 'transfer' || r.kind === 'savings' ? <ArrowLeftRight size={16} /> : <ArrowUpRight size={16} />}</div>
        <div>
          <div className="title" style={{ fontWeight: 500 }}>{r.name} {r.paused && <span className="badge">Paused</span>}</div>
          <div className="hint">{describeSchedule(r.schedule)}{effective && !r.paused ? <> · <span className="nowrap">next {formatShortDate(effective)}</span></> : ''}</div>
          {view.kind === 'estimate' && <div className="hint" data-testid="estimate-note">{estimateNote(view, (c) => formatCents(c, cur))}</div>}
        </div>
        <div>
          <div className="amt num">{amountLabel(view)}</div>
          <div className="actions">
            <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Edit ${r.name}`} title="Edit" onClick={() => setEdit({ item: r, kind: r.kind })}><Pencil size={14} /></button>
            <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={r.paused ? `Resume ${r.name}` : `Pause ${r.name}`} title={r.paused ? 'Resume' : 'Pause'} onClick={() => void run((ctx) => setRecurringPaused(ctx, r.id, !r.paused))}>{r.paused ? <Play size={14} /> : <Pause size={14} />}</button>
            <button
              className="icon-btn"
              style={{ width: 28, height: 28 }}
              aria-label={`Delete ${r.name}`}
              title="Delete"
              onClick={async () => {
                const res = await run((ctx) => deleteRecurring(ctx, r.id), { undoLabel: `Deleted ${r.name}` });
                if (res.ok) toast({ message: `${r.name} deleted. Past transactions are kept.`, action: { label: 'Undo', run: () => void store.undo() } });
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /** Same estimate treatment as Upcoming: ≈ before the amount the forecast actually uses. */
  function amountLabel(v: RecurringAmountView) {
    if (v.kind === 'unknown') return <span className="faint">Amount unknown</span>;
    if (v.kind === 'card_full_balance') return <span className="muted">Full balance</span>;
    return <>{v.kind === 'estimate' && <span className="approx" aria-label="about">≈</span>}<Money cents={v.forecastCents} currency={cur} /></>;
  }
}

type FreqUI = 'once' | 'weekly' | 'biweekly' | 'twice' | 'monthly' | 'quarterly' | 'yearly';

function scheduleToUi(s: Schedule | undefined, fallbackDate: string): { freq: FreqUI; date: string; lastDay: boolean; d1: string; d2: string } {
  const base = { date: fallbackDate, lastDay: false, d1: '1', d2: '15' };
  if (!s) return { ...base, freq: 'monthly' };
  switch (s.freq) {
    case 'once': return { ...base, freq: 'once', date: s.date };
    case 'every_n_days': return { ...base, freq: 'weekly', date: s.anchor };
    case 'weekly': return { ...base, freq: s.interval === 2 ? 'biweekly' : 'weekly', date: nextScheduleDate(s, fallbackDate) ?? s.anchor };
    case 'twice_monthly': return { ...base, freq: 'twice', d1: String(s.day1), d2: String(s.day2) };
    case 'monthly': return { ...base, freq: s.interval === 3 ? 'quarterly' : s.interval === 12 ? 'yearly' : 'monthly', date: nextScheduleDate(s, fallbackDate) ?? s.anchor, lastDay: s.day === 'last' };
  }
}

function RecurringDialog({ item, kind: initialKind, once, onClose }: { item?: RecurringItem; kind: RecurringKind; once: boolean; onClose: () => void }) {
  const data = useData();
  const { today } = useSession();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const ui0 = scheduleToUi(item?.schedule, addDays(today, 7));
  const [kind, setKind] = useState<RecurringKind>(item?.kind ?? initialKind);
  const [name, setName] = useState(item?.name ?? '');
  const [accountId, setAccountId] = useState(item?.accountId ?? data.settings.defaultAccountId ?? data.accounts.find((a) => a.spendable)?.id ?? '');
  const [toAccountId, setToAccountId] = useState(item?.toAccountId ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? (initialKind === 'income' ? 'cat_paycheck' : null));
  const [amountType, setAmountType] = useState<RecurringAmount['type']>(item?.amount.type ?? 'fixed');
  const [amount, setAmount] = useState(item && 'cents' in item.amount ? centsToDecimalString(item.amount.cents) : '');
  const [freq, setFreq] = useState<FreqUI>(once ? 'once' : ui0.freq);
  const [date, setDate] = useState(ui0.date);
  const [lastDay, setLastDay] = useState(ui0.lastDay);
  const [d1, setD1] = useState(ui0.d1);
  const [d2, setD2] = useState(ui0.d2);
  const [weekendRule, setWeekendRule] = useState<WeekendRule>(item?.weekendRule ?? 'none');
  const [endDate, setEndDate] = useState(item?.endDate ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isTransfer = kind === 'transfer' || kind === 'savings';
  const toAccount = data.accounts.find((a) => a.id === toAccountId);
  const dayOptions = [...Array.from({ length: 31 }, (_, i) => String(i + 1)), 'last'];

  const save = async () => {
    const e: Record<string, string> = {};
    const cents = parseAmountInput(amount, cur);
    if ((amountType === 'fixed' || amountType === 'variable') && (cents === null || cents <= 0)) e.amount = 'Enter an amount.';
    if (!date && freq !== 'twice') e.date = 'Choose a date.';
    setErrors(e);
    if (Object.keys(e).length) return;
    const schedule: Schedule =
      freq === 'once' ? { freq: 'once', date }
      : freq === 'weekly' ? { freq: 'weekly', interval: 1, anchor: date }
      : freq === 'biweekly' ? { freq: 'weekly', interval: 2, anchor: date }
      : freq === 'twice' ? { freq: 'twice_monthly', day1: d1 === 'last' ? 'last' : Number(d1), day2: d2 === 'last' ? 'last' : Number(d2) }
      : { freq: 'monthly', interval: freq === 'quarterly' ? 3 : freq === 'yearly' ? 12 : 1, day: lastDay ? 'last' : parseISO(date).d, anchor: date };
    const amt: RecurringAmount = amountType === 'fixed' || amountType === 'variable' ? { type: amountType, cents: cents! } : { type: amountType };
    const input: RecurringInput = {
      name: name.trim() || (kind === 'income' ? 'Income' : 'Bill'),
      kind, accountId, ...(isTransfer && toAccountId ? { toAccountId } : {}), categoryId: isTransfer ? null : categoryId, schedule, amount: amt, weekendRule,
      ...(endDate ? { endDate } : {}),
    };
    const r = await run((ctx) => (item ? updateRecurring(ctx, item.id, input) : createRecurring(ctx, input)));
    if (!r.ok) setErrors(Object.fromEntries(r.errors.map((x) => [x.field, x.message])));
    else onClose();
  };

  const title = item ? `Edit ${item.name}` : once ? 'Planned expense' : kind === 'income' ? 'Add income' : isTransfer ? 'Add transfer or savings' : 'Add bill or subscription';
  return (
    <Dialog title={title} onClose={onClose} wide footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => void save()}>Save</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {!item && !once && kind !== 'income' && (
          <Segmented label="Kind" value={kind} block onChange={(k) => { setKind(k); if (k !== 'transfer' && k !== 'savings' && amountType === 'card_full_balance') setAmountType('fixed'); }}
            options={isTransfer ? [{ value: 'savings', label: 'Savings' }, { value: 'transfer', label: 'Transfer / card payment' }] : [{ value: 'bill', label: 'Bill' }, { value: 'subscription', label: 'Subscription' }]} />
        )}
        <div className="form-grid">
          <Field label="Name" className="full" error={errors.name}>{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'income' ? 'e.g. Paycheck — Acme' : isTransfer ? 'e.g. Savings, Card payment' : 'e.g. Rent, Phone'} autoFocus />}</Field>
          <Field label={kind === 'income' ? 'Paid into' : isTransfer ? 'From account' : 'Paid from'} error={errors.accountId}>{(id) => <AccountSelect id={id} value={accountId} onChange={setAccountId} />}</Field>
          {isTransfer ? (
            <Field label="To account" error={errors.toAccountId}>
              {(id) => (
                <select id={id} className="select" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
                  <option value="">Choose…</option>
                  {data.accounts.filter((a) => !a.archived && a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
            </Field>
          ) : (
            <Field label="Category">{(id) => <CategorySelect id={id} value={categoryId} onChange={setCategoryId} kind={kind === 'income' ? 'income' : 'expense'} />}</Field>
          )}
          <Field label="Amount" className="full" error={errors.amount}>
            {() => (
              <div className="stack" style={{ gap: 10 }}>
                <Segmented label="Amount type" value={amountType} onChange={setAmountType} options={[
                  { value: 'fixed', label: 'Same every time' },
                  { value: 'variable', label: 'Varies (estimate)' },
                  ...(kind === 'income' ? [{ value: 'unknown' as const, label: "Don't know" }] : []),
                  ...(isTransfer && toAccount?.type === 'credit_card' ? [{ value: 'card_full_balance' as const, label: 'Full card balance' }] : []),
                ]} />
                {(amountType === 'fixed' || amountType === 'variable') && <AmountInput value={amount} onChange={setAmount} currency={cur} aria-label="Amount" />}
                <div className="hint">
                  {amountType === 'variable' && 'Uses your estimate until there is history, then the average of the last 3 payments. Shown as estimated.'}
                  {amountType === 'unknown' && 'Counts as $0 and is flagged until you add an amount. Clarity never invents income.'}
                  {amountType === 'card_full_balance' && 'Pays whatever the card owes on that day, based on your recorded card balance.'}
                </div>
              </div>
            )}
          </Field>
          {!once && (
            <Field label="How often" className="full">
              {(id) => (
                <select id={id} className="select" value={freq} onChange={(e) => setFreq(e.target.value as FreqUI)}>
                  <option value="once">One time</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="twice">Twice a month</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              )}
            </Field>
          )}
          {freq === 'twice' ? (
            <>
              <Field label="First day">{(id) => <select id={id} className="select" value={d1} onChange={(e) => setD1(e.target.value)}>{dayOptions.map((d) => <option key={d} value={d}>{d === 'last' ? 'Last day' : d}</option>)}</select>}</Field>
              <Field label="Second day">{(id) => <select id={id} className="select" value={d2} onChange={(e) => setD2(e.target.value)}>{dayOptions.map((d) => <option key={d} value={d}>{d === 'last' ? 'Last day' : d}</option>)}</select>}</Field>
            </>
          ) : (
            <Field label={freq === 'once' ? 'Date' : 'Next date'} error={errors.date}>{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          )}
          {freq !== 'once' && (
            <Field label="If it falls on a weekend">
              {(id) => (
                <select id={id} className="select" value={weekendRule} onChange={(e) => setWeekendRule(e.target.value as WeekendRule)}>
                  <option value="none">Keep the date</option>
                  <option value="before">Move to Friday before</option>
                  <option value="after">Move to Monday after</option>
                </select>
              )}
            </Field>
          )}
          {(freq === 'monthly' || freq === 'quarterly' || freq === 'yearly') && (
            <label className="check full"><input type="checkbox" checked={lastDay} onChange={(e) => setLastDay(e.target.checked)} /> Always on the last day of the month</label>
          )}
          {freq !== 'once' && <Field label="Ends (optional)">{(id) => <input id={id} className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}</Field>}
        </div>
        {freq !== 'twice' && freq !== 'once' && date && !lastDay && parseISO(date).d > 28 && (freq === 'monthly' || freq === 'quarterly' || freq === 'yearly') && (
          <div className="hint">In months without a day {parseISO(date).d}, it falls on the last day of the month.</div>
        )}
        {errors.form && <div className="error-text">{errors.form}</div>}
      </form>
    </Dialog>
  );
}

function OccurrenceDialog({ occ, action, onClose }: { occ: Occurrence; action: 'move' | 'override'; onClose: () => void }) {
  const data = useData();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const [date, setDate] = useState(occ.date);
  const [amount, setAmount] = useState(occ.amountCents ? centsToDecimalString(occ.amountCents) : '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const r = await run((ctx) => (action === 'move' ? setOccurrenceException(ctx, occ, 'move', { newDate: date }) : setOccurrenceException(ctx, occ, 'override', { amountCents: parseAmountInput(amount, cur) ?? 0 })));
    if (!r.ok) setError(r.errors.map((e) => e.message).join(' '));
    else onClose();
  };
  return (
    <Dialog title={`${action === 'move' ? 'Move' : 'Change amount for'} ${occ.name} on ${formatShortDate(occ.date)}`} onClose={onClose} footer={<><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => void save()}>Save</button></>}>
      <p className="t-callout muted" style={{ marginTop: 0 }}>Only this occurrence changes. The schedule stays the same.</p>
      {action === 'move' ? (
        <Field label="New date" error={error}>{(id) => <input id={id} className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} autoFocus />}</Field>
      ) : (
        <Field label="Amount this time" error={error}>{(id) => <AmountInput id={id} value={amount} onChange={setAmount} currency={cur} autoFocus />}</Field>
      )}
    </Dialog>
  );
}
