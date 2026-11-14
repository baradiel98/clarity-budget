import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CircleAlert, CircleHelp, Info, Sparkles } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { buildHomeView, recentRow, upcomingLaterPreview } from '@clarity/data';
import type { Explanation, UpcomingItem } from '@clarity/engine';
import { formatCents, formatShortDate, formatWeekdayDate, INCOME_STATUS_LABEL, OCCURRENCE_STATUS_LABEL, STATUS_HELP, TERMS, UPCOMING_LATER_TITLE, UPCOMING_NOTE, type ISODate, type WorkspaceData } from '@clarity/shared';
import type { AddPrefill } from '../state/nav';
import { Button, LinkButton } from '../ui/Button';
import { Card } from '../ui/Card';
import { ForecastChart } from '../ui/ForecastChart';
import { CategoryIcon } from '../ui/icons';
import { IconBubble, ListRow } from '../ui/ListRow';
import { Money } from '../ui/Money';
import { StatusBadge } from '../ui/status';
import { T } from '../ui/Text';
import { ambientGlow, useTheme } from '../ui/theme';

export interface HomeActions {
  explain: (ex: Explanation) => void;
  open: (path: '/capture' | '/afford' | '/manage/backup' | '/transactions' | '/planning') => void;
  /** Open Add: record an upcoming occurrence, or edit a recorded transaction. */
  add: (prefill: AddPrefill) => void;
}

/**
 * Mobile Home. Same information as the web dashboard, from the same shared view model (`buildHomeView`):
 * every amount is the engine's. Details sit behind "Why this number?" and the status help toggle.
 */
