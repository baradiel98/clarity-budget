import { router } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native';
import { clearOccurrenceException, deleteRecurring, engineInput, setOccurrenceException, setRecurringPaused } from '@clarity/data';
import { annualEquivalentCents, applyWeekendRule, balanceOnDate, buildForecast, describeSchedule, monthlyEquivalentCents, nextScheduleDate, type Occurrence } from '@clarity/engine';
import { addDays, endOfMonth, formatShortDate, formatWeekdayDate, TERMS, type RecurringItem } from '@clarity/shared';
import { setAddPrefill, setExplain } from '../../src/state/nav';
import { useData, useRun, useSession, useStore } from '../../src/state/session';
import { LinkButton } from '../../src/ui/Button';
import { Badge, Card } from '../../src/ui/Card';
import { DateField } from '../../src/ui/DateField';
import { IconBubble, ListRow } from '../../src/ui/ListRow';
import { Money } from '../../src/ui/Money';
import { Screen } from '../../src/ui/Screen';
import { StatusBadge } from '../../src/ui/status';
import { T } from '../../src/ui/Text';
import { useTheme } from '../../src/ui/theme';
import { useToast } from '../../src/ui/Toast';
import { setRecurringEdit } from '../recurring';

/** Small cross-platform action sheet. */
function choose(title: string, options: { label: string; destructive?: boolean; run: () => void }[]) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options.map((o) => o.label), 'Cancel'], cancelButtonIndex: options.length, destructiveButtonIndex: options.findIndex((o) => o.destructive) },
      (i) => options[i]?.run(),
    );
  } else {
    Alert.alert(title, undefined, [...options.map((o) => ({ text: o.label, style: o.destructive ? ('destructive' as const) : ('default' as const), onPress: o.run })), { text: 'Cancel', style: 'cancel' }]);
  }
}

