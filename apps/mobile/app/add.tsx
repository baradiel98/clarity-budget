import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addTransaction, deleteTransaction, updateTransaction, type TxInput } from '@clarity/data';
import { addDays, centsToDecimalString, formatCents, formatShortDate, parseAmountInput, TERMS } from '@clarity/shared';
import { buildMerchantMemory, expandOccurrences, findPossibleDuplicates, merchantKey, suggestOccurrenceMatch } from '@clarity/engine';
import { Check } from '../src/features/Welcome';
import { takeAddPrefill } from '../src/state/nav';
import { useData, useRun, useSession, useStore } from '../src/state/session';
import { Button, LinkButton } from '../src/ui/Button';
import { DateField } from '../src/ui/DateField';
import { Field, Input } from '../src/ui/Field';
import { Keypad } from '../src/ui/Keypad';
import { Money } from '../src/ui/Money';
import { Segmented } from '../src/ui/Segmented';
import { T } from '../src/ui/Text';
import { FONT, useTheme } from '../src/ui/theme';
import { useToast } from '../src/ui/Toast';

type Kind = TxInput['kind'];

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: !!on }} onPress={onPress} style={{ paddingHorizontal: 12, minHeight: 36, borderRadius: 10, justifyContent: 'center', backgroundColor: on ? c.accentSoft : c.surface, borderWidth: 1, borderColor: on ? c.accent : c.border }}>
      <T variant="footnote" color={on ? 'accent' : 'text'} style={{ fontFamily: FONT.medium }} numberOfLines={1}>{label}</T>
    </Pressable>
  );
}

