import { useMemo, useState } from 'react';
import { engineInput, onboard, type OnboardingInput } from '@clarity/data';
import { buildDashboard, scheduleDates } from '@clarity/engine';
import { addDays, formatMonthYear, formatShortDate, formatWeekdayDate, monthNameLong, parseAmountInput, parseISO, type ISODate, type Schedule } from '@clarity/shared';
import { Plus, X } from 'lucide-react';
import { useData, useRun, useSession } from '../state/session';
import { AmountInput } from '../ui/AmountInput';
import { Field } from '../ui/Field';
import { Money } from '../ui/Money';
import { RecoveryKeyStep } from './RecoveryKey';
import { Spinner } from '../ui/Spinner';

type Freq = 'weekly' | 'biweekly' | 'twice' | 'monthly' | 'none';
const FREQS: { value: Freq; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'twice', label: 'Twice a month' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'none', label: 'Irregular' },
];

export function scheduleFor(freq: Exclude<Freq, 'none'>, nextDate: string, twice: '1-15' | '15-last'): Schedule {
  switch (freq) {
    case 'weekly':
      return { freq: 'weekly', interval: 1, anchor: nextDate };
    case 'biweekly':
      return { freq: 'weekly', interval: 2, anchor: nextDate };
    case 'twice':
      return twice === '1-15' ? { freq: 'twice_monthly', day1: 1, day2: 15 } : { freq: 'twice_monthly', day1: 15, day2: 'last' };
    case 'monthly':
      return { freq: 'monthly', interval: 1, day: parseISO(nextDate).d, anchor: nextDate };
  }
}

