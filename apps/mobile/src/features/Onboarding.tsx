import { useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { engineInput, onboard, type OnboardingInput } from '@clarity/data';
import { buildDashboard } from '@clarity/engine';
import { addDays, formatShortDate, monthNameLong, parseAmountInput, parseISO, type Schedule } from '@clarity/shared';
import { useData, useRun, useSession } from '../state/session';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DateField } from '../ui/DateField';
import { Field, Input } from '../ui/Field';
import { Keypad } from '../ui/Keypad';
import { Money } from '../ui/Money';
import { Segmented } from '../ui/Segmented';
import { T } from '../ui/Text';
import { useTheme } from '../ui/theme';
import { Panel } from './Panel';
import { Check } from './Welcome';

type Freq = 'weekly' | 'biweekly' | 'twice' | 'monthly' | 'none';

export function scheduleFor(freq: Exclude<Freq, 'none'>, nextDate: string, twice: '1-15' | '15-last'): Schedule {
  if (freq === 'weekly') return { freq: 'weekly', interval: 1, anchor: nextDate };
  if (freq === 'biweekly') return { freq: 'weekly', interval: 2, anchor: nextDate };
  if (freq === 'twice') return twice === '1-15' ? { freq: 'twice_monthly', day1: 1, day2: 15 } : { freq: 'twice_monthly', day1: 15, day2: 'last' };
  return { freq: 'monthly', interval: 1, day: parseISO(nextDate).d, anchor: nextDate };
}

