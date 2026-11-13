import { View } from 'react-native';
import { undoImportBatch } from '@clarity/data';
import { useData, useRun } from '../../src/state/session';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { SubScreen } from '../../src/ui/SubScreen';
import { T } from '../../src/ui/Text';
import { useToast } from '../../src/ui/Toast';

export default function Imports() {
  const data = useData();
  const run = useRun();
  const toast = useToast();
  const batches = [...data.importBatches].sort((a, b) => b.importedAt - a.importedAt);
  return (
    <SubScreen title="Import history">
      {batches.length === 0 && <T color="textSecondary">No statements imported yet.</T>}
      {batches.map((b) => (
        <Card key={b.id}>
          <T style={{ fontFamily: 'Inter_600SemiBold' }}>{b.fileName}{b.undoneAt ? ' · undone' : ''}</T>
          <T variant="footnote" color="textSecondary">{new Date(b.importedAt).toLocaleString()} · {data.accounts.find((a) => a.id === b.accountId)?.name} · {b.counts.imported} imported, {b.counts.excluded} excluded, {b.counts.errors} unreadable</T>
          {!b.undoneAt && <View style={{ marginTop: 10 }}><Button title="Undo import" small kind="secondary" onPress={async () => { const r = await run((ctx) => undoImportBatch(ctx, b.id)); toast({ message: r.ok ? `Removed transactions from ${b.fileName}` : 'Could not undo' }); }} /></View>}
        </Card>
      ))}
    </SubScreen>
  );
}