export function HomeView({ data, today, backup, actions }: { data: WorkspaceData; today: ISODate; backup: { due: boolean; reason: string | null }; actions: HomeActions }) {
  const { c } = useTheme();
  const cur = data.settings.baseCurrency;
  const view = useMemo(() => buildHomeView(data, today), [data, today]);
  const d = view.dashboard;
  const sts = d.safeToSpend;
  const [chartW, setChartW] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const cats = useMemo(() => new Map(data.categories.map((x) => [x.id, x])), [data.categories]);
  const lb = d.lowestBeforeNextIncome;
  const delta = view.monthEndDeltaCents;
  const later = upcomingLaterPreview(d);
  const statuses = [...new Map(d.upcoming.map((u) => [`${u.status}:${u.isIncome}`, u])).values()];

  return (
    <>
      <Pressable testID="capture-launch" accessibilityRole="button" accessibilityLabel="Clarity Capture. Tell Clarity what you spent." onPress={() => actions.open('/capture')}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: c.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: c.accentSoft }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Sparkles size={16} color={c.accent} /></View>
        <View style={{ flex: 1 }}>
          <T style={{ fontFamily: 'Inter_600SemiBold' }}>Clarity Capture</T>
          <T variant="footnote" color="textSecondary">Tell Clarity what you spent. We’ll organize it for you.</T>
        </View>
      </Pressable>
      {backup.due && (
        <Pressable onPress={() => actions.open('/manage/backup')} accessibilityRole="button" style={{ flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border }}>
          <Info size={18} color={c.textTertiary} />
          <T variant="callout" style={{ flex: 1 }}>{backup.reason} Tap to back up.</T>
        </Pressable>
      )}

      <View style={{ gap: 16 }}>
        {/* soft ambient blue light behind the headline cards (decorative) */}
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', top: -40, left: 0, right: 0, bottom: -24, backgroundImage: ambientGlow(c) }} />

        {/* 1. Where you are heading */}
        <Card title={TERMS.projectedMonthEnd} glow="hero">
          <Money cents={d.monthEnd.cents} currency={cur} variant="hero" color={d.monthEnd.cents < 0 ? 'negative' : 'text'} testID="month-end" numberOfLines={1} adjustsFontSizeToFit />
          <T variant="footnote" color="textSecondary" testID="month-end-delta">
            <Money cents={Math.abs(delta)} currency={cur} variant="footnote" color="textSecondary" /> {delta >= 0 ? 'more' : 'less'} than you have today, by {formatShortDate(d.monthEnd.date)}.
          </T>
          <LinkButton title={TERMS.whyThisNumber} onPress={() => actions.explain(d.monthEnd.explanation)} />
        </Card>

        {/* 2. Safe to Spend, with the engine's own arithmetic summary */}
        <Card title={TERMS.safeToSpend} glow="sts">
          <View testID="safe-to-spend">
            {sts.cents < 0 ? (
              <View><T variant="footnote" color="negative">{TERMS.shortBy}</T><Money cents={sts.shortfallCents} currency={cur} variant="display" color="negative" numberOfLines={1} adjustsFontSizeToFit /></View>
            ) : (
              <Money cents={sts.cents} currency={cur} variant="display" numberOfLines={1} adjustsFontSizeToFit />
            )}
          </View>
          <T variant="footnote" color={sts.cents >= 0 && !sts.dependableIncome ? 'warning' : 'textSecondary'} testID="sts-caption">
            {`${sts.cents < 0 ? `What is scheduled is more than your cash and reserve cover through ${formatShortDate(sts.horizonEnd)}.` : sts.caption} Your balance is lowest on ${formatShortDate(sts.lowPoint.date)}.`}
          </T>
          {sts.nextAfterNote && <T variant="footnote" color="textSecondary" testID="sts-next" style={{ marginTop: 6 }}>{sts.nextAfterNote}</T>}
          {sts.afterLow.note && <T variant="footnote" color="textTertiary" testID="sts-after" style={{ marginTop: 6 }}>{sts.afterLow.note}</T>}
          {sts.excludedIncome.length > 0 && (
            <T variant="footnote" color="textTertiary" style={{ marginTop: 6 }}>{sts.excludedIncome.length} income item{sts.excludedIncome.length > 1 ? 's are' : ' is'} not counted because the amount is estimated, unknown or not yet recorded.</T>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <LinkButton title={TERMS.whyThisNumber} onPress={() => actions.explain(sts.explanation)} />
            <Button title={TERMS.canIAfford} kind="secondary" small onPress={() => actions.open('/afford')} />
          </View>
        </Card>
      </View>

      {/* 3. Supporting figures, 2 × 2. Tap a figure for "Why this number?". Repeated figures say so. */}
      <Card title="Key balances">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 14 }} testID="key-balances">
          <Stat testID="recorded-balance" label={TERMS.recordedBalance} cents={d.balances.availableCashCents} cur={cur}
            sub={d.balances.cardOwedCents > 0 ? `Cards owe ${formatCents(d.balances.cardOwedCents, cur, { compact: true })}` : 'Across spendable accounts'} onWhy={() => actions.explain(d.recordedBalanceExplanation)} />
          <Stat testID="lowest" label={TERMS.lowestBalance} cents={d.lowestThroughMonthEnd.cents} cur={cur}
            sub={`${formatShortDate(d.lowestThroughMonthEnd.date)} · through month-end`} onWhy={() => actions.explain(d.lowestThroughMonthEnd.explanation)} />
          {lb ? (
            <Stat testID="lowest-before-income" label={TERMS.lowestBeforeIncome} cents={lb.cents} cur={cur} repeat={view.sameLow}
              sub={view.sameLow ? `Same low point (${formatShortDate(lb.date)}), before your ${formatShortDate(lb.nextIncome.date)} income` : `${formatShortDate(lb.date)} · next income ${formatShortDate(lb.nextIncome.date)}`}
              onWhy={() => actions.explain(lb.explanation)} />
          ) : (
            <Stat testID="lowest-before-income" label={TERMS.lowestBeforeIncome} cents={null} cur={cur} sub="No income with a known amount is scheduled" />
          )}
          <Stat testID="end-of-day" label={TERMS.endOfDay} cents={d.endOfDay.cents} cur={cur} repeat={view.quietToday}
            sub={view.quietToday ? 'Nothing else is scheduled today' : 'After what is scheduled today'} onWhy={() => actions.explain(d.endOfDay.explanation)} />
        </View>
      </Card>

      <Card title="Where your cash is heading">
        <View onLayout={(e) => setChartW(e.nativeEvent.layout.width)}>
          <ForecastChart forecast={d.forecast} currency={cur} low={d.lowestThroughMonthEnd} reserve={data.settings.minReserveCents} width={chartW} />
        </View>
        <T variant="caption" color="textTertiary" style={{ marginTop: 6 }}>
          Lowest {formatCents(d.lowestThroughMonthEnd.cents, cur)} on {formatShortDate(d.lowestThroughMonthEnd.date)}
        </T>
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
          {d.warnings.length > 5 && <LinkButton title={`${d.warnings.length - 5} more in Planning`} onPress={() => actions.open('/planning')} />}
        </Card>
      )}

      {/* 4. Upcoming: names shown in full (they wrap), estimated amounts marked ≈, statuses explained on request */}
      <Card title={`${TERMS.upcoming} · through ${formatShortDate(d.upcomingUntil)}`}>
        {d.upcoming.length === 0 && d.upcomingLater.length === 0 ? (
          <T color="textSecondary" testID="upcoming-empty">No bills, paychecks or planned expenses through {formatShortDate(d.upcomingLaterUntil)}.</T>
        ) : (
          <View testID="upcoming">
            <T variant="footnote" color="textTertiary" style={{ marginBottom: 4 }}>{UPCOMING_NOTE}</T>
            {d.upcoming.length === 0 && <T color="textSecondary" testID="upcoming-none">Nothing scheduled through {formatShortDate(d.upcomingUntil)}.</T>}
            {d.upcoming.map((u, i) => (
              <ListRow
                key={u.id}
                testID="upcoming-row"
                last={i === d.upcoming.length - 1}
                titleLines={0}
                icon={<IconBubble tone={u.isIncome ? 'inflow' : 'neutral'}>{u.isIncome ? <ArrowDownLeft size={17} color={c.positive} /> : <ArrowUpRight size={17} color={c.textSecondary} />}</IconBubble>}
                title={u.label}
                subtitle={
                  <View style={{ gap: 3 }}>
                    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><T variant="footnote" color="textTertiary">{formatWeekdayDate(u.date)}</T><StatusBadge u={u} /></View>
                    {!u.affectsCash && <T variant="caption" color="textTertiary">Charged to a card, not from cash</T>}
                  </View>
                }
                right={<UpcomingAmount u={u} cur={cur} />}
                accessibilityLabel={upcomingSpoken(u, cur)}
                {...(u.occurrence && u.status !== 'skipped'
                  ? { onPress: () => actions.add({ occurrenceRef: { recurringId: u.occurrence!.recurringId, originalDate: u.occurrence!.originalDate }, occurrenceName: u.label, ...(u.occurrence!.amountCents ? { amountCents: u.occurrence!.amountCents } : {}) }) }
                  : {})}
              />
            ))}
            {later.shown.length > 0 && (
              <View testID="upcoming-later" style={{ marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: c.border, gap: 6 }}>
                <T variant="overline" color="textSecondary" accessibilityRole="header">{UPCOMING_LATER_TITLE}</T>
                {later.shown.map((u) => (
                  <View key={u.id} testID="upcoming-later-row" style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }} accessible accessibilityLabel={upcomingSpoken(u, cur).replace(/ Tap to .*$/, '')}>
                    <T variant="footnote" color="textTertiary" style={{ width: 52 }}>{formatShortDate(u.date)}</T>
                    <T variant="callout" style={{ flex: 1 }}>{u.label}{!u.affectsCash ? ' · card' : ''}</T>
                    <UpcomingAmount u={u} cur={cur} />
                  </View>
                ))}
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
                  <T variant="footnote" color="textTertiary">{later.more > 0 ? `${later.more} more through ${formatShortDate(later.until)}.` : `Safe to Spend looks through ${formatShortDate(later.until)}.`}</T>
                  <LinkButton title="See all in Planning" onPress={() => actions.open('/planning')} />
                </View>
              </View>
            )}
            <LinkButton title={showHelp ? 'Hide what the labels mean' : 'What do these labels mean?'} onPress={() => setShowHelp((v) => !v)} />
            {showHelp && (
              <View testID="status-help" style={{ gap: 8, marginTop: 4 }}>
                {statuses.map((u) => (
                  <View key={`${u.status}:${u.isIncome}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                    <StatusBadge u={u} />
                    <T variant="footnote" color="textSecondary" style={{ flex: 1 }}>{STATUS_HELP[u.status](u.isIncome)}</T>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
      </Card>

      {/* 5. Recent transactions */}
      <Card title="Recent transactions" right={view.recent.length > 0 ? <LinkButton title="View all" onPress={() => actions.open('/transactions')} /> : undefined}>
        {view.recent.length === 0 ? (
          <T color="textSecondary" testID="recent-empty">Nothing recorded yet. Add a purchase or import a statement.</T>
        ) : (
          <View testID="recent">
            {view.recent.map((t, i) => {
              const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
              const r = recentRow(t, cat?.name);
              return (
                <ListRow
                  key={t.id}
                  testID="recent-row"
                  last={i === view.recent.length - 1}
                  icon={<IconBubble tone={r.inflow ? 'inflow' : 'neutral'}><CategoryIcon name={t.kind === 'transfer' ? 'transfer' : t.kind === 'adjustment' ? 'adjustment' : cat?.icon} color={r.inflow ? c.positive : c.textSecondary} /></IconBubble>}
                  title={r.title}
                  subtitle={`${formatShortDate(t.date)} · ${r.meta}`}
                  right={<Money cents={r.cents} currency={cur} sign={r.sign} color={r.inflow ? 'positive' : 'text'} style={{ fontFamily: 'Inter_600SemiBold' }} />}
                  onPress={() => actions.add({ editId: t.id })}
                  accessibilityLabel={`Edit ${r.title}`}
                />
              );
            })}
          </View>
        )}
      </Card>
    </>
  );
}

function Stat({ label, cents, cur, sub, onWhy, repeat, testID }: { label: string; cents: number | null; cur: string; sub: string; onWhy?: () => void; repeat?: boolean; testID?: string }) {
  const { c } = useTheme();
  return (
    <View style={{ width: '50%', paddingRight: 10 }} testID={testID}>
      <Pressable onPress={onWhy} disabled={!onWhy} accessibilityRole={onWhy ? 'button' : undefined} accessibilityLabel={onWhy ? `${TERMS.whyThisNumber} ${label}` : undefined} hitSlop={6}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <T variant="caption" color="textTertiary" style={{ flexShrink: 1 }}>{label}</T>
        {onWhy && <CircleHelp size={13} color={c.textTertiary} />}
      </Pressable>
      {cents === null ? (
        <T variant="headline" color="textTertiary">—</T>
      ) : (
        <Money cents={cents} currency={cur} variant="headline" color={repeat ? 'textSecondary' : cents < 0 ? 'negative' : 'text'} numberOfLines={1} adjustsFontSizeToFit />
      )}
      <T variant="caption" color="textTertiary">{sub}</T>
    </View>
  );
}

function UpcomingAmount({ u, cur }: { u: UpcomingItem; cur: string }) {
  if (u.status === 'unknown') return <T color="textTertiary">—</T>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, alignSelf: 'flex-start', paddingTop: 1 }}>
      {u.status === 'estimated' && <T color="warning" accessibilityLabel="about" style={{ fontFamily: 'Inter_600SemiBold' }}>≈</T>}
      <Money cents={u.cents} currency={cur} sign="always" color={u.cents > 0 ? 'positive' : 'text'} style={{ fontFamily: 'Inter_600SemiBold' }} />
    </View>
  );
}

/** One spoken line per row: name, date, status and what it means, amount, and what tapping does. */
function upcomingSpoken(u: UpcomingItem, cur: string): string {
  const label = (u.isIncome ? INCOME_STATUS_LABEL : OCCURRENCE_STATUS_LABEL)[u.status];
  const amount = u.status === 'unknown' ? 'amount unknown' : `${u.status === 'estimated' ? 'about ' : ''}${formatCents(u.cents, cur, { sign: 'always' })}`;
  const tap = u.occurrence && u.status !== 'skipped' ? ` Tap to ${u.isIncome ? 'record as received' : 'mark paid'}.` : '';
  return `${u.label}, ${formatWeekdayDate(u.date)}. ${label}: ${STATUS_HELP[u.status](u.isIncome)} ${amount}.${tap}`;
}
