import { router } from 'expo-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronDown, ChevronUp, Plus } from 'lucide-react-native';
import { useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, View } from 'react-native';
import { catchUp, clearOccurrenceException, deleteRecurring, engineInput, estimateNote, paidThisMonth, warningsBesideCatchUp, recurringAmountView, setOccurrenceException, setRecurringPaused } from '@clarity/data';
import { annualEquivalentCents, applyWeekendRule, balanceOnDate, buildDailyLedger, buildDashboard, buildForecast, ledgerAccounts, ledgerDayExplanation, computeSafeToSpend, describeSchedule, monthlyEquivalentCents, nextScheduleDate, planningWindowEnd, type Occurrence } from '@clarity/engine';
import { addDays, CATCHUP_ACTION_LABEL, INCOME_STATUS_LABEL, OCCURRENCE_STATUS_LABEL, CATCHUP_COUNT, CATCHUP_DONE, CATCHUP_HINT, CATCHUP_TITLE, endOfMonth, formatCents, formatShortDate, formatWeekdayDate, LEDGER_ALL_CASH, LEDGER_CARD_NOTE, LEDGER_COVER_BADGE, LEDGER_SHORTFALL_HINT, LEDGER_DAY_DETAILS, LEDGER_DAY_LABEL, LEDGER_SHOW, monthNameLong, PAID_DUE, PAID_EMPTY, PAID_HINT, PAID_TITLE, parseISO, TERMS, type RecurringItem } from '@clarity/shared';
import { setAddPrefill, setExplain } from '../../src/state/nav';
import { useData, useRun, useSession, useStore } from '../../src/state/session';
import { Button, LinkButton } from '../../src/ui/Button';
import { Badge, Card } from '../../src/ui/Card';
import { DateField } from '../../src/ui/DateField';
import { IconBubble, ListRow } from '../../src/ui/ListRow';
import { Money } from '../../src/ui/Money';
import { Screen } from '../../src/ui/Screen';
import { StatusBadge } from '../../src/ui/status';
import { T } from '../../src/ui/Text';
import { useTheme } from '../../src/ui/theme';
import { useToast } from '../../src/ui/Toast';
import { WarningList } from '../../src/ui/WarningList';
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
  const [paidOpen, setPaidOpen] = useState(false);
  const paid = useMemo(() => paidThisMonth(data, today), [data, today]);
  const paidMonth = monthNameLong(parseISO(today).m);
  const windowEnd = useMemo(() => planningWindowEnd(engineInput(data, today)), [data, today]);
  const stsScope = useMemo(() => computeSafeToSpend(engineInput(data, today)), [data, today]);
  // The complete warning list (Phase 4A.4.2): Home shows the first five and links here; it is first on the screen.
  const dash = useMemo(() => buildDashboard(engineInput(data, today)), [data, today]);
  // Phase 4B.4: per-item past-due warnings are listed (with their actions) in the catch-up review instead
  const allWarnings = useMemo(() => warningsBesideCatchUp(dash.warnings), [dash]);
  const pastDue = useMemo(() => catchUp(dash), [dash]);
  const hadPastDue = useRef(pastDue.count > 0);
  if (pastDue.count > 0) hadPastDue.current = true;
  const skip = async (o: Occurrence) => { const r = await run((ctx) => setOccurrenceException(ctx, o, 'skip'), { undoLabel: 'Skip' }); if (r.ok) toast({ message: `${o.name} skipped`, action: { label: 'Undo', run: () => void store.undo() } }); };
  const forecast = useMemo(() => buildForecast({ today, horizonEnd: windowEnd, accounts: data.accounts, transactions: data.transactions, recurring: data.recurring, exceptions: data.exceptions, baseCurrency: cur, includeEstimatedIncome: true }), [data, today, cur, windowEnd]);
  const onDate = useMemo(() => balanceOnDate(engineInput(data, today), target), [data, today, target]);
  // Phase 5A: the schedule for all spendable cash (default) or one account, from the same forecast
  const [scope, setScope] = useState<string>('cash');
  const ledgerChoices = useMemo(() => ledgerAccounts(data.accounts, forecast), [data.accounts, forecast]);
  const scopeId = scope !== 'cash' && ledgerChoices.some((a) => a.id === scope) ? scope : 'cash';
  const scopeName = data.accounts.find((a) => a.id === scopeId)?.name ?? LEDGER_ALL_CASH;
  const ledger = useMemo(() => buildDailyLedger(engineInput(data, today), scopeId === 'cash' ? { kind: 'cash' } : { kind: 'account', accountId: scopeId }, { forecast }), [data, today, scopeId, forecast]);
  const dayDetails = (date: string) => { const ex = ledgerDayExplanation(engineInput(data, today), ledger, date, { forecast }); if (ex) { setExplain(ex); router.push('/explain'); } };
  type Row = { key: string; label: string; cents: number; currency: string; occ?: Occurrence; excluded?: string; isIncome: boolean; covered?: number; overdrawn?: boolean; infoOnly?: boolean };
  const scheduleDays = useMemo(() => {
    const out: { date: string; end: number; rows: Row[] }[] = [];
    for (const d of ledger.days) {
      const rows: Row[] = [];
      if (scopeId === 'cash') {
        const fd = forecast.days.find((x) => x.date === d.date)!;
        for (const e of [...fd.events, ...forecast.excludedEvents.filter((x) => x.date === d.date)]) {
          const isIncome = e.occurrence?.kind === 'income' || (e.source === 'scheduled_tx' && (e.legs[0]?.deltaCents ?? 0) > 0);
          const cents = e.cashDeltaCents || (e.legs[0]?.deltaCents ?? 0);
          // an amount that isn't a cash effect is in the currency of its account (Phase 4A.4.4)
          const currency = e.cashDeltaCents ? cur : data.accounts.find((a) => a.id === (e.occurrence?.accountId ?? e.legs[0]?.accountId))?.currency ?? cur;
          rows.push({ key: e.id, label: e.label, cents, currency, ...(e.occurrence ? { occ: e.occurrence } : {}), ...(e.excluded ? { excluded: e.excluded } : {}), isIncome });
        }
      } else {
        for (const e of d.entries) rows.push({ key: e.eventId, label: e.label, cents: e.deltaCents, currency: ledger.currency, ...(e.occurrence ? { occ: e.occurrence } : {}), isIncome: e.deltaCents > 0, ...(e.coveredCents ? { covered: e.coveredCents, overdrawn: e.basis === 'overdrawn' } : {}), ...(e.deltaCents === 0 ? { infoOnly: true } : {}) });
        for (const e of d.notCounted) rows.push({ key: e.id, label: e.label, cents: 0, currency: ledger.currency, ...(e.occurrence ? { occ: e.occurrence } : {}), excluded: e.excluded ?? 'unknown_amount', isIncome: true });
      }
      // today always: its details show how the day starts
      if (rows.length || d.date === today) out.push({ date: d.date, end: d.endCents, rows });
    }
    return out;
  }, [ledger, forecast, scopeId, today, data.accounts, cur]);
  const chooseScope = () => choose(LEDGER_SHOW, [{ label: LEDGER_ALL_CASH, run: () => setScope('cash') }, ...ledgerChoices.map((a) => ({ label: `${a.name}${a.archived ? ' (archived)' : ''}`, run: () => setScope(a.id) }))]);

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
          const v = recurringAmountView(r, data.transactions);
          const amt = v.kind === 'unknown' ? 'Unknown' : v.kind === 'card_full_balance' ? 'Full balance' : null;
          const sched = `${describeSchedule(r.schedule)}${next && !r.paused ? ` · next ${formatShortDate(applyWeekendRule(next, r.weekendRule))}` : ''}${r.paused ? ' · Paused' : ''}`;
          return (
            <ListRow
              key={r.id}
              last={i === items.length - 1}
              onPress={() => itemActions(r)}
              icon={<IconBubble tone={r.kind === 'income' ? 'inflow' : 'neutral'}>{r.kind === 'income' ? <ArrowDownLeft size={16} color={c.positive} /> : r.kind === 'transfer' || r.kind === 'savings' ? <ArrowLeftRight size={16} color={c.textSecondary} /> : <ArrowUpRight size={16} color={c.textSecondary} />}</IconBubble>}
              title={r.name}
              subtitle={v.kind === 'estimate' ? (
                <View style={{ gap: 2 }}>
                  <T variant="footnote" color="textTertiary">{sched}</T>
                  <T variant="footnote" color="textTertiary" testID={`estimate-note-${r.name}`}>{estimateNote(v, (x) => formatCents(x, cur))}</T>
                </View>
              ) : sched}
              right={amt ? <T color="textTertiary">{amt}</T> : (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} testID={`plan-amount-${r.name}`}>
                  {v.kind === 'estimate' && <T color="warning" accessibilityLabel="about" style={{ fontFamily: 'Inter_600SemiBold' }}>≈</T>}
                  <Money cents={v.kind === 'fixed' || v.kind === 'estimate' ? v.forecastCents : 0} currency={cur} style={{ fontFamily: 'Inter_600SemiBold' }} />
                </View>
              )}
            />
          );
        })}
        {monthly(items) > 0 && <T variant="footnote" color="textSecondary" style={{ marginTop: 8 }}>About {''}<Money cents={monthly(items)} currency={cur} variant="footnote" color="textSecondary" /> a month{addKind === 'bill' ? ' · ' : ''}{addKind === 'bill' ? <Money cents={yearly(items)} currency={cur} variant="footnote" color="textSecondary" /> : null}{addKind === 'bill' ? ' a year' : ''}</T>}
      </Card>
    );
  };

  return (
    <Screen title={TERMS.tabs.planning} subtitle="Income, bills and transfers that shape your forecast.">
      {(pastDue.count > 0 || hadPastDue.current) && (
        <Card title={pastDue.count > 0 ? `${CATCHUP_TITLE} · ${CATCHUP_COUNT(pastDue.count)}` : CATCHUP_TITLE}>
          {pastDue.count === 0 ? (
            <T color="textSecondary" testID="catch-up-done" accessibilityLiveRegion="polite">{CATCHUP_DONE}</T>
          ) : (
            <View testID="catch-up" style={{ gap: 12 }}>
              <T variant="footnote" color="textTertiary">{CATCHUP_HINT}</T>
              {pastDue.groups.map((g) => (
                <View key={g.recurringId} testID="catch-up-group" style={{ gap: 2 }}>
                  <T style={{ fontFamily: 'Inter_600SemiBold' }} accessibilityRole="header">{g.name}{g.items.length > 1 ? ` · ${g.items.length} past due` : ''}</T>
                  {g.items.map((u) => {
                    const o = u.occurrence!;
                    const due = formatShortDate(u.date);
                    const verb = u.isIncome ? 'Record' : 'Mark paid';
                    const approx = o.amountBasis !== 'fixed' && o.amountBasis !== 'override' && o.amountBasis !== 'actual' && o.amountBasis !== 'unknown';
                    return (
                      <View key={u.id} testID="catch-up-row" style={{ borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 8, gap: 6 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <T variant="footnote" color="textSecondary" style={{ flex: 1 }}>{formatWeekdayDate(u.date)}{!u.affectsCash ? ' · charged to a card' : ''}</T>
                          <Badge label={(u.isIncome ? INCOME_STATUS_LABEL : OCCURRENCE_STATUS_LABEL).overdue} />
                          {o.amountBasis === 'unknown' ? <T color="textTertiary">—</T> : <T style={{ fontFamily: 'Inter_600SemiBold' }}>{approx ? '≈' : ''}{formatCents(u.cents, u.currency ?? cur, { sign: 'always' })}</T>}
                        </View>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <Button small kind="secondary" title={verb} accessibilityLabel={CATCHUP_ACTION_LABEL(verb, g.name, due)}
                            onPress={() => { setAddPrefill({ occurrenceRef: { recurringId: o.recurringId, originalDate: o.originalDate }, occurrenceName: u.label, ...(o.amountCents ? { amountCents: o.amountCents } : {}) }); router.push('/add'); }} />
                          <Button small kind="ghost" title="Skip" accessibilityLabel={CATCHUP_ACTION_LABEL('Skip', g.name, due)} onPress={() => void skip(o)} />
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </Card>
      )}
      {allWarnings.length > 0 && (
        <Card title={`Needs attention · ${allWarnings.length}`}>
          <View testID="all-warnings"><WarningList warnings={allWarnings} currency={cur} /></View>
        </Card>
      )}
      <Card title="Balance on a date">
        <DateField label="Date" value={target} minimum={today} onChange={setTarget} />
        <Money cents={onDate.cents} currency={cur} variant="title1" style={{ marginTop: 10 }} />
        <T variant="footnote" color="textSecondary">Projected available cash at the end of {formatShortDate(onDate.date)}.</T>
        <LinkButton title={TERMS.whyThisNumber} onPress={() => { setExplain(onDate.explanation); router.push('/explain'); }} />
      </Card>

      <Card title={`Through ${formatShortDate(windowEnd)}`}>
        <T variant="footnote" color="textTertiary" testID="timeline-scope" style={{ marginBottom: 6 }}>
          {windowEnd === stsScope.horizonEnd
            ? `Shows what's scheduled through ${formatShortDate(windowEnd)}, the end of the Safe to Spend forecast. Recurring items continue after that; see the lists.`
            : `Safe to Spend counts items through ${formatShortDate(stsScope.horizonEnd)}; items after that are shown here but not counted.`}
          {stsScope.nextAfterNote && windowEnd === stsScope.horizonEnd ? ` ${stsScope.nextAfterNote}` : ''}
        </T>
        {ledgerChoices.length > 1 && (
          <Pressable testID="ledger-scope" accessibilityRole="button" accessibilityLabel={`${LEDGER_SHOW}: ${scopeName}. Change`} onPress={chooseScope} hitSlop={8}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: c.border, marginBottom: 6 }}>
            <T variant="footnote" color="textSecondary">{LEDGER_SHOW}</T>
            <T variant="footnote" style={{ fontFamily: 'Inter_600SemiBold' }}>{scopeName}</T>
            <ChevronDown size={16} color={c.textTertiary} />
          </Pressable>
        )}
        {ledger.isCard && <T variant="footnote" color="textTertiary" testID="ledger-card-note" style={{ marginBottom: 6 }}>{LEDGER_CARD_NOTE}</T>}
        {scopeId !== 'cash' && ledger.days.some((d) => d.entries.some((x) => x.coveredCents && x.basis !== 'overdrawn')) && <T variant="footnote" color="textTertiary" testID="ledger-shortfall-hint" style={{ marginBottom: 6 }}>{LEDGER_SHORTFALL_HINT(scopeName)}</T>}
        {!scheduleDays.some((d) => d.rows.length) && <T color="textSecondary">Nothing scheduled yet.</T>}
        {scheduleDays.map((d) => (
          <View key={d.date} testID="tl-day" style={{ borderTopWidth: 1, borderTopColor: c.border, paddingVertical: 8 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <T variant="footnote" style={{ fontFamily: 'Inter_600SemiBold', flex: 1 }}>{formatWeekdayDate(d.date)}</T>
              {ledger.isCard ? (
                <T variant="footnote" color="textSecondary" testID="tl-day-end">Owed {formatCents(-d.end, ledger.currency)}</T>
              ) : (
                <View testID="tl-day-end"><Money cents={d.end} currency={ledger.currency} variant="footnote" color={d.end < 0 ? 'negative' : 'textSecondary'} /></View>
              )}
              <LinkButton title={LEDGER_DAY_DETAILS} accessibilityLabel={LEDGER_DAY_LABEL(formatWeekdayDate(d.date), scopeName)} testID="day-details" onPress={() => dayDetails(d.date)} />
            </View>
            {d.rows.map((e) => (
              <Pressable key={e.key} disabled={!e.occ} onPress={() => e.occ && occActions(e.occ, e.isIncome)} accessibilityRole={e.occ ? 'button' : undefined} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 }}>
                <T style={{ flex: 1 }} numberOfLines={1}>{e.label}</T>
                {e.excluded ? <Badge label={e.excluded === 'unknown_amount' ? 'Amount unknown' : 'Not counted'} tone="warn" /> : e.occ && e.occ.status !== 'expected' ? <StatusBadge u={{ status: e.occ.status, isIncome: e.isIncome }} /> : null}
                {e.covered ? <View testID="covered-badge"><Badge label={LEDGER_COVER_BADGE(formatCents(e.covered, e.currency), e.overdrawn)} tone="warn" /></View> : null}
                {e.excluded || e.infoOnly ? <T color="textTertiary">—</T> : <Money cents={e.cents} currency={e.currency} sign="always" color={e.cents > 0 ? 'positive' : 'text'} style={{ fontFamily: 'Inter_600SemiBold' }} />}
              </Pressable>
            ))}
          </View>
        ))}
      </Card>

      {/* Phase 4B.3: scheduled items a linked transaction settled this month (shared paidThisMonth); collapsed by default */}
      <Card>
        <Pressable testID="paid-toggle" accessibilityRole="button" accessibilityState={{ expanded: paidOpen }} accessibilityLabel={`${PAID_TITLE}, ${paid.entries.length === 0 ? 'none yet' : `${paid.entries.length} item${paid.entries.length === 1 ? '' : 's'}`}`}
          onPress={() => setPaidOpen((v) => !v)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 }}>
          <T variant="headline" accessibilityRole="header" style={{ flex: 1 }}>{PAID_TITLE}</T>
          <T variant="footnote" color="textSecondary" testID="paid-count">{paid.entries.length === 0 ? 'None yet' : `${paid.entries.length} item${paid.entries.length === 1 ? '' : 's'}`}</T>
          {paidOpen ? <ChevronUp size={18} color={c.textTertiary} /> : <ChevronDown size={18} color={c.textTertiary} />}
        </Pressable>
        {paidOpen && (paid.entries.length === 0 ? (
          <T color="textSecondary" testID="paid-empty" style={{ marginTop: 8 }}>{PAID_EMPTY(paidMonth)}</T>
        ) : (
          <View testID="paid-history" style={{ marginTop: 4 }}>
            <T variant="footnote" color="textTertiary" style={{ marginBottom: 2 }}>{PAID_HINT(paidMonth, 'Tap')}</T>
            {paid.entries.map((e, i) => {
              const verb = e.kind === 'income' ? 'Received' : 'Paid';
              const where = e.toAccountName ? `${e.accountName} → ${e.toAccountName}` : e.accountName;
              const due = e.dueDate !== e.paidDate ? PAID_DUE(formatShortDate(e.dueDate)) : null;
              const amount = formatCents(e.amountCents, e.currency, { sign: 'always' });
              return (
                <ListRow key={e.key} testID="paid-row" last={i === paid.entries.length - 1} titleLines={0}
                  onPress={() => { setAddPrefill({ editId: e.tx.id }); router.push('/add'); }}
                  accessibilityLabel={`${e.name}. ${verb} ${formatShortDate(e.paidDate)}${due ? `, ${due}` : ''}. ${amount}, ${where}. ${e.statusLabel}. Opens the transaction.`}
                  icon={<IconBubble tone={e.kind === 'income' ? 'inflow' : 'neutral'}>{e.kind === 'income' ? <ArrowDownLeft size={16} color={c.positive} /> : e.toAccountName ? <ArrowLeftRight size={16} color={c.textSecondary} /> : <ArrowUpRight size={16} color={c.textSecondary} />}</IconBubble>}
                  title={e.name}
                  subtitle={`${verb} ${formatShortDate(e.paidDate)}${due ? ` · ${due}` : ''} · ${where}`}
                  right={
                    <View style={{ alignItems: 'flex-end', gap: 4, maxWidth: 170 }}>
                      <Money cents={e.amountCents} currency={e.currency} sign="always" color={e.amountCents > 0 ? 'positive' : 'text'} style={{ fontFamily: 'Inter_600SemiBold' }} />
                      <View testID="paid-status"><Badge label={e.statusLabel} tone={e.pending ? 'warn' : 'neutral'} /></View>
                    </View>
                  }
                />
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