export function RecoveryKeyView({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const { c } = useTheme();
  const [check, setCheck] = useState('');
  const last = recoveryKey.split('-').pop()!;
  return (
    <Panel step={1} footer={<Button title="I've saved it" disabled={check.trim().toUpperCase() !== last} onPress={onDone} />}>
      <T variant="title1" accessibilityRole="header">Save your recovery key</T>
      <T color="textSecondary">Shown only once. Keep it somewhere safe and separate from this phone, such as a password manager or printed at home.</T>
      <View style={{ backgroundColor: c.surfaceMuted, borderRadius: 14, padding: 16 }}>
        <T selectable style={{ fontFamily: 'Courier', fontSize: 18, lineHeight: 28, textAlign: 'center', letterSpacing: 1 }}>{recoveryKey.replace(/-/g, ' - ')}</T>
      </View>
      <Button title="Save to password manager or notes" kind="secondary" small onPress={() => void Share.share({ message: `Clarity recovery key: ${recoveryKey}` })} />
      <T color="warning" variant="callout">If you lose both your passphrase and this recovery key, no one — including us — can recover your data.</T>
      <Field label={`To confirm, type the last group (${last.length} characters)`}>
        <Input value={check} onChangeText={setCheck} autoCapitalize="characters" autoCorrect={false} />
      </Field>
    </Panel>
  );
}

export function Onboarding() {
  const s = useSession();
  const data = useData();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const [step, setStep] = useState(0);
  const [balance, setBalance] = useState('');
  const [freq, setFreq] = useState<Freq>('biweekly');
  const [nextPay, setNextPay] = useState(addDays(s.today, 7));
  const [twice, setTwice] = useState<'1-15' | '15-last'>('1-15');
  const [pay, setPay] = useState('');
  const [varies, setVaries] = useState(false);
  const [billName, setBillName] = useState('Rent');
  const [billAmount, setBillAmount] = useState('');
  const [billDate, setBillDate] = useState(addDays(s.today, 10));
  const [billMonthly, setBillMonthly] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const done = data.settings.onboardingComplete;
  const dash = useMemo(() => (done ? buildDashboard(engineInput(data, s.today)) : null), [done, data, s.today]);

  if (s.pendingRecoveryKey) return <RecoveryKeyView recoveryKey={s.pendingRecoveryKey} onDone={s.clearPendingRecoveryKey} />;

  const finish = async (withBill: boolean) => {
    const billCents = parseAmountInput(billAmount, cur);
    if (withBill && (!billName.trim() || !billCents)) return setError('Enter the bill name and amount, or skip.');
    const payCents = parseAmountInput(pay, cur);
    const input: OnboardingInput = {
      checkingBalanceCents: parseAmountInput(balance, cur) ?? 0,
      ...(freq !== 'none' ? { pay: { schedule: scheduleFor(freq, nextPay, twice), amountCents: varies || !payCents ? null : payCents } } : {}),
      ...(withBill && billCents ? { bill: { name: billName.trim(), amountCents: billCents, date: billDate, monthly: billMonthly } } : {}),
    };
    setBusy(true);
    const r = await run((ctx) => onboard(ctx, input));
    setBusy(false);
    if (!r.ok) setError(r.errors.map((e) => e.message).join(' '));
    else setStep(3);
  };

  if (step === 3 && dash) {
    const low = dash.lowestThroughMonthEnd;
    return (
      <Panel step={4} footer={<Button title="Go to my dashboard" onPress={s.finishIntro} />}>
        <T variant="overline" color="textSecondary">Your first overview</T>
        <T variant="display" accessibilityRole="header">Here's your {monthNameLong(parseISO(s.today).m)}.</T>
        <Card title="Projected month-end balance">
          <Money cents={dash.monthEnd.cents} currency={cur} variant="hero" />
        </Card>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Card title="Lowest point" style={{ flex: 1 }}><Money cents={low.cents} currency={cur} variant="title2" color={low.cents < 0 ? 'negative' : 'text'} /><T variant="footnote" color="textTertiary">{formatShortDate(low.date)}</T></Card>
          <Card title="Safe to Spend" style={{ flex: 1 }}><Money cents={dash.safeToSpend.cents} currency={cur} variant="title2" color={dash.safeToSpend.cents < 0 ? 'negative' : 'text'} /></Card>
        </View>
        <T color="textSecondary">{low.explanation.summary}</T>
      </Panel>
    );
  }

  if (step === 0) {
    return (
      <Panel step={1} footer={<Button title="Continue" onPress={() => setStep(1)} />}>
        <T variant="title1" accessibilityRole="header">What's in your checking account right now?</T>
        <T color="textSecondary">Use the balance your bank app shows today. You can add savings, cash and cards later.</T>
        <Money cents={parseAmountInput(balance || '0', cur) ?? 0} currency={cur} variant="hero" style={{ textAlign: 'center', marginVertical: 12 }} />
        <Keypad value={balance} onChange={setBalance} />
      </Panel>
    );
  }

  if (step === 1) {
    return (
      <Panel step={2} footer={<><Button title="Continue" onPress={() => setStep(2)} /><Button title="Skip" kind="ghost" onPress={() => { setFreq('none'); setStep(2); }} /></>}>
        <T variant="title1" accessibilityRole="header">When do you get paid?</T>
        <Segmented label="Pay frequency" value={freq} onChange={setFreq} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'biweekly', label: '2 weeks' }, { value: 'twice', label: '2× month' }, { value: 'monthly', label: 'Monthly' }]} />
        {freq === 'twice' ? (
          <Segmented label="Paydays" value={twice} onChange={setTwice} options={[{ value: '1-15', label: '1st & 15th' }, { value: '15-last', label: '15th & last day' }]} />
        ) : (
          <Field label="Next payday"><DateField label="Next payday" value={nextPay} minimum={s.today} onChange={setNextPay} /></Field>
        )}
        {!varies && (
          <Field label="Usual paycheck amount (optional)" hint="After taxes — what actually arrives in your account.">
            <Input value={pay} onChangeText={(t) => setPay(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />
          </Field>
        )}
        <Check label="It varies" hint="It will show as “amount unknown” and won't be counted until you add an amount." value={varies} onChange={setVaries} />
      </Panel>
    );
  }

  return (
    <Panel step={3} footer={<><Button title={busy ? 'Saving…' : 'See my overview'} busy={busy} onPress={() => void finish(true)} /><Button title="Skip" kind="ghost" onPress={() => void finish(false)} /></>}>
      <T variant="title1" accessibilityRole="header">Any big bill coming up?</T>
      <T color="textSecondary">Optional. Rent, a loan or a card payment is a good start.</T>
      <Field label="Name"><Input value={billName} onChangeText={setBillName} /></Field>
      <Field label="Amount"><Input value={billAmount} onChangeText={(t) => setBillAmount(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" /></Field>
      <Field label="Due date"><DateField label="Due date" value={billDate} onChange={setBillDate} /></Field>
      <Check label="Repeats every month" value={billMonthly} onChange={setBillMonthly} />
      {error && <T color="negative" accessibilityRole="alert">{error}</T>}
    </Panel>
  );
}
