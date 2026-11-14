import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { accountUsage, adjustBalance, archiveAccount, archiveBalanceReview, createAccount, updateAccount } from '@clarity/data';
import { accountBalance, affectsBalance, postedBalance } from '@clarity/engine';
import { BALANCE_ENTRY_HINT, formatCents, formatShortDate, parseAmountInput, UPDATE_BALANCE_HINT, UPDATE_BALANCE_PENDING_NOTE, type AccountType } from '@clarity/shared';
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
  const [adjust, setAdjust] = useState<{ id: string; value: string } | null>(null);

  const add = async () => {
    const cents = parseAmountInput(balance || '0', cur);
    if (cents === null) return setError('Enter a valid balance.');
    const r = await run((ctx) => createAccount(ctx, { name, type, currentBalanceCents: cents, spendable: type === 'credit_card' ? false : spendable }));
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
                subtitle={`${TYPE[a.type]}${a.type !== 'credit_card' ? (a.spendable ? ' · counts as available cash' : ' · not counted as cash') : ' · owed'}`}
                right={<Money cents={a.type === 'credit_card' ? -bal : bal} currency={cur} style={{ fontFamily: 'Inter_600SemiBold' }} />}
                onPress={() =>
                  Alert.alert(a.name, undefined, [
                    { text: 'Update balance', onPress: () => setAdjust({ id: a.id, value: '' }) },
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
              {adjust?.id === a.id && (
                <View style={{ gap: 10, paddingVertical: 10 }}>
                  {(() => {
                    // Phase 4A.5.6: compare with the bank's POSTED balance; pending items stay pending.
                    const posted = postedBalance(a, data.transactions, today);
                    const pendingItems = data.transactions.filter((t) => affectsBalance(a, t) && t.date <= today && t.status === 'pending');
                    return (
                      <View style={{ gap: 6 }} testID="update-balance-hint">
                        <T variant="footnote" color="textSecondary">Clarity's posted balance is {formatCents(a.type === 'credit_card' ? -posted : posted, cur)}{a.type === 'credit_card' ? ' owed' : ''}. {UPDATE_BALANCE_HINT}</T>
                        {pendingItems.length > 0 && (
                          <View testID="update-balance-pending">
                            <T variant="footnote">{UPDATE_BALANCE_PENDING_NOTE}</T>
                            {pendingItems.map((t) => <T key={t.id} variant="footnote" color="textSecondary">{formatShortDate(t.date)} · {t.merchant || 'Pending'} · {formatCents(a.type === 'credit_card' ? -t.amountCents : t.amountCents, cur)}</T>)}
                          </View>
                        )}
                      </View>
                    );
                  })()}
                  <Field label={a.type === 'credit_card' ? 'Posted amount owed per bank' : 'Posted balance per bank'}>
                    <Input value={adjust.value} onChangeText={(t) => setAdjust({ id: a.id, value: t.replace(/[^\d.,]/g, '') })} keyboardType="decimal-pad" autoFocus />
                  </Field>
                  <Button title="Record adjustment" small onPress={async () => { const v = parseAmountInput(adjust.value, cur); if (v === null) return; await run((ctx) => adjustBalance(ctx, a.id, v, 'Matched balance in bank app')); setAdjust(null); }} />
                </View>
              )}
            </View>
          );
        })}
      </Card>
      {adding ? (
        <Card title="New account">
          <View style={{ gap: 14 }}>
            <Field label="Name"><Input value={name} onChangeText={setName} autoFocus /></Field>
            <Segmented label="Type" value={type} onChange={(t) => { setType(t); setSpendable(t === 'checking' || t === 'cash'); }} options={[{ value: 'checking', label: 'Checking' }, { value: 'savings', label: 'Savings' }, { value: 'cash', label: 'Cash' }, { value: 'credit_card', label: 'Card' }]} />
            <Field label={type === 'credit_card' ? 'Amount owed today' : 'Balance today'} hint={BALANCE_ENTRY_HINT}><Input value={balance} onChangeText={(t) => setBalance(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" placeholder="0.00" /></Field>
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