export default function AddScreen() {
  const [prefill] = useState(() => takeAddPrefill() ?? {});
  const data = useData();
  const { store } = useStore();
  const { today } = useSession();
  const run = useRun();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { c } = useTheme();
  const cur = data.settings.baseCurrency;

  const existing = prefill.editId
    ? (() => {
        const t = data.transactions.find((x) => x.id === prefill.editId);
        if (!t) return null;
        return t.transferGroupId ? data.transactions.filter((x) => x.transferGroupId === t.transferGroupId) : [t];
      })()
    : null;
  const src = existing ? existing.find((t) => t.amountCents < 0) ?? existing[0]! : null;
  const item = prefill.occurrenceRef ? data.recurring.find((r) => r.id === prefill.occurrenceRef!.recurringId) : undefined;
  const defaultAccount = data.settings.defaultAccountId ?? data.accounts.find((a) => a.spendable && !a.archived)?.id ?? data.accounts[0]?.id ?? '';

  const [kind, setKind] = useState<Kind>(src ? (src.kind === 'adjustment' ? 'expense' : (src.kind as Kind)) : prefill.kind ?? (item ? (item.kind === 'income' ? 'income' : item.kind === 'transfer' || item.kind === 'savings' ? 'transfer' : 'expense') : 'expense'));
  const [amount, setAmount] = useState(src ? centsToDecimalString(Math.abs(src.amountCents)) : prefill.amountCents ? centsToDecimalString(prefill.amountCents) : '');
  const [merchant, setMerchant] = useState(src?.merchant ?? prefill.merchant ?? item?.name ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(src?.categoryId ?? prefill.categoryId ?? item?.categoryId ?? null);
  const [accountId, setAccountId] = useState(src?.accountId ?? prefill.accountId ?? item?.accountId ?? defaultAccount);
  const [toAccountId, setToAccountId] = useState(existing?.find((t) => t.id !== src?.id)?.accountId ?? item?.toAccountId ?? '');
  const [date, setDate] = useState(src?.date ?? prefill.date ?? today);
  const [notes, setNotes] = useState(src?.notes ?? '');
  const [pending, setPending] = useState(src?.status === 'pending');
  const [more, setMore] = useState(false);
  const [dupConfirmed, setDupConfirmed] = useState(false);
  const [linkOcc, setLinkOcc] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isEdit = !!existing;

  const cents = parseAmountInput(amount || '0', cur) ?? 0;
  const memory = useMemo(() => buildMerchantMemory(data.transactions, merchantKey), [data.transactions]);
  const recent = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of data.transactions) if (t.merchant && (t.kind === 'expense' || t.kind === 'income')) count.set(t.merchant, (count.get(t.merchant) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]).map(([m]) => m).filter((m) => !merchant || m.toLowerCase().includes(merchant.toLowerCase())).slice(0, 8);
  }, [data.transactions, merchant]);
  const categories = data.categories.filter((x) => !x.archived && x.kind === (kind === 'income' ? 'income' : 'expense'));
  const accounts = data.accounts.filter((a) => !a.archived);

  const pickMerchant = (m: string) => {
    setMerchant(m);
    const mem = memory.get(merchantKey(m));
    if (mem) {
      setCategoryId(mem.categoryId);
      if (kind !== 'transfer' && accounts.some((a) => a.id === mem.accountId)) setAccountId(mem.accountId);
    }
  };

  const signed = kind === 'expense' || kind === 'transfer' ? -cents : cents;
  const duplicates = !isEdit && cents > 0 && kind !== 'transfer' ? findPossibleDuplicates({ accountId, date, amountCents: signed, merchant }, data.transactions) : [];
  const occurrence = useMemo(() => {
    if (prefill.occurrenceRef || isEdit || cents <= 0 || kind === 'refund') return null;
    const occ = expandOccurrences(data.recurring, data.exceptions, data.transactions, { from: addDays(date, -40), to: addDays(date, 10), today });
    return suggestOccurrenceMatch({ accountId, date, amountCents: signed, merchant }, occ);
  }, [prefill, isEdit, cents, kind, data, date, accountId, merchant, today, signed]);

  const save = async () => {
    if (cents <= 0) return fail('Enter an amount greater than zero.');
    if (kind !== 'income' && kind !== 'transfer' && !merchant.trim()) return fail('Add a merchant or description.');
    if (kind === 'transfer' && !toAccountId) return fail('Choose where the money goes.');
    if (duplicates.length && !dupConfirmed) {
      setDupConfirmed(true);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      return;
    }
    const input: TxInput = {
      kind, accountId, ...(kind === 'transfer' ? { toAccountId } : {}), date, amountCents: cents, merchant, categoryId: kind === 'transfer' ? null : categoryId, notes,
      status: pending ? 'pending' : 'confirmed',
      // Splits are edited on the web app in Phase 1; keep them intact when editing here.
      ...(src?.splits?.length ? { splits: src.splits.map((x) => ({ categoryId: x.categoryId, amountCents: Math.abs(x.amountCents) })) } : {}),
      ...(prefill.occurrenceRef ? { occurrenceRef: prefill.occurrenceRef } : occurrence && linkOcc ? { occurrenceRef: { recurringId: occurrence.recurringId, originalDate: occurrence.originalDate } } : {}),
    };
    setBusy(true);
    const label = `${merchant.trim() || (kind === 'transfer' ? 'Transfer' : 'Income')} ${formatCents(signed, cur, { sign: kind === 'transfer' ? 'never' : 'always' })}`;
    const r = await run((ctx) => (isEdit ? updateTransaction(ctx, src!.id, input) : addTransaction(ctx, input)), { undoLabel: label });
    setBusy(false);
    if (!r.ok) return fail(r.errors.map((e) => e.message).join(' '));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    toast({ message: `${isEdit ? 'Saved' : 'Added'} ${label}`, action: { label: 'Undo', run: () => void store.undo() } });
    router.back();
  };
  const fail = (m: string) => {
    setError(m);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <LinkButton title="Cancel" color="textSecondary" onPress={() => router.back()} />
        <T variant="headline" accessibilityRole="header">{isEdit ? 'Edit transaction' : prefill.occurrenceName ? `Record ${prefill.occurrenceName}` : TERMS.addTransaction}</T>
        {isEdit ? (
          <LinkButton title="Delete" color="negative" onPress={() => Alert.alert('Delete this transaction?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { const r = await run((ctx) => deleteTransaction(ctx, src!.id), { undoLabel: 'Delete' }); if (r.ok) { toast({ message: 'Transaction deleted', action: { label: 'Undo', run: () => void store.undo() } }); router.back(); } } }])} />
        ) : <View style={{ width: 52 }} />}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 16 }}>
        {!prefill.occurrenceRef && !isEdit && <Segmented label="Type" value={kind} onChange={(k) => { setKind(k); setCategoryId(k === 'income' ? 'cat_paycheck' : null); }} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }, { value: 'refund', label: 'Refund' }]} />}
        <Money cents={cents} currency={cur} variant="hero" style={{ textAlign: 'center' }} accessibilityRole="text" />
        {kind !== 'transfer' && (
          <>
            <Input value={merchant} onChangeText={setMerchant} placeholder={kind === 'income' ? 'From (optional)' : 'Merchant'} autoCorrect={false} returnKeyType="done" accessibilityLabel="Merchant" />
            {recent.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                {recent.map((m) => <Chip key={m} label={m} on={m === merchant} onPress={() => pickMerchant(m)} />)}
              </ScrollView>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="Category">
              {categories.map((x) => <Chip key={x.id} label={x.name} on={x.id === categoryId} onPress={() => setCategoryId(x.id === categoryId ? null : x.id)} />)}
            </ScrollView>
          </>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel={kind === 'transfer' ? 'From account' : 'Account'}>
          {accounts.map((a) => <Chip key={a.id} label={kind === 'transfer' ? `From ${a.name}` : a.name} on={a.id === accountId} onPress={() => setAccountId(a.id)} />)}
        </ScrollView>
        {kind === 'transfer' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="To account">
            {accounts.filter((a) => a.id !== accountId).map((a) => <Chip key={a.id} label={`To ${a.name}`} on={a.id === toAccountId} onPress={() => setToAccountId(a.id)} />)}
          </ScrollView>
        )}
        <DateField label="Date" value={date} onChange={setDate} />
        {occurrence && <Check label={`This ${occurrence.kind === 'income' ? 'is' : 'pays'} ${occurrence.name} ${occurrence.kind === 'income' ? 'expected' : 'due'} ${formatShortDate(occurrence.date)}`} hint="So it isn't counted again in your forecast." value={linkOcc} onChange={setLinkOcc} />}
        {duplicates.length > 0 && <T color="warning" accessibilityRole="alert">A {formatCents(Math.abs(duplicates[0]!.amountCents), cur)} transaction at {duplicates[0]!.merchant} on this date already exists. {dupConfirmed ? 'Tap Save again to add it anyway.' : ''}</T>}
        {src?.splits?.length ? <T variant="footnote" color="textSecondary">This transaction is split across {src.splits.length} categories. Its split stays as is; change the split on the web app. If you change the amount, the parts must still add up.</T> : null}
        {date > today && <T variant="footnote" color="textSecondary">Dated in the future: shown as planned until {formatShortDate(date)}.</T>}
        {more ? (
          <View style={{ gap: 12 }}>
            <Field label="Notes"><Input value={notes} onChangeText={setNotes} multiline style={{ minHeight: 72, paddingTop: 12 }} /></Field>
            <Check label="Pending (not yet cleared)" value={pending} onChange={setPending} />
          </View>
        ) : (
          kind !== 'transfer' && <LinkButton title="Notes or pending" onPress={() => setMore(true)} />
        )}
        {error && <T color="negative" accessibilityRole="alert">{error}</T>}
      </ScrollView>
      <View style={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 8, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border }}>
        <Keypad value={amount} onChange={setAmount} />
        <Button title={duplicates.length && dupConfirmed ? 'Save anyway' : 'Save'} busy={busy} onPress={() => void save()} />
      </View>
    </View>
  );
}