export default function Planning() {
  const data = useData();
  const { today } = useSession();
  const { store } = useStore();
  const run = useRun();
  const toast = useToast();
  const { c } = useTheme();
  const cur = data.settings.baseCurrency;
  const [target, setTarget] = useState(endOfMonth(today));
  const forecast = useMemo(() => buildForecast({ today, horizonEnd: addDays(today, 45), accounts: data.accounts, transactions: data.transactions, recurring: data.recurring, exceptions: data.exceptions, baseCurrency: cur, includeEstimatedIncome: true }), [data, today, cur]);
  const onDate = useMemo(() => balanceOnDate(engineInput(data, today), target), [data, today, target]);

  const occActions = (o: Occurrence, isIncome: boolean) =>
    choose(`${o.name} · ${formatShortDate(o.date)}`, o.status === 'skipped'
      ? [{ label: 'Restore', run: () => void run((ctx) => clearOccurrenceException(ctx, o)) }]
      : [
          { label: isIncome ? 'Record as received' : 'Mark paid', run: () => { setAddPrefill({ occurrenceRef: { recurringId: o.recurringId, originalDate: o.originalDate }, occurrenceName: o.name, ...(o.amountCents ? { amountCents: o.amountCents } : {}) }); router.push('/add'); } },
          { label: 'Skip this one', run: async () => { const r = await run((ctx) => setOccurrenceException(ctx, o, 'skip'), { undoLabel: 'Skip' }); if (r.ok) toast({ message: `${o.name} skipped`, action: { label: 'Undo', run: () => void store.undo() } }); } },
        ]);

  const itemActions = (r: RecurringItem) =>
    choose(r.name, [
      { label: 'Edit', run: () => { setRecurringEdit({ item: r, kind: r.kind }); router.push('/recurring'); } },
      { label: r.paused ? 'Resume' : 'Pause', run: () => void run((ctx) => setRecurringPaused(ctx, r.id, !r.paused)) },
      { label: 'Delete', destructive: true, run: async () => { const res = await run((ctx) => deleteRecurring(ctx, r.id), { undoLabel: 'Delete' }); if (res.ok) toast({ message: `${r.name} deleted`, action: { label: 'Undo', run: () => void store.undo() } }); } },
    ]);

  const group = (kinds: RecurringItem['kind'][]) => data.recurring.filter((r) => kinds.includes(r.kind));
  const monthly = (items: RecurringItem[]) => items.reduce((s, r) => s + (r.paused || r.amount.type === 'unknown' || r.amount.type === 'card_full_balance' ? 0 : monthlyEquivalentCents(r.schedule, r.amount.cents)), 0);
  const yearly = (items: RecurringItem[]) => items.reduce((s, r) => s + (r.paused || r.amount.type === 'unknown' || r.amount.type === 'card_full_balance' ? 0 : annualEquivalentCents(r.schedule, r.amount.cents)), 0);

  const Section = ({ title, kinds, addKind }: { title: string; kinds: RecurringItem['kind'][]; addKind: RecurringItem['kind'] }) => {
    const items = group(kinds);
    return (
      <Card title={title} right={<Pressable accessibilityRole="button" accessibilityLabel={`Add to ${title}`} hitSlop={10} onPress={() => { setRecurringEdit({ kind: addKind }); router.push('/recurring'); }}><Plus size={20} color={c.accent} /></Pressable>}>
        {items.length === 0 ? <T color="textSecondary">{addKind === 'income' ? 'No income added. Your forecast assumes no money coming in.' : 'Nothing yet.'}</T> : items.map((r, i) => {
          const next = nextScheduleDate(r.schedule, today);
          const amt = r.amount.type === 'unknown' ? 'Unknown' : r.amount.type === 'card_full_balance' ? 'Full balance' : null;
          return (
            <ListRow
              key={r.id}
              last={i === items.length - 1}
              onPress={() => itemActions(r)}
              icon={<IconBubble tone={r.kind === 'income' ? 'inflow' : 'neutral'}>{r.kind === 'income' ? <ArrowDownLeft size={16} color={c.positive} /> : r.kind === 'transfer' || r.kind === 'savings' ? <ArrowLeftRight size={16} color={c.textSecondary} /> : <ArrowUpRight size={16} color={c.textSecondary} />}</IconBubble>}
              title={r.name}
              subtitle={`${describeSchedule(r.schedule)}${next && !r.paused ? ` · next ${formatShortDate(applyWeekendRule(next, r.weekendRule))}` : ''}${r.paused ? ' · Paused' : ''}`}
              right={amt ? <T color="textTertiary">{amt}</T> : <Money cents={(r.amount as { cents: number }).cents} currency={cur} style={{ fontFamily: 'Inter_600SemiBold' }} />}
            />
          );
        })}
        {monthly(items) > 0 && <T variant="footnote" color="textSecondary" style={{ marginTop: 8 }}>About {''}<Money cents={monthly(items)} currency={cur} variant="footnote" color="textSecondary" /> a month{addKind === 'bill' ? ' · ' : ''}{addKind === 'bill' ? <Money cents={yearly(items)} currency={cur} variant="footnote" color="textSecondary" /> : null}{addKind === 'bill' ? ' a year' : ''}</T>}
      </Card>
    );
  };

  return (
    <Screen title={TERMS.tabs.planning} subtitle="Income, bills and transfers that shape your forecast.">
      <Card title="Balance on a date">
        <DateField label="Date" value={target} minimum={today} onChange={setTarget} />
        <Money cents={onDate.cents} currency={cur} variant="title1" style={{ marginTop: 10 }} />
        <T variant="footnote" color="textSecondary">Projected available cash at the end of {formatShortDate(onDate.date)}.</T>
        <LinkButton title={TERMS.whyThisNumber} onPress={() => { setExplain(onDate.explanation); router.push('/explain'); }} />
      </Card>

      <Card title="Next 45 days">
        {forecast.days.filter((d) => d.events.length).length === 0 && <T color="textSecondary">Nothing scheduled yet.</T>}
        {forecast.days.filter((d) => d.events.length || forecast.excludedEvents.some((e) => e.date === d.date)).map((d) => (
          <View key={d.date} style={{ borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T variant="footnote" style={{ fontFamily: 'Inter_600SemiBold' }}>{formatWeekdayDate(d.date)}</T>
              <Money cents={d.endCashCents} currency={cur} variant="footnote" color={d.endCashCents < 0 ? 'negative' : 'textSecondary'} />
            </View>
            {[...d.events, ...forecast.excludedEvents.filter((e) => e.date === d.date)].map((e) => {
              const isIncome = e.occurrence?.kind === 'income' || (e.source === 'scheduled_tx' && (e.legs[0]?.deltaCents ?? 0) > 0);
              const cents = e.cashDeltaCents || (e.legs[0]?.deltaCents ?? 0);
              return (
                <Pressable key={e.id} disabled={!e.occurrence} onPress={() => e.occurrence && occActions(e.occurrence, isIncome)} accessibilityRole={e.occurrence ? 'button' : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                  <T style={{ flex: 1 }} numberOfLines={1}>{e.label}</T>
                  {e.excluded ? <Badge label={e.excluded === 'unknown_amount' ? 'Amount unknown' : 'Not counted'} tone="warn" /> : e.occurrence && e.occurrence.status !== 'expected' ? <StatusBadge u={{ status: e.occurrence.status, isIncome }} /> : null}
                  {e.excluded ? <T color="textTertiary">—</T> : <Money cents={cents} currency={cur} sign="always" color={cents > 0 ? 'positive' : 'text'} style={{ fontFamily: 'Inter_600SemiBold' }} />}
                </Pressable>
              );
            })}
          </View>
        ))}
      </Card>

      <Section title="Income" kinds={['income']} addKind="income" />
      <Section title="Bills & subscriptions" kinds={['bill', 'subscription']} addKind="bill" />
      <Section title="Transfers & savings" kinds={['transfer', 'savings']} addKind="savings" />
    </Screen>
  );
}
