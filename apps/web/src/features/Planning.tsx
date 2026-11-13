import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, CalendarPlus, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  clearOccurrenceException, createRecurring, deleteRecurring, engineInput, setOccurrenceException, setRecurringPaused, updateRecurring,
  type RecurringInput,
} from '@clarity/data';
import {
  annualEquivalentCents, applyWeekendRule, balanceOnDate, buildForecast, describeSchedule, monthlyEquivalentCents, nextScheduleDate, type Occurrence,
} from '@clarity/engine';
import {
  addDays, centsToDecimalString, endOfMonth, formatShortDate, formatWeekdayDate, parseAmountInput, parseISO, TERMS, type RecurringAmount,
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

  const horizon = addDays(today, 45);
  const forecast = useMemo(
    () => buildForecast({ today, horizonEnd: horizon, accounts: data.accounts, transactions: data.transactions, recurring: data.recurring, exceptions: data.exceptions, baseCurrency: cur, includeEstimatedIncome: true }),
    [data, today, horizon, cur],
  );
  const onDate = useMemo(() => balanceOnDate(engineInput(data, today), target), [data, today, target]);

  const timeline = useMemo(() => {
    const days: { date: string; end: number; items: { key: string; label: string; cents: number; occ?: Occurrence; status: Occurrence['status'] | 'scheduled_tx' | 'excluded'; isIncome: boolean }[] }[] = [];
    const occByDate = new Map<string, Occurrence[]>();
    for (const o of forecast.occurrences) if (o.status === 'skipped' || o.status === 'overdue') occByDate.set(o.status === 'overdue' ? today : o.date, [...(occByDate.get(o.status === 'overdue' ? today : o.date) ?? []), o]);
    for (const d of forecast.days) {
      const items = d.events.map((e) => ({
        key: e.id,
        label: e.label,
        cents: e.cashDeltaCents || (e.legs.find((l) => l.accountId === e.occurrence?.accountId)?.deltaCents ?? 0),
        ...(e.occurrence ? { occ: e.occurrence } : {}),
        status: (e.source === 'scheduled_tx' ? 'scheduled_tx' : e.source === 'hypothetical' ? 'expected' : e.occurrence?.status ?? 'expected') as Occurrence['status'] | 'scheduled_tx' | 'excluded',
        isIncome: e.occurrence?.kind === 'income' || (e.source === 'scheduled_tx' && e.legs[0]!.deltaCents > 0),
      }));
      for (const e of forecast.excludedEvents) if (e.date === d.date && e.occurrence) items.push({ key: e.id, label: e.label, cents: 0, occ: e.occurrence, status: e.excluded === 'unknown_amount' ? 'unknown' : 'excluded', isIncome: true });
      for (const o of occByDate.get(d.date) ?? []) if (o.status === 'skipped') items.push({ key: `s:${o.key}`, label: o.name, cents: 0, occ: o, status: 'skipped', isIncome: o.kind === 'income' });
      if (items.length) days.push({ date: d.date, end: d.endCashCents, items });
    }
    return days;
  }, [forecast, today]);

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

      <div className="grid plan-grid">
        <section className="card" aria-labelledby="tl">
          <div className="card-head"><h2 className="card-title" id="tl">Next 45 days</h2><span className="hint">Balance shown is projected available cash at the end of each day</span></div>
          {timeline.length === 0 ? (
            <div className="empty"><div>Nothing scheduled yet.</div></div>
          ) : (
            <div className="list" data-testid="timeline">
              {timeline.map((d) => (
                <div key={d.date} style={{ borderTop: '1px solid var(--c-border)', padding: '10px 0' }}>
                  <div className="row between"><strong className="t-footnote">{formatWeekdayDate(d.date)}</strong><span className={`t-footnote num ${d.end < 0 ? 'neg' : 'muted'}`}><Money cents={d.end} currency={cur} /></span></div>
                  {d.items.map((it) => (
                    <div key={it.key} className="row" style={{ padding: '6px 0', position: 'relative' }}>
                      <span className={`cat-icon ${it.isIncome ? 'inflow' : ''}`} style={{ width: 26, height: 26, borderRadius: 8 }}>{it.isIncome ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}</span>
                      <span style={{ flex: 1, textDecoration: it.status === 'skipped' ? 'line-through' : undefined }} className={it.status === 'skipped' ? 'faint' : ''}>{it.label}</span>
                      {it.status === 'excluded' ? <span className="badge warn">Estimated, not in Safe to Spend</span> : it.status !== 'expected' && statusBadge({ status: it.status as Occurrence['status'], isIncome: it.isIncome })}
                      <span className={`num ${it.cents > 0 ? 'pos' : ''}`} style={{ width: 110, textAlign: 'right', fontWeight: 600 }}>{it.status === 'unknown' || it.status === 'skipped' ? <span className="faint">—</span> : <Money cents={it.cents} currency={cur} sign="always" />}</span>
                      {it.occ ? (
                        <button className="icon-btn" aria-label={`Actions for ${it.label}`} onClick={() => setMenu(menu === it.key ? null : it.key)}><MoreHorizontal size={16} /></button>
                      ) : <span style={{ width: 34 }} />}
                      {menu === it.key && it.occ && (
                        <div className="suggest" style={{ left: 'auto', width: 220 }} role="menu">
                          {it.status === 'skipped' ? (
                            <button role="menuitem" onClick={() => void occAct(it.occ!, 'unskip')}>Restore</button>
                          ) : (
                            <>
                              <button role="menuitem" onClick={() => { setMenu(null); ui.openAdd({ occurrenceRef: { recurringId: it.occ!.recurringId, originalDate: it.occ!.originalDate }, occurrenceName: it.label, amountCents: it.occ!.amountCents || undefined }); }}>{it.isIncome ? 'Record as received' : 'Mark paid'}</button>
                              <button role="menuitem" onClick={() => void occAct(it.occ!, 'skip')}>Skip this one</button>
                              <button role="menuitem" onClick={() => { setMenu(null); setOccAction({ occ: it.occ!, action: 'move' }); }}>Move date</button>
                              <button role="menuitem" onClick={() => { setMenu(null); setOccAction({ occ: it.occ!, action: 'override' }); }}>Change amount</button>
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

  function ItemRow({ r }: { r: RecurringItem }) {
    const next = nextScheduleDate(r.schedule, today);
    const effective = next ? applyWeekendRule(next, r.weekendRule) : null;
    const isIncome = r.kind === 'income';
    return (
      <div className="item-row">
        <div className={`cat-icon ${isIncome ? 'inflow' : ''}`}>{isIncome ? <ArrowDownLeft size={16} /> : r.kind === 'transfer' || r.kind === 'savings' ? <ArrowLeftRight size={16} /> : <ArrowUpRight size={16} />}</div>
        <div>
          <div className="title" style={{ fontWeight: 500 }}>{r.name} {r.paused && <span className="badge">Paused</span>}</div>
          <div className="hint">{describeSchedule(r.schedule)}{effective && !r.paused ? ` · next ${formatShortDate(effective)}` : ''}</div>
        </div>
        <div>
          <div className="amt num">{amountLabel(r.amount)}</div>
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

  function amountLabel(a: RecurringAmount) {
    if (a.type === 'unknown') return <span className="faint">Amount unknown</span>;
    if (a.type === 'card_full_balance') return <span className="muted">Full balance</span>;
    return <>{a.type === 'variable' ? '~' : ''}<Money cents={a.cents} currency={cur} /></>;
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