export function Onboarding() {
  const session = useSession();
  const data = useData();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const [step, setStep] = useState(0);
  const [balance, setBalance] = useState('');
  const [pays, setPays] = useState<PayDraft[]>(() => [newPay(session.today, 1)]);
  const setPay = (key: number, patch: Partial<PayDraft>) => setPays((xs) => xs.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  const [billName, setBillName] = useState('Rent');
  const [billAmount, setBillAmount] = useState('');
  const [billDate, setBillDate] = useState(addDays(session.today, 10));
  const [billMonthly, setBillMonthly] = useState(true);
  const [skipBill, setSkipBill] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const done = data.settings.onboardingComplete;
  const dash = useMemo(() => (done ? buildDashboard(engineInput(data, session.today)) : null), [done, data, session.today]);

  if (session.pendingRecoveryKey) return <RecoveryKeyStep recoveryKey={session.pendingRecoveryKey} onDone={session.clearPendingRecoveryKey} />;

  const balanceCents = parseAmountInput(balance, cur);
  const billCents = parseAmountInput(billAmount, cur);

  const next = () => {
    const e: Record<string, string> = {};
    if (step === 0 && balanceCents === null) e.balance = 'Enter your current balance (0 is fine).';
    if (step === 1) {
      for (const p of pays) {
        if (p.freq === 'none') continue;
        if (p.freq !== 'twice' && (!p.nextPay || p.nextPay < session.today)) e[`${p.key}.nextPay`] = 'Choose a date today or later.';
        const c = parseAmountInput(p.amount, cur);
        if (!p.varies && p.amount !== '' && (c === null || c <= 0)) e[`${p.key}.amount`] = 'Enter an amount, or choose “It varies”.';
        if (pays.length > 1 && !p.name.trim()) e[`${p.key}.name`] = 'Give this paycheck a name.';
      }
    }
    setErrors(e);
    if (Object.keys(e).length === 0) setStep(step + 1);
  };

  const finish = async (withBill: boolean) => {
    const e: Record<string, string> = {};
    if (withBill) {
      if (!billName.trim()) e.billName = 'Name the bill.';
      if (billCents === null || billCents <= 0) e.billAmount = 'Enter the amount.';
      if (!billDate) e.billDate = 'Choose the due date.';
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    const input: OnboardingInput = {
      checkingBalanceCents: balanceCents ?? 0,
      pays: pays
        .filter((p) => p.freq !== 'none')
        .map((p) => ({
          name: pays.length > 1 ? p.name.trim() : 'Paycheck',
          schedule: scheduleFor(p.freq as Exclude<Freq, 'none'>, p.nextPay, p.twice),
          amountCents: p.varies || p.amount.trim() === '' ? null : parseAmountInput(p.amount, cur),
        })),
      ...(withBill && billCents ? { bill: { name: billName.trim(), amountCents: billCents, date: billDate, monthly: billMonthly } } : {}),
    };
    setBusy(true);
    const r = await run((ctx) => onboard(ctx, input));
    setBusy(false);
    if (!r.ok) setErrors({ form: r.errors.map((x) => x.message).join(' ') });
    else setStep(3);
  };

  const Steps = ({ n }: { n: number }) => (
    <div className="steps" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => <span key={i} className={i <= n ? 'on' : ''} />)}
    </div>
  );

  if (step === 3 && dash) {
    const m = parseISO(session.today).m;
    const low = dash.lowestThroughMonthEnd;
    return (
      <div className="center-screen">
        <div className="panel">
          <Steps n={4} />
          <p className="t-overline muted" style={{ margin: 0 }}>Your first overview</p>
          <h1 className="t-display" style={{ margin: '4px 0 20px' }}>Here's your {monthNameLong(m)}.</h1>
          <div className="stack">
            <div>
              <div className="t-footnote muted">Projected month-end balance</div>
              <div className="t-hero" data-testid="overview-month-end"><Money cents={dash.monthEnd.cents} currency={cur} /></div>
            </div>
            <div className="facts" style={{ marginTop: 0 }}>
              <div><div className="k">Lowest projected balance</div><div className={`v ${low.cents < 0 ? 'neg' : ''}`}><Money cents={low.cents} currency={cur} /></div></div>
              <div><div className="k">Lowest point</div><div className="v">{formatShortDate(low.date)}</div></div>
              <div><div className="k">Safe to Spend</div><div className={`v ${dash.safeToSpend.cents < 0 ? 'neg' : ''}`}><Money cents={dash.safeToSpend.cents} currency={cur} /></div></div>
            </div>
            <p className="t-callout muted" style={{ margin: 0 }}>{dash.lowestThroughMonthEnd.explanation.summary}</p>
            {dash.warnings.filter((w) => w.id.startsWith('unknown:')).map((w) => (
              <div key={w.id} className="callout">{w.title}. {w.detail}</div>
            ))}
          </div>
          <div className="dialog-foot">
            <button className="btn btn-primary btn-lg" onClick={session.finishIntro} autoFocus data-testid="go-dashboard">
              Go to my dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="center-screen">
      <form className="panel" onSubmit={(e) => { e.preventDefault(); if (step === 2) void finish(!skipBill); else next(); }}>
        <Steps n={step + 1} />
        {step === 0 && (
          <>
            <h1 className="t-title1">What's in your checking account right now?</h1>
            <p className="muted t-callout">Use the balance your bank app shows today. You can add savings, cash and cards later.</p>
            <Field label="Current checking balance" error={errors.balance}>
              {(id) => <AmountInput id={id} value={balance} onChange={setBalance} currency={cur} autoFocus />}
            </Field>
          </>
        )}
        {step === 1 && (
          <>
            <h1 className="t-title1">When do you get paid?</h1>
            <p className="muted t-callout">Add each paycheck that goes into this account. If you share it with a partner, add theirs too. Skip anything you're not sure about.</p>
            <div className="stack">
              {pays.map((p, i) => (
                <PayCard key={p.key} p={p} index={i} many={pays.length > 1} today={session.today} cur={cur} errors={errors}
                  onChange={(patch) => setPay(p.key, patch)}
                  onRemove={pays.length > 1 ? () => setPays((xs) => xs.filter((x) => x.key !== p.key)) : undefined} />
              ))}
              {pays.length < 4 && (
                <button type="button" className="btn btn-secondary add-pay" onClick={() => setPays((xs) => [...xs, newPay(session.today, Math.max(...xs.map((x) => x.key)) + 1)])}>
                  <Plus size={16} /> Add another paycheck
                </button>
              )}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h1 className="t-title1">Any big bill coming up?</h1>
            <p className="muted t-callout">Optional. Rent, a loan or a card payment is a good start. You can add the rest later.</p>
            {!skipBill && (
              <div className="form-grid">
                <Field label="Name" error={errors.billName} className="full">{(id) => <input id={id} className="input" value={billName} onChange={(e) => setBillName(e.target.value)} />}</Field>
                <Field label="Amount" error={errors.billAmount}>{(id) => <AmountInput id={id} value={billAmount} onChange={setBillAmount} currency={cur} />}</Field>
                <Field label="Due date" error={errors.billDate}>{(id) => <input id={id} className="input" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />}</Field>
                <label className="check full"><input type="checkbox" checked={billMonthly} onChange={(e) => setBillMonthly(e.target.checked)} /> Repeats every month</label>
              </div>
            )}
            {errors.form && <p className="error-text">{errors.form}</p>}
          </>
        )}
        <div className="dialog-foot">
          {step > 0 && <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
          <span className="spacer" />
          {step === 1 && <button type="button" className="btn btn-ghost" onClick={() => { setPays([newPay(session.today, 1, 'none')]); setErrors({}); setStep(2); }}>Skip</button>}
          {step === 2 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setSkipBill(true); void finish(false); }}>Skip</button>}
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{step === 2 ? (busy ? <><Spinner /> Saving…</> : 'See my overview') : 'Continue'}</button>
        </div>
        <p className="hint" style={{ marginTop: 16 }}>{formatMonthYear(session.today)} · Everything stays on this device.</p>
      </form>
    </div>
  );
}

