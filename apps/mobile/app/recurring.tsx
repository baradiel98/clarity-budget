import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createRecurring, updateRecurring, type RecurringInput } from '@clarity/data';
import { nextScheduleDate } from '@clarity/engine';
import { addDays, centsToDecimalString, parseAmountInput, parseISO, type RecurringAmount, type RecurringItem, type RecurringKind, type Schedule, type WeekendRule } from '@clarity/shared';
import { Check } from '../src/features/Welcome';
import { useData, useRun, useSession } from '../src/state/session';
import { Button, LinkButton } from '../src/ui/Button';
import { DateField } from '../src/ui/DateField';
import { Field, Input } from '../src/ui/Field';
import { Segmented } from '../src/ui/Segmented';
import { T } from '../src/ui/Text';
import { useTheme } from '../src/ui/theme';
import { Chip } from './add';

let pending: { item?: RecurringItem; kind: RecurringKind } = { kind: 'bill' };
export const setRecurringEdit = (p: { item?: RecurringItem; kind: RecurringKind }) => (pending = p);

type Freq = 'once' | 'weekly' | 'biweekly' | 'twice' | 'monthly' | 'quarterly' | 'yearly';

export default function RecurringForm() {
  const [{ item, kind: initialKind }] = useState(() => pending);
  const data = useData();
  const { today } = useSession();
  const run = useRun();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const cur = data.settings.baseCurrency;
  const s = item?.schedule;
  const initFreq: Freq = !s ? 'monthly' : s.freq === 'once' ? 'once' : s.freq === 'weekly' ? (s.interval === 2 ? 'biweekly' : 'weekly') : s.freq === 'twice_monthly' ? 'twice' : s.freq === 'monthly' ? (s.interval === 3 ? 'quarterly' : s.interval === 12 ? 'yearly' : 'monthly') : 'weekly';
  const [kind, setKind] = useState<RecurringKind>(item?.kind ?? initialKind);
  const [name, setName] = useState(item?.name ?? '');
  const [accountId, setAccountId] = useState(item?.accountId ?? data.settings.defaultAccountId ?? data.accounts.find((a) => a.spendable)?.id ?? '');
  const [toAccountId, setToAccountId] = useState(item?.toAccountId ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(item?.categoryId ?? (initialKind === 'income' ? 'cat_paycheck' : null));
  const [amountType, setAmountType] = useState<RecurringAmount['type']>(item?.amount.type ?? 'fixed');
  const [amount, setAmount] = useState(item && 'cents' in item.amount ? centsToDecimalString(item.amount.cents) : '');
  const [freq, setFreq] = useState<Freq>(initFreq);
  const [date, setDate] = useState((s && nextScheduleDate(s, today)) ?? addDays(today, 7));
  const [twice, setTwice] = useState<'1-15' | '15-last'>(s?.freq === 'twice_monthly' && s.day1 === 15 ? '15-last' : '1-15');
  const [lastDay, setLastDay] = useState(s?.freq === 'monthly' && s.day === 'last');
  const [weekendRule, setWeekendRule] = useState<WeekendRule>(item?.weekendRule ?? 'none');
  const [error, setError] = useState<string | null>(null);
  const isTransfer = kind === 'transfer' || kind === 'savings';
  const toCard = data.accounts.find((a) => a.id === toAccountId)?.type === 'credit_card';
  const accounts = data.accounts.filter((a) => !a.archived);

  const save = async () => {
    const cents = parseAmountInput(amount, cur);
    if ((amountType === 'fixed' || amountType === 'variable') && !cents) return setError('Enter an amount.');
    const schedule: Schedule =
      freq === 'once' ? { freq: 'once', date }
      : freq === 'weekly' ? { freq: 'weekly', interval: 1, anchor: date }
      : freq === 'biweekly' ? { freq: 'weekly', interval: 2, anchor: date }
      : freq === 'twice' ? (twice === '1-15' ? { freq: 'twice_monthly', day1: 1, day2: 15 } : { freq: 'twice_monthly', day1: 15, day2: 'last' })
      : { freq: 'monthly', interval: freq === 'quarterly' ? 3 : freq === 'yearly' ? 12 : 1, day: lastDay ? 'last' : parseISO(date).d, anchor: date };
    const amt: RecurringAmount = amountType === 'fixed' || amountType === 'variable' ? { type: amountType, cents: cents! } : { type: amountType };
    const input: RecurringInput = { name: name.trim() || (kind === 'income' ? 'Income' : 'Bill'), kind, accountId, ...(isTransfer && toAccountId ? { toAccountId } : {}), categoryId: isTransfer ? null : categoryId, schedule, amount: amt, weekendRule };
    const r = await run((ctx) => (item ? updateRecurring(ctx, item.id, input) : createRecurring(ctx, input)));
    if (!r.ok) setError(r.errors.map((e) => e.message).join(' '));
    else router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
        <LinkButton title="Cancel" color="textSecondary" onPress={() => router.back()} />
        <T variant="headline" accessibilityRole="header">{item ? `Edit ${item.name}` : kind === 'income' ? 'Add income' : isTransfer ? 'Add transfer' : 'Add bill'}</T>
        <View style={{ width: 52 }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, gap: 16, paddingBottom: 24 }}>
        {!item && kind !== 'income' && (
          <Segmented label="Kind" value={kind} onChange={setKind} options={isTransfer ? [{ value: 'savings', label: 'Savings' }, { value: 'transfer', label: 'Transfer / card' }] : [{ value: 'bill', label: 'Bill' }, { value: 'subscription', label: 'Subscription' }]} />
        )}
        <Field label="Name"><Input value={name} onChangeText={setName} placeholder={kind === 'income' ? 'Paycheck' : isTransfer ? 'Savings, Card payment' : 'Rent, Phone'} /></Field>
        <Field label={kind === 'income' ? 'Paid into' : 'From account'}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{accounts.map((a) => <Chip key={a.id} label={a.name} on={a.id === accountId} onPress={() => setAccountId(a.id)} />)}</ScrollView>
        </Field>
        {isTransfer && (
          <Field label="To account">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{accounts.filter((a) => a.id !== accountId).map((a) => <Chip key={a.id} label={a.name} on={a.id === toAccountId} onPress={() => setToAccountId(a.id)} />)}</ScrollView>
          </Field>
        )}
        {!isTransfer && (
          <Field label="Category">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{data.categories.filter((x) => !x.archived && x.kind === (kind === 'income' ? 'income' : 'expense')).map((x) => <Chip key={x.id} label={x.name} on={x.id === categoryId} onPress={() => setCategoryId(x.id)} />)}</ScrollView>
          </Field>
        )}
        <Field label="Amount" hint={amountType === 'variable' ? 'Uses your estimate until there is history, then the average of the last 3 payments.' : amountType === 'unknown' ? 'Counts as $0 until you add an amount. Clarity never invents income.' : amountType === 'card_full_balance' ? 'Pays whatever the card owes that day.' : undefined}>
          <Segmented label="Amount type" value={amountType} onChange={setAmountType} options={[{ value: 'fixed', label: 'Fixed' }, { value: 'variable', label: 'Varies' }, ...(kind === 'income' ? [{ value: 'unknown' as const, label: "Don't know" }] : []), ...(isTransfer && toCard ? [{ value: 'card_full_balance' as const, label: 'Full balance' }] : [])]} />
          {(amountType === 'fixed' || amountType === 'variable') && <Input value={amount} onChangeText={(t) => setAmount(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" />}
        </Field>
        <Field label="How often">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {([['once', 'One time'], ['weekly', 'Weekly'], ['biweekly', 'Every 2 weeks'], ['twice', 'Twice a month'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']] as [Freq, string][]).map(([v, l]) => <Chip key={v} label={l} on={freq === v} onPress={() => setFreq(v)} />)}
          </ScrollView>
        </Field>
        {freq === 'twice' ? (
          <Segmented label="Days" value={twice} onChange={setTwice} options={[{ value: '1-15', label: '1st & 15th' }, { value: '15-last', label: '15th & last day' }]} />
        ) : (
          <Field label={freq === 'once' ? 'Date' : 'Next date'}><DateField label="Date" value={date} onChange={setDate} /></Field>
        )}
        {(freq === 'monthly' || freq === 'quarterly' || freq === 'yearly') && <Check label="Always on the last day of the month" value={lastDay} onChange={setLastDay} />}
        {freq !== 'once' && (
          <Field label="If it falls on a weekend">
            <Segmented label="Weekend rule" value={weekendRule} onChange={setWeekendRule} options={[{ value: 'none', label: 'Keep date' }, { value: 'before', label: 'Friday before' }, { value: 'after', label: 'Monday after' }]} />
          </Field>
        )}
        {error && <T color="negative" accessibilityRole="alert">{error}</T>}
      </ScrollView>
      <View style={{ padding: 16, paddingBottom: insets.bottom + 12 }}><Button title="Save" onPress={() => void save()} /></View>
    </View>
  );
}
