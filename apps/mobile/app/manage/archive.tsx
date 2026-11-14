import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { accountUsage, archiveAccount, archiveBalanceReview, archiveTargets, describeUsage, PAUSE_NOTE, type ArchivePlan } from '@clarity/data';
import { formatShortDate } from '@clarity/shared';
import { useData, useRun, useSession } from '../../src/state/session';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Money } from '../../src/ui/Money';
import { SubScreen } from '../../src/ui/SubScreen';
import { T } from '../../src/ui/Text';
import { Chip } from '../add';

/**
 * Archive an account that scheduled items still use (Phase 4A.4.2), the same choices as the web dialog:
 * keep (still counted), move to another active account, or pause. Nothing changes unless chosen; Cancel changes nothing.
 */
export default function ArchiveReview() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useData();
  const { today } = useSession();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const account = data.accounts.find((a) => a.id === id);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (!account) return <SubScreen title="Archive account"><T>Account not found.</T></SubScreen>;
  const usage = accountUsage(data, account.id, today);
  const balanceNote = archiveBalanceReview(data, account.id, today).note;
  const confirm = async () => {
    const plan: ArchivePlan = { reassign: {}, pause: [] };
    for (const [rid, c] of Object.entries(choice)) {
      if (c === 'pause') plan.pause!.push(rid);
      else if (c.startsWith('move:')) plan.reassign![rid] = c.slice(5);
    }
    const r = await run((ctx) => archiveAccount(ctx, account.id, plan));
    if (!r.ok) return setError(r.errors[0]?.message ?? 'Could not archive.');
    router.back();
  };
  return (
    <SubScreen title={`Archive ${account.name}?`}>
      {balanceNote && <Card><T variant="callout" testID="archive-balance-note">{balanceNote}</T></Card>}
      {(usage.recurring.length > 0 || usage.planned.length > 0) && <T variant="callout">These are still scheduled with {account.name}. Choose what happens to each one. Nothing changes unless you choose it.</T>}
      {usage.recurring.map((u) => {
        const v = choice[u.item.id] ?? 'keep';
        const set = (x: string) => setChoice({ ...choice, [u.item.id]: x });
        return (
          <Card key={u.item.id} title={describeUsage(u, data.accounts)}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              <Chip label={`Keep with ${account.name}`} on={v === 'keep'} onPress={() => set('keep')} />
              {archiveTargets(u, data.accounts, account.id).map((a) => <Chip key={a.id} label={`Move to ${a.name}`} on={v === `move:${a.id}`} onPress={() => set(`move:${a.id}`)} />)}
              <Chip label="Pause" on={v === 'pause'} onPress={() => set('pause')} />
            </ScrollView>
          </Card>
        );
      })}
      {usage.planned.length > 0 && (
        <Card title={`Planned transactions (they stay with ${account.name})`}>
          {usage.planned.map((t) => (
            <View key={t.id} style={{ flexDirection: 'row', gap: 8, paddingVertical: 4 }}>
              <T variant="footnote" style={{ width: 52 }}>{formatShortDate(t.date)}</T>
              <T variant="footnote" style={{ flex: 1 }}>{t.merchant || 'Planned transaction'}</T>
              <Money cents={t.amountCents} currency={cur} variant="footnote" />
            </View>
          ))}
        </Card>
      )}
      {(usage.recurring.length > 0 || usage.planned.length > 0) && <T variant="footnote" color="textSecondary">
        Kept items are still counted: bills and transfers out are paid from what {account.name} holds, and anything it can't cover is counted against your spendable accounts. Money going into an archived account isn't counted as spendable. Paused items aren't counted in Safe to Spend until you resume them in Planning. {PAUSE_NOTE}
      </T>}
      {error && <T color="negative" accessibilityRole="alert">{error}</T>}
      <Button title="Archive account" onPress={() => void confirm()} testID="archive-confirm" />
      <Button title="Cancel" kind="secondary" onPress={() => router.back()} />
    </SubScreen>
  );
}
