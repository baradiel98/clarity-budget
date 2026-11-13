import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { engineInput } from '@clarity/data';
import { canIAfford } from '@clarity/engine';
import { formatShortDate, parseAmountInput, TERMS } from '@clarity/shared';
import { setAddPrefill } from '../src/state/nav';
import { useData, useSession } from '../src/state/session';
import { Button, LinkButton } from '../src/ui/Button';
import { Card } from '../src/ui/Card';
import { DateField } from '../src/ui/DateField';
import { Keypad } from '../src/ui/Keypad';
import { Money } from '../src/ui/Money';
import { T } from '../src/ui/Text';
import { useTheme } from '../src/ui/theme';
import { Chip } from './add';

/** What-if only: runs the engine's Safe to Spend with one hypothetical purchase. Nothing is saved. */
export default function Afford() {
  const data = useData();
  const { today } = useSession();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const cur = data.settings.baseCurrency;
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(data.settings.defaultAccountId ?? data.accounts.find((a) => a.spendable)?.id ?? '');
  const [date, setDate] = useState(today);
  const cents = parseAmountInput(amount || '0', cur) ?? 0;
  const r = useMemo(() => (cents > 0 && accountId ? canIAfford(engineInput(data, today), { amountCents: cents, accountId, date }) : null), [cents, accountId, date, data, today]);
  const tone = r?.verdict === 'yes' ? 'positive' : r?.verdict === 'tight' ? 'warning' : 'negative';
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
        <LinkButton title="Close" color="textSecondary" onPress={() => router.back()} />
        <T variant="headline" accessibilityRole="header">{TERMS.canIAfford}</T>
        <View style={{ width: 44 }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 16 }}>
        <Money cents={cents} currency={cur} variant="hero" style={{ textAlign: 'center' }} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {data.accounts.filter((a) => !a.archived).map((a) => <Chip key={a.id} label={a.name} on={a.id === accountId} onPress={() => setAccountId(a.id)} />)}
        </ScrollView>
        <DateField label="When" value={date} minimum={today} onChange={setDate} />
        {r && (
          <Card>
            <T variant="title2" color={tone}>{r.verdict === 'yes' ? 'Yes, you can afford it' : r.verdict === 'tight' ? 'Tight — it dips into your reserve' : 'Not without coming up short'}</T>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}>
              <View><T variant="caption" color="textTertiary">{TERMS.safeToSpend} now</T><Money cents={r.before.cents} currency={cur} variant="headline" /></View>
              <View style={{ alignItems: 'flex-end' }}><T variant="caption" color="textTertiary">After</T><Money cents={r.after.cents} currency={cur} variant="headline" color={r.after.cents < 0 ? 'negative' : 'text'} /></View>
            </View>
            <T variant="footnote" color="textSecondary" style={{ marginTop: 8 }}>New lowest point: {formatShortDate(r.after.lowPoint.date)}</T>
            {r.verdict === 'no' && <T color="negative">You'd be short {/* engine value */}<Money cents={r.shortfallCents} currency={cur} color="negative" />.</T>}
            {r.notes.map((n) => <T key={n} variant="footnote" color="textSecondary">{n}</T>)}
            <T variant="caption" color="textTertiary" style={{ marginTop: 6 }}>This is a what-if. Nothing has been saved.</T>
          </Card>
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 8, borderTopWidth: 1, borderTopColor: c.border, gap: 8 }}>
        <Keypad value={amount} onChange={setAmount} />
        <Button title="Add as transaction" kind="secondary" disabled={!r} onPress={() => { setAddPrefill({ kind: 'expense', amountCents: cents, accountId, date }); router.replace('/add'); }} />
      </View>
    </View>
  );
}
