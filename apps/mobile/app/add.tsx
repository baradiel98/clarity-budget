import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addTransaction, deleteProblem, deleteTransaction, markPostedBeforeOpening, matchOptionView, recordPaymentReturn, returnOptionsForEntry, updateTransaction, type TxInput } from '@clarity/data';
import { addDays, ALREADY_INCLUDED_HINT, OCCURRENCE_WEAK_HINT, ALREADY_INCLUDED_LABEL, OPENING_POSTED_HINT, OPENING_POSTED_LABEL, RETURN_ASK_LINK, RETURN_CHECK_TITLE, RETURN_DECIDE_HINT, RETURN_NEEDS_DECISION, RETURN_SEPARATE_LABEL, centsToDecimalString, formatCents, formatShortDate, legsPendingOf, parseAmountInput, TERMS, transferChoiceOf, TRANSFER_STATUS_HINT, TRANSFER_STATUS_LABEL, transferStatusOptions } from '@clarity/shared';
import { balanceAsOfDate, buildMerchantMemory, inclusionProblem, expandOccurrences, findPossibleDuplicates, merchantKey, suggestOccurrenceLink } from '@clarity/engine';
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
  // Phase 4A.5.14: for a transfer, `pending` is the sending leg and `toPending` the receiving leg (one visible Status choice)
  const [toPending, setToPending] = useState((existing?.find((t) => t.id !== src?.id) ?? src)?.status === 'pending');
  // Phase 4A.5.8: null = not chosen yet → default rule (ticked when dated before the confirmed date, D6); edits start from the stored state
  const [included, setIncluded] = useState<boolean | null>(src ? !!src.includedInBalance : null);
  const [toIncluded, setToIncluded] = useState<boolean | null>(src ? !!existing?.find((t) => t.id !== src.id)?.includedInBalance : null);
  const [more, setMore] = useState(false);
  const [dupConfirmed, setDupConfirmed] = useState(false);
  // Phase 4A.9: null = not chosen → ticked only for a strong suggestion (evidence beyond amount and date)
  const [linkOccChoice, setLinkOcc] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isEdit = !!existing;
  // Phase 4A.5.8: a reconciliation record; the data layer refuses edits too
  const isAdjustment = !!existing?.some((t) => t.kind === 'adjustment');
  // Phase 4A.5.6/4A.5.8: only a posted transaction dated from the opening date through the account's confirmed balance
  // date can already be in that balance; never pending or future-dated; a transfer decides each account separately.
  const inclusion = (acctId: string, chosen: boolean | null, legPending = pending) => {
    const a = data.accounts.find((x) => x.id === acctId);
    if (!a || inclusionProblem(a, data.transactions, date, legPending ? 'pending' : 'confirmed', today)) return null;
    const bd = balanceAsOfDate(a, data.transactions);
    return { account: a, date: bd, checked: chosen ?? date < bd }; // default: ticked only when dated before the confirmed date
  };
  const fromInc = inclusion(accountId, included);
  const toInc = kind === 'transfer' && toAccountId ? inclusion(toAccountId, toIncluded, toPending) : null;
  // Phase 4A.5.14 (D7): switching the type never keeps a hidden pending setting (the same rule as the web form)
  const changeKind = (k: Kind) => {
    if (k === kind) return;
    if (k === 'transfer') setToPending(pending);
    else if (kind === 'transfer') { const p = pending || toPending; setPending(p); if (p) setMore(true); }
    setKind(k);
  };

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
  const occurrenceSuggestion = useMemo(() => {
    if (prefill.occurrenceRef || isEdit || cents <= 0 || kind === 'refund') return null;
    const occ = expandOccurrences(data.recurring, data.exceptions, data.transactions, { from: addDays(date, -40), to: addDays(date, 10), today });
    return suggestOccurrenceLink({ accountId, date, amountCents: signed, merchant, kind, toAccountId: kind === 'transfer' ? toAccountId || null : null }, occ, data.transactions);
  }, [prefill, isEdit, cents, kind, data, date, accountId, merchant, today, signed, toAccountId]);
  const occurrence = occurrenceSuggestion?.occurrence ?? null;
  const linkOcc = linkOccChoice ?? !!occurrenceSuggestion?.strong;

  // Phase 4A.5.18: money coming in that could be a returned card payment needs an explicit decision (never automatic)
  const [returnChoice, setReturnChoice] = useState<string | null>(null);
  const [askReturn, setAskReturn] = useState(false);
  const retEntry = { kind, accountId, amountCents: cents, date, merchant };
  const editingPlain = !isEdit || (existing!.length === 1 && !existing![0]!.transferGroupId);
  const suggestedReturns = editingPlain ? returnOptionsForEntry(data, retEntry) : [];
  const returnOptions = askReturn ? returnOptionsForEntry(data, retEntry, true) : suggestedReturns;
  const anyReturnPossible = editingPlain && !askReturn && suggestedReturns.length === 0 && returnOptionsForEntry(data, retEntry, true).length > 0;
  const chosenReturn = returnOptions.find((m) => m.txId === returnChoice) ?? null;
  const preOpening = isEdit && existing!.length === 1 && existing![0]!.status === 'pending' ? data.accounts.find((a) => a.id === existing![0]!.accountId && a.openingDate > existing![0]!.date) : undefined;

  const save = async () => {
    if (cents <= 0) return fail('Enter an amount greater than zero.');
    if (suggestedReturns.length && returnChoice === null) return fail(RETURN_NEEDS_DECISION);
    if (chosenReturn) {
      setBusy(true);
      const rr = await run((ctx) => recordPaymentReturn(ctx, { paymentLegId: chosenReturn.txId, accountId, amountCents: cents, date, status: pending ? 'pending' : 'confirmed', merchant, ...(isEdit ? { replaceTxId: src!.id } : {}) }), { undoLabel: 'Recorded returned payment' });
      setBusy(false);
      if (!rr.ok) return fail(rr.errors.map((e) => e.message).join(' '));
      toast({ message: `Recorded a returned card payment of ${formatCents(cents, cur)}`, action: { label: 'Undo', run: () => void store.undo() } });
      router.back();
      return;
    }
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
      ...(kind === 'transfer' ? { toStatus: toPending ? 'pending' : 'confirmed' } : {}),
      includedInBalance: !!fromInc?.checked,
      ...(kind === 'transfer' ? { toIncludedInBalance: !!toInc?.checked } : {}),
      // Splits are edited on the web app in Phase 1; keep them intact when editing here.
      ...(src?.splits?.length ? { splits: src.splits.map((x) => ({ categoryId: x.categoryId, amountCents: Math.abs(x.amountCents) })) } : {}),
      ...(prefill.occurrenceRef ? { occurrenceRef: prefill.occurrenceRef } : occurrence && linkOcc ? { occurrenceRef: { recurringId: occurrence.recurringId, originalDate: occurrence.originalDate } } : {}),
      ...(!isEdit && returnChoice === 'separate' && suggestedReturns.length ? { provenance: { source: 'manual' as const, separateFrom: suggestedReturns.map((m) => m.txId) } } : {}),
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
          <LinkButton title="Delete" color="negative" onPress={() => { const why = deleteProblem(data, src!.id); if (why) { fail(why); return; } Alert.alert('Delete this transaction?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: async () => { const r = await run((ctx) => deleteTransaction(ctx, src!.id), { undoLabel: 'Delete' }); if (r.ok) { toast({ message: 'Transaction deleted', action: { label: 'Undo', run: () => void store.undo() } }); router.back(); } else fail(r.errors.map((e) => e.message).join(' ')); } }]); }} />
        ) : <View style={{ width: 52 }} />}
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, gap: 14, paddingBottom: 16 }}>
        {!prefill.occurrenceRef && !isEdit && <Segmented label="Type" value={kind} onChange={(k) => { changeKind(k); setCategoryId(k === 'income' ? 'cat_paycheck' : null); }} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }, { value: 'transfer', label: 'Transfer' }, { value: 'refund', label: 'Refund' }]} />}
        <Money cents={cents} currency={cur} variant="hero" style={{ textAlign: 'center' }} accessibilityRole="text" />
        {kind !== 'transfer' && (
          <>
            <Input value={merchant} onChangeText={setMerchant} placeholder={kind === 'income' ? 'From (optional)' : 'Merchant'} autoCorrect={false} returnKeyType="done" accessibilityLabel="Merchant" />
            {recent.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
                {recent.map((m) => <Chip key={m} label={m} on={m === merchant} onPress={() => pickMerchant(m)} />)}
              </ScrollView>
            )}
            {!chosenReturn && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityLabel="Category">
              {categories.map((x) => <Chip key={x.id} label={x.name} on={x.id === categoryId} onPress={() => setCategoryId(x.id === categoryId ? null : x.id)} />)}
            </ScrollView>}
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
        {returnOptions.length > 0 && (
          <View accessibilityRole="radiogroup" testID="return-check" style={{ gap: 6 }}>
            <T variant="footnote" style={{ fontFamily: 'Inter_600SemiBold' }}>{RETURN_CHECK_TITLE}</T>
            {returnOptions.map((m) => <Check key={m.txId} label={matchOptionView(m, cents, data, cur).label} value={returnChoice === m.txId} onChange={() => { setReturnChoice(m.txId); setError(null); }} />)}
            <Check label={RETURN_SEPARATE_LABEL} value={returnChoice === 'separate'} onChange={() => { setReturnChoice('separate'); setError(null); }} />
            <T variant="footnote" color="textSecondary" testID="return-note">{chosenReturn ? matchOptionView(chosenReturn, cents, data, cur).note : RETURN_DECIDE_HINT}</T>
          </View>
        )}
        {anyReturnPossible && <LinkButton title={RETURN_ASK_LINK} onPress={() => setAskReturn(true)} />}
        {preOpening && (
          <View testID="opening-posted" style={{ gap: 6 }}>
            <T variant="footnote" color="textSecondary">{OPENING_POSTED_HINT(preOpening.name, formatShortDate(preOpening.openingDate))}</T>
            <Button title={OPENING_POSTED_LABEL(preOpening.name)} kind="secondary" small onPress={async () => { const r = await run((ctx) => markPostedBeforeOpening(ctx, existing![0]!.id), { undoLabel: 'Marked as already in the opening balance' }); if (r.ok) { toast({ message: `Marked as already in ${preOpening.name}'s opening balance`, action: { label: 'Undo', run: () => void store.undo() } }); router.back(); } }} />
          </View>
        )}
        {kind === 'transfer' && (
          <View style={{ gap: 6 }} testID="transfer-status">
            <T variant="footnote" color="textSecondary">{TRANSFER_STATUS_LABEL}</T>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {transferStatusOptions(data.accounts.find((a) => a.id === toAccountId)?.type === 'credit_card').map((o) => <Chip key={o.value} label={o.label} on={transferChoiceOf(pending, toPending) === o.value} onPress={() => { const l = legsPendingOf(o.value); setPending(l.fromPending); setToPending(l.toPending); }} />)}
            </View>
            <T variant="footnote" color="textSecondary">{TRANSFER_STATUS_HINT}</T>
          </View>
        )}
        {fromInc && (
          <View testID="already-included">
            <Check label={ALREADY_INCLUDED_LABEL(formatShortDate(fromInc.date), kind === 'transfer' ? fromInc.account.name : undefined)} value={fromInc.checked} onChange={setIncluded} />
            <T variant="footnote" color="textSecondary">{ALREADY_INCLUDED_HINT}</T>
          </View>
        )}
        {toInc && (
          <View testID="already-included-to">
            <Check label={ALREADY_INCLUDED_LABEL(formatShortDate(toInc.date), toInc.account.name)} value={toInc.checked} onChange={setToIncluded} />
          </View>
        )}
        {occurrence && <Check label={`This ${occurrence.kind === 'income' ? 'is' : 'pays'} ${occurrence.name} ${occurrence.kind === 'income' ? 'expected' : 'due'} ${formatShortDate(occurrence.date)}`} hint={occurrenceSuggestion!.strong ? "So it isn't counted again in your forecast." : `So it isn't counted again in your forecast. ${OCCURRENCE_WEAK_HINT}`} value={linkOcc} onChange={setLinkOcc} />}
        {duplicates.length > 0 && <T color="warning" accessibilityRole="alert">A {formatCents(Math.abs(duplicates[0]!.amountCents), cur)} transaction at {duplicates[0]!.merchant} on this date already exists. {dupConfirmed ? 'Tap Save again to add it anyway.' : ''}</T>}
        {src?.splits?.length ? <T variant="footnote" color="textSecondary">This transaction is split across {src.splits.length} categories. Its split stays as is; change the split on the web app. If you change the amount, the parts must still add up.</T> : null}
        {date > today && <T variant="footnote" color="textSecondary">Dated in the future: shown as planned until {formatShortDate(date)}.</T>}
        {more ? (
          <View style={{ gap: 12 }}>
            <Field label="Notes"><Input value={notes} onChangeText={setNotes} multiline style={{ minHeight: 72, paddingTop: 12 }} /></Field>
            {kind !== 'transfer' && <Check label="Pending (not yet cleared)" value={pending} onChange={setPending} />}
          </View>
        ) : (
          kind !== 'transfer' && <LinkButton title="Notes or pending" onPress={() => setMore(true)} />
        )}
        {error && <T color="negative" accessibilityRole="alert">{error}</T>}
      </ScrollView>
      <View style={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 8, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border }}>
        <Keypad value={amount} onChange={setAmount} />
        {isAdjustment && <T color="warning" accessibilityRole="alert" testID="adjustment-locked">Balance adjustments can’t be edited: changing it here would turn it into an expense or income and could flip its sign. Delete it, or use Update balance again.</T>}
        <Button title={duplicates.length && dupConfirmed ? 'Save anyway' : 'Save'} busy={busy} disabled={isAdjustment} onPress={() => void save()} />
      </View>
    </View>
  );
}
