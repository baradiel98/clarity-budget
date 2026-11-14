import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { accountUsage, adjustBalance, archiveAccount, archiveBalanceReview, createAccount, markTransactionPosted, previewBalanceUpdate, updateAccount } from '@clarity/data';
import { accountBalance, pendingItems, postedBalance } from '@clarity/engine';
import { BALANCE_ENTRY_HINT, CARD_BALANCE_ENTRY_HINT, cardModeOf, centsToDecimalString, formatCents, formatShortDate, parseBalanceEntry, PENDING_MATCH_NOTE, PENDING_MATCH_TITLE, PENDING_MATCH_UNRELATED, RECONCILED_MESSAGE, UPDATE_BALANCE_HINT, UPDATE_BALANCE_PENDING_NOTE, type Account, type AccountType, type CardBalanceMode } from '@clarity/shared';
import { useToast } from '../../src/ui/Toast';
import { Check } from '../../src/features/Welcome';
import { useData, useRun, useSession } from '../../src/state/session';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Field, Input } from '../../src/ui/Field';
import { ListRow } from '../../src/ui/ListRow';
import { Money } from '../../src/ui/Money';
import { Segmented } from '../../src/ui/Segmented';
import { SubScreen } from '../../src/ui/SubScreen';
import { T } from '../../src/ui/Text';

const TYPE: Record<AccountType, string> = { checking: 'Checking', savings: 'Savings', cash: 'Cash', credit_card: 'Credit card' };

export default function Accounts() {
  const data = useData();
  const { today } = useSession();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('savings');
  const [balance, setBalance] = useState('');
  const [spendable, setSpendable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardMode, setCardMode] = useState<CardBalanceMode>('owed');
  const [adjust, setAdjust] = useState<{ id: string } | null>(null);

  const add = async () => {
    // Phase 4A.5.8: signed balances; cards as Owed / In credit (same parser as web)
    const parsed = parseBalanceEntry(balance, cur, type === 'credit_card' ? cardMode : undefined, true);
    if (!parsed.ok) return setError(parsed.message);
    const r = await run((ctx) => createAccount(ctx, { name, type, currentBalanceCents: parsed.cents, spendable: type === 'credit_card' ? false : spendable }));
    if (!r.ok) return setError(r.errors[0]?.message ?? '');
    setAdding(false);
    setName('');
    setBalance('');
  };

  return (
    <SubScreen title="Accounts">
      <Card>
        {data.accounts.map((a, i) => {
          const bal = accountBalance(a, data.transactions, today);
          return (
            <View key={a.id}>
              <ListRow
                last={i === data.accounts.length - 1 && adjust?.id !== a.id}
                title={`${a.name}${a.archived ? ' (archived)' : ''}`}
                subtitle={`${TYPE[a.type]}${a.type !== 'credit_card' ? (a.spendable ? ' · counts as available cash' : ' · not counted as cash') : bal > 0 ? ' · in credit' : ' · owed'}`}
                right={<Money cents={a.type === 'credit_card' ? Math.abs(bal) : bal} currency={cur} style={{ fontFamily: 'Inter_600SemiBold' }} />}
                onPress={() =>
                  Alert.alert(a.name, undefined, [
                    { text: 'Update balance', onPress: () => setAdjust({ id: a.id }) },
                    ...(a.type !== 'credit_card' ? [{ text: a.spendable ? 'Don’t count as available cash' : 'Count as available cash', onPress: () => void run((ctx) => updateAccount(ctx, a.id, { spendable: !a.spendable })) }] : []),
                    {
                      text: a.archived ? 'Restore' : 'Archive',
                      onPress: () => {
                        if (a.archived) return void run((ctx) => updateAccount(ctx, a.id, { archived: false }));
                        // Phase 4A.4.2: review what still uses the account before archiving it
                        const u = accountUsage(data, a.id, today);
                        if (u.recurring.length || u.planned.length || archiveBalanceReview(data, a.id, today).note) router.push({ pathname: '/manage/archive', params: { id: a.id } });
                        else void run((ctx) => archiveAccount(ctx, a.id));
                      },
                    },
                    { text: 'Cancel', style: 'cancel' },
                  ])
                }
              />
              {adjust?.id === a.id && <UpdateBalancePanel account={a} onDone={() => setAdjust(null)} />}
            </View>
          );
        })}
      </Card>
      {adding ? (
        <Card title="New account">
          <View style={{ gap: 14 }}>
            <Field label="Name"><Input value={name} onChangeText={setName} autoFocus /></Field>
            <Segmented label="Type" value={type} onChange={(t) => { setType(t); setSpendable(t === 'checking' || t === 'cash'); }} options={[{ value: 'checking', label: 'Checking' }, { value: 'savings', label: 'Savings' }, { value: 'cash', label: 'Cash' }, { value: 'credit_card', label: 'Card' }]} />
            {type === 'credit_card' && <Segmented label="Card balance" value={cardMode} onChange={setCardMode} options={[{ value: 'owed', label: 'Owed' }, { value: 'credit', label: 'In credit' }]} />}
            <Field label={type === 'credit_card' ? (cardMode === 'owed' ? 'Amount owed today' : 'Credit on the card today') : 'Balance today'} hint={type === 'credit_card' ? CARD_BALANCE_ENTRY_HINT : BALANCE_ENTRY_HINT}><Input testID="new-account-balance" value={balance} onChangeText={(t) => setBalance(t.replace(/[^\d.,\-\u2212]/g, ''))} keyboardType="numbers-and-punctuation" placeholder="0.00" /></Field>
            {type !== 'credit_card' && <Check label="Count toward available cash and Safe to Spend" value={spendable} onChange={setSpendable} />}
            {type === 'credit_card' && <T variant="footnote" color="textSecondary">Card purchases count as spending when they happen; paying the card is a transfer, so nothing is counted twice.</T>}
            {error && <T color="negative">{error}</T>}
            <Button title="Add account" onPress={() => void add()} />
          </View>
        </Card>
      ) : (
        <Button title="Add account" kind="secondary" onPress={() => setAdding(true)} />
      )}
    </SubScreen>
  );
}