interface PayDraft {
  key: number;
  name: string;
  freq: Freq;
  nextPay: ISODate;
  twice: '1-15' | '15-last';
  amount: string;
  varies: boolean;
}

function newPay(today: ISODate, key: number, freq: Freq = 'biweekly'): PayDraft {
  return { key, name: key === 1 ? 'Paycheck' : `Paycheck ${key}`, freq, nextPay: addDays(today, 7), twice: '1-15', amount: '', varies: false };
}

/** The next three paydays for a draft, worked out by the same engine that builds the forecast. */
function upcoming(p: PayDraft, today: ISODate): ISODate[] {
  if (p.freq === 'none' || (p.freq !== 'twice' && (!p.nextPay || p.nextPay < today))) return [];
  return scheduleDates(scheduleFor(p.freq, p.nextPay, p.twice), today, addDays(today, 120)).slice(0, 3);
}

function ChoiceGrid<T extends string>({ legend, name, value, options, onChange }: { legend: string; name: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="choice-grid">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className={`choice ${o.value === value ? 'on' : ''}`}>
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function PayCard({ p, index, many, today, cur, errors, onChange, onRemove }: {
  p: PayDraft; index: number; many: boolean; today: ISODate; cur: string; errors: Record<string, string>;
  onChange: (patch: Partial<PayDraft>) => void; onRemove: (() => void) | undefined;
}) {
  const dates = upcoming(p, today);
  const group = many ? p.name.trim() || `Paycheck ${index + 1}` : 'Paycheck';
  return (
    <div className={`pay-card ${many ? 'many' : ''}`} role="group" aria-label={group}>
      {many && (
        <div className="pay-card-head">
          <Field label="Name" error={errors[`${p.key}.name`]} hint={index > 0 ? 'For example “Partner’s paycheck” or “Second job”.' : undefined} className="grow">
            {(id) => <input id={id} className="input" value={p.name} onChange={(e) => onChange({ name: e.target.value })} />}
          </Field>
          {onRemove && <button type="button" className="icon-btn" aria-label={`Remove ${group}`} onClick={onRemove}><X size={16} /></button>}
        </div>
      )}
      <ChoiceGrid legend="How often" name={`freq-${p.key}`} value={p.freq} options={FREQS} onChange={(freq) => onChange({ freq })} />
      {p.freq === 'none' ? (
        <div className="callout">No problem. Clarity won't assume this income. You can add it later in Planning.</div>
      ) : (
        <>
          {p.freq === 'twice' ? (
            <ChoiceGrid legend="Paydays" name={`twice-${p.key}`} value={p.twice} options={[{ value: '1-15', label: '1st and 15th' }, { value: '15-last', label: '15th and last day' }]} onChange={(twice) => onChange({ twice })} />
          ) : (
            <Field label="Next payday" error={errors[`${p.key}.nextPay`]}>
              {(id) => <input id={id} className="input" type="date" min={today} value={p.nextPay} onChange={(e) => onChange({ nextPay: e.target.value })} />}
            </Field>
          )}
          {dates.length > 0 && (
            <p className="pay-preview" data-testid="pay-preview">
              <span>Upcoming paydays</span> {dates.map((d) => formatWeekdayDate(d)).join(' · ')}
            </p>
          )}
          <Field label="Usual paycheck amount (optional)" error={errors[`${p.key}.amount`]} hint={p.varies ? 'It will be shown as “amount unknown” and not counted until you add an amount.' : 'After taxes: what actually arrives in your account.'}>
            {(id) => <AmountInput id={id} value={p.varies ? '' : p.amount} onChange={(amount) => onChange({ amount })} currency={cur} disabled={p.varies} />}
          </Field>
          <label className="check"><input type="checkbox" checked={p.varies} onChange={(e) => onChange({ varies: e.target.checked })} /> It varies</label>
        </>
      )}
    </div>
  );
}
