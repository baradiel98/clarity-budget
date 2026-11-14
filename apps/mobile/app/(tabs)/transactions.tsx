import { router } from 'expo-router';
import { Search, Sparkles, Upload } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, SectionList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { deleteTransaction } from '@clarity/data';
import { periodTotals } from '@clarity/engine';
import { addDays, endOfMonth, formatMonthYear, formatWeekdayDate, startOfMonth, TERMS } from '@clarity/shared';
import { setAddPrefill } from '../../src/state/nav';
import { useData, useRun, useSession, useStore } from '../../src/state/session';
import { Badge } from '../../src/ui/Card';
import { Input } from '../../src/ui/Field';
import { CategoryIcon } from '../../src/ui/icons';
import { IconBubble } from '../../src/ui/ListRow';
import { Money } from '../../src/ui/Money';
import { Segmented } from '../../src/ui/Segmented';
import { T } from '../../src/ui/Text';
import { useTheme } from '../../src/ui/theme';
import { useToast } from '../../src/ui/Toast';

type Period = 'this' | 'last' | '90' | 'all';

export default function Transactions() {
  const data = useData();
  const { today } = useSession();
  const { store } = useStore();
  const run = useRun();
  const toast = useToast();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const cur = data.settings.baseCurrency;
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<Period>('this');
  const range = period === 'this' ? [startOfMonth(today), endOfMonth(today)] : period === 'last' ? [startOfMonth(addDays(startOfMonth(today), -1)), endOfMonth(addDays(startOfMonth(today), -1))] : period === '90' ? [addDays(today, -89), today] : ['0000-01-01', '9999-12-31'];
  const cats = useMemo(() => new Map(data.categories.map((x) => [x.id, x])), [data.categories]);
  const accts = useMemo(() => new Map(data.accounts.map((x) => [x.id, x])), [data.accounts]);
  const rows = useMemo(() => {
    const n = q.trim().toLowerCase();
    return data.transactions
      .filter((t) => t.date >= range[0]! && t.date <= range[1]! && (!n || `${t.merchant} ${t.notes} ${cats.get(t.categoryId ?? '')?.name ?? ''}`.toLowerCase().includes(n)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt));
  }, [data.transactions, range[0], range[1], q, cats]); // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(() => {
    const m = new Map<string, typeof rows>();
    for (const t of rows) m.set(t.date, [...(m.get(t.date) ?? []), t]);
    return [...m].map(([date, data]) => ({ title: date, data }));
  }, [rows]);
  const totals = periodTotals(rows, '0000-01-01', '9999-12-31');

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        stickySectionHeadersEnabled
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: insets.bottom + 120 }}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <T variant="display" accessibilityRole="header">{TERMS.tabs.transactions}</T>
              <Pressable accessibilityRole="button" accessibilityLabel="Clarity Capture" onPress={() => router.push('/capture')} hitSlop={10}><Sparkles size={22} color={c.accent} /></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={TERMS.importStatement} onPress={() => router.push('/import')} hitSlop={10}><Upload size={22} color={c.accent} /></Pressable>
            </View>
            <View>
              <Input value={q} onChangeText={setQ} placeholder="Search" style={{ paddingLeft: 38 }} accessibilityLabel="Search transactions" />
              <View style={{ position: 'absolute', left: 12, top: 14 }} pointerEvents="none"><Search size={18} color={c.textTertiary} /></View>
            </View>
            <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: 'this', label: 'This month' }, { value: 'last', label: 'Last month' }, { value: '90', label: '90 days' }, { value: 'all', label: 'All' }]} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', backgroundColor: c.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: c.border }}>
              <View><T variant="caption" color="textTertiary">Income</T><Money cents={totals.incomeCents} currency={cur} color="positive" variant="headline" /></View>
              <View><T variant="caption" color="textTertiary">Spending</T><Money cents={totals.spendingCents} currency={cur} variant="headline" /></View>
              <View><T variant="caption" color="textTertiary">Net</T><Money cents={totals.netCents} currency={cur} sign="always" variant="headline" color={totals.netCents < 0 ? 'negative' : 'text'} /></View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={{ alignItems: 'center', gap: 8, paddingVertical: 40 }}>
            <T variant="headline">{data.transactions.length ? 'Nothing in this period' : 'No transactions yet'}</T>
            <T color="textSecondary" style={{ textAlign: 'center' }}>{data.transactions.length ? 'Try a different period or search.' : 'Tap + to add a purchase, or import a statement.'}</T>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={{ backgroundColor: c.bg, paddingTop: 14, paddingBottom: 6 }}>
            <T variant="footnote" color="textSecondary" style={{ fontFamily: 'Inter_600SemiBold' }}>{section.title.slice(0, 7) !== today.slice(0, 7) && period === 'all' ? `${formatWeekdayDate(section.title)} · ${formatMonthYear(section.title).split(' ')[1]}` : formatWeekdayDate(section.title)}</T>
          </View>
        )}
        renderItem={({ item: t }) => {
          const cat = t.categoryId ? cats.get(t.categoryId) : undefined;
          const other = t.transferGroupId ? data.transactions.find((x) => x.transferGroupId === t.transferGroupId && x.id !== t.id) : undefined;
          const title = t.kind === 'transfer' ? `${t.amountCents < 0 ? 'To' : 'From'} ${other ? accts.get(other.accountId)?.name ?? '' : ''}` : t.merchant || (t.kind === 'income' ? 'Income' : '—');
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${cat?.name ?? ''}`}
              accessibilityHint="Opens the transaction. Long press to delete."
              onPress={() => { setAddPrefill({ editId: t.id }); router.push('/add'); }}
              onLongPress={() => Alert.alert('Delete this transaction?', title, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { const r = await run((ctx) => deleteTransaction(ctx, t.id), { undoLabel: 'Delete' }); if (r.ok) toast({ message: 'Transaction deleted', action: { label: 'Undo', run: () => void store.undo() } }); } }])}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, backgroundColor: c.surface, paddingHorizontal: 12, borderRadius: 14, marginBottom: 6, opacity: pressed ? 0.7 : 1 })}
            >
              <IconBubble tone={t.amountCents > 0 && t.kind !== 'transfer' ? 'inflow' : 'neutral'}><CategoryIcon name={t.kind === 'transfer' ? 'transfer' : t.kind === 'adjustment' ? 'adjustment' : cat?.icon} color={t.amountCents > 0 && t.kind !== 'transfer' ? c.positive : c.textSecondary} /></IconBubble>
              <View style={{ flex: 1, gap: 2 }}>
                <T numberOfLines={1} style={{ fontFamily: 'Inter_500Medium' }}>{title}</T>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <T variant="caption" color="textTertiary">{t.splits?.length ? 'Split' : t.kind === 'transfer' ? 'Transfer' : cat?.name ?? 'Uncategorized'} · {accts.get(t.accountId)?.name}</T>
                  {t.status === 'pending' && <Badge label="Pending" tone="warn" />}
                  {t.date > today && <Badge label="Planned" tone="accent" />}
                </View>
              </View>
              <Money cents={t.amountCents} currency={cur} sign="always" color={t.amountCents > 0 && t.kind !== 'transfer' ? 'positive' : 'text'} style={{ fontFamily: 'Inter_600SemiBold' }} />
            </Pressable>
          );
        }}
      />
    </View>
  );
}