const KIND_LABEL: Record<string, string> = { expense: 'Expense', income: 'Income', refund: 'Refund', transfer: 'Transfer', adjustment: 'Adjustment' };

/**
 * Update balance (Phase 4A.5.6 posted vs posted; Phase 4A.5.8: signed figures, cards as Owed / In credit, pending items
 * whose amounts match the difference must be resolved first, and an exact match is confirmed without an adjustment).
 */
export function UpdateBalancePanel({ account: a, onDone }: { account: Account; onDone: () => void }) {
  const data = useData();
  const { today } = useSession();
  const run = useRun();
  const toast = useToast();
  const cur = data.settings.baseCurrency;
  const isCard = a.type === 'credit_card';
  const posted = postedBalance(a, data.transactions, today);
  const pending = pendingItems(a, data.transactions, today);
  const init = cardModeOf(posted);
  const [mode, setMode] = useState<CardBalanceMode>(init.mode);
  const [value, setValue] = useState(centsToDecimalString(isCard ? init.amountCents : posted));
  const [unrelated, setUnrelated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsed = parseBalanceEntry(value, cur, isCard ? mode : undefined);
  const preview = parsed.ok ? previewBalanceUpdate(data, a.id, parsed.cents, today) : null;
  const diff = preview?.differenceCents ?? null;
  const ids = new Set((preview?.matches ?? []).flat().map((t) => t.id));
  const matchItems = pending.filter((t) => ids.has(t.id));
  const blocked = matchItems.length > 0 && !unrelated;
  const shown = (c: number) => (isCard ? -c : c);
  const save = async () => {
    if (!parsed.ok) return setError(parsed.message);
    const r = await run((ctx) => adjustBalance(ctx, a.id, parsed.cents, 'Matched balance in bank app', today, { unrelatedToPending: unrelated }), { undoLabel: diff === 0 ? 'Balance confirmed' : 'Balance update' });
    if (!r.ok) return setError(r.errors[0]?.message ?? 'Could not update');
    if (diff === 0) toast({ message: RECONCILED_MESSAGE(a.name, formatShortDate(today)) });
    onDone();
  };
  return (
    <View style={{ gap: 10, paddingVertical: 10 }}>
      <View style={{ gap: 6 }} testID="update-balance-hint">
        <T variant="footnote" color="textSecondary">Clarity's posted balance is {isCard ? (posted > 0 ? `${formatCents(posted, cur)} in credit` : `${formatCents(-posted, cur)} owed`) : formatCents(posted, cur)}. {isCard ? CARD_BALANCE_ENTRY_HINT : UPDATE_BALANCE_HINT}</T>
        {pending.length > 0 && matchItems.length === 0 && (
          <View testID="update-balance-pending">
            <T variant="footnote">{UPDATE_BALANCE_PENDING_NOTE}</T>
            {pending.map((t) => <T key={t.id} variant="footnote" color="textSecondary">{formatShortDate(t.date)} · {t.merchant || 'Pending'} · {KIND_LABEL[t.kind]} · {formatCents(shown(t.amountCents), cur, { sign: 'always' })}</T>)}
          </View>
        )}
      </View>
      {isCard && <Segmented label="Card balance per bank" value={mode} onChange={setMode} options={[{ value: 'owed', label: 'Owed' }, { value: 'credit', label: 'In credit' }]} />}
      <Field label={isCard ? (mode === 'owed' ? 'Posted amount owed per bank' : 'Posted credit per bank') : 'Posted balance per bank'}>
        <Input testID="update-balance-input" value={value} onChangeText={(t) => { setValue(t.replace(/[^\d.,\-\u2212]/g, '')); setError(null); setUnrelated(false); }} keyboardType="numbers-and-punctuation" autoFocus />
      </Field>
      {matchItems.length > 0 && (
        <View testID="pending-match" style={{ gap: 6 }}>
          <T variant="footnote" style={{ fontFamily: 'Inter_600SemiBold' }}>{PENDING_MATCH_TITLE}</T>
          <T variant="footnote" color="textSecondary">{PENDING_MATCH_NOTE}</T>
          {(preview?.matches.length ?? 0) > 1 && <T variant="footnote" color="textSecondary">{preview!.matches.length} different combinations add up to {formatCents(shown(diff!), cur, { sign: 'always' })}; Clarity can't tell which, if any, has cleared.</T>}
          {matchItems.map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <T variant="footnote" style={{ flex: 1 }}>{formatShortDate(t.date)} · {t.merchant || 'Pending'} · {KIND_LABEL[t.kind]} · pending · {formatCents(shown(t.amountCents), cur, { sign: 'always' })}</T>
              <Button title="Mark posted" small kind="secondary" onPress={() => void run((ctx) => markTransactionPosted(ctx, t.id), { undoLabel: 'Marked posted' })} />
            </View>
          ))}
          <Check label={PENDING_MATCH_UNRELATED} value={unrelated} onChange={setUnrelated} />
        </View>
      )}
      {diff !== null && diff !== 0 && <T variant="footnote" testID="adjustment-preview">Adjustment: {formatCents(shown(diff), cur, { sign: 'always' })}{isCard ? ' to the amount owed' : ''}</T>}
      {diff === 0 && <T variant="footnote" color="textSecondary" testID="balance-matches">This matches Clarity's posted balance. Confirming records that it was reconciled on {formatShortDate(today)}; no adjustment is created.</T>}
      {(error ?? (!parsed.ok && value.trim() ? parsed.message : null)) && <T color="negative">{error ?? (parsed.ok ? '' : parsed.message)}</T>}
      <Button title={diff === 0 ? 'Confirm balance' : 'Record adjustment'} small disabled={diff === null || blocked} onPress={() => void save()} />
    </View>
  );
}
