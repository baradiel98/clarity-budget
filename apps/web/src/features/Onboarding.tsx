import { useMemo, useState } from 'react';
import { engineInput, onboard, type OnboardingInput } from '@clarity/data';
import { buildDashboard } from '@clarity/engine';
import { addDays, formatMonthYear, formatShortDate, monthNameLong, parseAmountInput, parseISO, type Schedule } from '@clarity/shared';
import { useData, useRun, useSession } from '../state/session';
import { AmountInput } from '../ui/AmountInput';
import { Field } from '../ui/Field';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';
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
  const [freq, setFreq] = useState<Freq>('biweekly');
  const [nextPay, setNextPay] = useState(addDays(session.today, 7));
  const [twice, setTwice] = useState<'1-15' | '15-last'>('1-15');
  const [payAmount, setPayAmount] = useState('');
  const [varies, setVaries] = useState(false);
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
  const payCents = parseAmountInput(payAmount, cur);
  const billCents = parseAmountInput(billAmount, cur);

  const next = () => {
    const e: Record<string, string> = {};
    if (step === 0 && balanceCents === null) e.balance = 'Enter your current balance (0 is fine).';
    if (step === 1 && freq !== 'none') {
      if (!nextPay || nextPay < session.today) e.nextPay = 'Choose a date today or later.';
      if (!varies && payAmount !== '' && (payCents === null || payCents <= 0)) e.payAmount = 'Enter an amount, or choose “It varies”.';
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
      ...(freq !== 'none'
        ? { pay: { schedule: scheduleFor(freq, nextPay, twice), amountCents: varies || payAmount.trim() === '' ? null : payCents } }
        : {}),
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
            <p className="muted t-callout">This lets Clarity see what's coming before it happens. Skip anything you're not sure about.</p>
            <div className="stack">
              <Segmented label="Pay frequency" value={freq} options={FREQS} onChange={setFreq} block />
              {freq !== 'none' ? (
                <>
                  {freq === 'twice' ? (
                    <Segmented label="Paydays" value={twice} options={[{ value: '1-15', label: '1st and 15th' }, { value: '15-last', label: '15th and last day' }]} onChange={setTwice} />
                  ) : (
                    <Field label="Next payday" error={errors.nextPay}>
                      {(id) => <input id={id} className="input" type="date" min={session.today} value={nextPay} onChange={(e) => setNextPay(e.target.value)} />}
                    </Field>
                  )}
                  <Field label="Usual paycheck amount (optional)" error={errors.payAmount} hint={varies ? 'It will be shown as “amount unknown” and not counted until you add an amount.' : 'After taxes — what actually arrives in your account.'}>
                    {(id) => <AmountInput id={id} value={varies ? '' : payAmount} onChange={setPayAmount} currency={cur} disabled={varies} />}
                  </Field>
                  <label className="check"><input type="checkbox" checked={varies} onChange={(e) => setVaries(e.target.checked)} /> It varies</label>
                </>
              ) : (
                <div className="callout">No problem. Clarity won't assume any income. You can add income sources later in Planning.</div>
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
          {step === 1 && <button type="button" className="btn btn-ghost" onClick={() => { setFreq('none'); setStep(2); }}>Skip</button>}
          {step === 2 && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setSkipBill(true); void finish(false); }}>Skip</button>}
          <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>{step === 2 ? (busy ? <><Spinner /> Saving…</> : 'See my overview') : 'Continue'}</button>
        </div>
        <p className="hint" style={{ marginTop: 16 }}>{formatMonthYear(session.today)} · Everything stays on this device.</p>
      </form>
    </div>
  );
}
