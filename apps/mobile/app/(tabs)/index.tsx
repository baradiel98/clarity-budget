import { router } from 'expo-router';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CircleAlert, Info } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { backupDue, engineInput } from '@clarity/data';
import { buildDashboard, type Explanation } from '@clarity/engine';
import { formatCents, formatMonthYear, formatShortDate, formatWeekdayDate, TERMS } from '@clarity/shared';
import { setAddPrefill, setExplain } from '../../src/state/nav';
import { useData, useSession, useStore } from '../../src/state/session';
import { Button, LinkButton } from '../../src/ui/Button';
import { Card, Divider } from '../../src/ui/Card';
import { ForecastChart } from '../../src/ui/ForecastChart';
import { IconBubble, ListRow } from '../../src/ui/ListRow';
import { Money } from '../../src/ui/Money';
import { Screen } from '../../src/ui/Screen';
import { Segmented } from '../../src/ui/Segmented';
import { StatusBadge } from '../../src/ui/status';
import { T } from '../../src/ui/Text';
import { useTheme } from '../../src/ui/theme';

const why = (ex: Explanation) => {
  setExplain(ex);
  router.push('/explain');
};

export default function Home() {
  const data = useData();
  const { today } = useSession();
  const { demo } = useStore();
  const { c } = useTheme();
  const cur = data.settings.baseCurrency;
  const d = useMemo(() => buildDashboard(engineInput(data, today)), [data, today]);
  const [lowMode, setLowMode] = useState<'month' | 'income'>('month');
  const [chartW, setChartW] = useState(0);
  const sts = d.safeToSpend;
  const lowest = lowMode === 'income' && d.lowestBeforeNextIncome ? d.lowestBeforeNextIncome : d.lowestThroughMonthEnd;
  const backup = demo ? { due: false, reason: null } : backupDue(data, Date.now());

  return (
    <Screen title={formatMonthYear(today).split(' ')[0]} subtitle={formatWeekdayDate(today)}>
      {backup.due && (
        <Pressable onPress={() => router.push('/manage/backup')} accessibilityRole="button" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border }}>
          <Info size={18} color={c.textTertiary} />
          <T variant="callout" style={{ flex: 1 }}>{backup.reason} Tap to back up.</T>
        </Pressable>
      )}

      <Card title={TERMS.projectedMonthEnd}>
        <Money cents={d.monthEnd.cents} currency={cur} variant="hero" color={d.monthEnd.cents < 0 ? 'negative' : 'text'} testID="month-end" />
        <T variant="footnote" color="textSecondary">Based on your recorded balance, expected income, upcoming bills, and planned expenses.</T>
        <LinkButton title={TERMS.whyThisNumber} onPress={() => why(d.monthEnd.explanation)} />
      </Card>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Card title={TERMS.safeToSpend} style={{ flex: 1 }}>
          {sts.cents < 0 ? (
            <View><T variant="footnote" color="negative">{TERMS.shortBy}</T><Money cents={sts.shortfallCents} currency={cur} variant="title1" color="negative" /></View>
          ) : (
            <Money cents={sts.cents} currency={cur} variant="title1" testID="safe-to-spend" />
          )}
          <T variant="caption" color="textTertiary">Through {formatShortDate(sts.horizonEnd)}</T>
          <LinkButton title={TERMS.whyThisNumber} onPress={() => why(sts.explanation)} />
        </Card>
        <Card title={TERMS.availableCash} style={{ flex: 1 }}>
          <Money cents={d.balances.availableCashCents} currency={cur} variant="title1" />
          <T variant="caption" color="textTertiary">{d.balances.cardOwedCents > 0 ? `Cards owe ${formatCents(d.balances.cardOwedCents, cur, { compact: true })}` : 'Spendable accounts'}</T>
          <LinkButton title={TERMS.whyThisNumber} onPress={() => why(d.recordedBalanceExplanation)} />
        </Card>
      </View>
      <Button title={TERMS.canIAfford} kind="secondary" onPress={() => router.push('/afford')} />

      <Card title="Where your cash is heading">
        {d.lowestBeforeNextIncome && (
          <View style={{ marginBottom: 12 }}>
            <Segmented label="Lowest balance window" value={lowMode} onChange={setLowMode} options={[{ value: 'month', label: 'To month-end' }, { value: 'income', label: 'Before next pay' }]} />
          </View>
        )}
        <View onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
          <ForecastChart forecast={d.forecast} currency={cur} low={lowest} reserve={data.settings.minReserveCents} width={chartW} />
        </View>
        <Divider />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <T variant="caption" color="textTertiary">{lowMode === 'income' && d.lowestBeforeNextIncome ? TERMS.lowestBeforeIncome : TERMS.lowestBalance}</T>
            <Money cents={lowest.cents} currency={cur} variant="headline" color={lowest.cents < 0 ? 'negative' : 'text'} />
            <T variant="caption" color="textTertiary">{formatShortDate(lowest.date)}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <T variant="caption" color="textTertiary">{TERMS.endOfDay}</T>
            <Money cents={d.endOfDay.cents} currency={cur} variant="headline" />
          </View>
        </View>
        <T variant="footnote" color="textSecondary" style={{ marginTop: 10 }}>{lowest.explanation.summary}</T>
        <LinkButton title={TERMS.whyThisNumber} onPress={() => why(lowest.explanation)} />
      </Card>

      {d.warnings.length > 0 && (
        <Card title="Needs attention">
          {d.warnings.slice(0, 5).map((w) => (
            <View key={w.id} style={{ flexDirection: 'row', gap: 10, paddingVertical: 8 }}>
              {w.severity === 'critical' ? <CircleAlert size={18} color={c.negative} /> : w.severity === 'warning' ? <AlertTriangle size={18} color={c.warning} /> : <Info size={18} color={c.textTertiary} />}
              <View style={{ flex: 1 }}>
                <T style={{ fontFamily: 'Inter_600SemiBold' }}>{w.title}</T>
                <T variant="footnote" color="textSecondary">{w.detail}</T>
              </View>
            </View>
          ))}
        </Card>
      )}

      <Card title={`${TERMS.upcoming} · next 14 days`}>
        {d.upcoming.length === 0 ? (
          <T color="textSecondary">No bills, paychecks or planned expenses in the next two weeks.</T>
        ) : (
          d.upcoming.map((u, i) => (
            <ListRow
              key={u.id}
              last={i === d.upcoming.length - 1}
              icon={<IconBubble tone={u.isIncome ? 'inflow' : 'neutral'}>{u.isIncome ? <ArrowDownLeft size={17} color={c.positive} /> : <ArrowUpRight size={17} color={c.textSecondary} />}</IconBubble>}
              title={u.label}
              subtitle={<View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><T variant="footnote" color="textTertiary">{formatShortDate(u.date)}</T><StatusBadge u={u} /></View>}
              right={u.status === 'unknown' ? <T color="textTertiary">—</T> : <Money cents={u.cents} currency={cur} sign="always" color={u.cents > 0 ? 'positive' : 'text'} style={{ fontFamily: 'Inter_600SemiBold' }} />}
              {...(u.occurrence && u.status !== 'skipped'
                ? {
                    onPress: () => {
                      setAddPrefill({ occurrenceRef: { recurringId: u.occurrence!.recurringId, originalDate: u.occurrence!.originalDate }, occurrenceName: u.label, ...(u.occurrence!.amountCents ? { amountCents: u.occurrence!.amountCents } : {}) });
                      router.push('/add');
                    },
                    accessibilityLabel: `${u.label}, ${formatShortDate(u.date)}. Tap to ${u.isIncome ? 'record as received' : 'mark paid'}.`,
                  }
                : {})}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
