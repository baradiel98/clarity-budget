import { useState } from 'react';
import { Alert, View } from 'react-native';
import { exportTransactionsCsv } from '@clarity/data';
import { BACKUP_EXTENSION } from '@clarity/security';
import { NO_SYNC_NOTICE } from '@clarity/shared';
import { Restore } from '../../src/features/Welcome';
import { shareTextFile, stamp } from '../../src/platform/files';
import { useData, useStore } from '../../src/state/session';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { SubScreen } from '../../src/ui/SubScreen';
import { T } from '../../src/ui/Text';
import { useToast } from '../../src/ui/Toast';
import { Platform } from 'react-native';

export default function Backup() {
  const data = useData();
  const { store, demo } = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  if (restoring) return <Restore onBack={() => setRestoring(false)} replacing />;
  return (
    <SubScreen title="Backup & export">
      <T variant="footnote" color="textSecondary">{NO_SYNC_NOTICE}</T>
      <Card title="Encrypted backup">
        <T color="textSecondary">{data.settings.lastBackupAt ? `Last backup ${new Date(data.settings.lastBackupAt).toLocaleString()}.` : 'No backup yet.'} Save the file to Files, iCloud Drive, Google Drive or a computer. It restores on any phone or on the Clarity web app with your passphrase or recovery key.</T>
        <View style={{ marginTop: 12 }}>
          <Button title="Save encrypted backup" busy={busy} disabled={demo} onPress={async () => {
            setBusy(true);
            try {
              const text = await store.exportBackup(Platform.OS === 'ios' ? 'ios' : 'android');
              await shareTextFile(`clarity-${stamp()}${BACKUP_EXTENSION}`, text, 'application/json', 'public.json');
            } catch (e) {
              toast({ message: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }} />
        </View>
      </Card>
      <Card title="Restore a backup">
        <T color="textSecondary">Replaces everything on this phone with the backup's contents.</T>
        <View style={{ marginTop: 12 }}><Button title="Restore from file" kind="secondary" disabled={demo} onPress={() => setRestoring(true)} /></View>
      </Card>
      <Card title="Export CSV">
        <T color="textSecondary">Readable in any spreadsheet. Not encrypted.</T>
        <View style={{ marginTop: 12 }}>
          <Button title="Export CSV" kind="secondary" onPress={() => Alert.alert('This file is not encrypted', 'Anyone who opens it can read every transaction, amount and note. For moving your data to another device, use an encrypted backup instead.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Export', onPress: () => void shareTextFile(`clarity-transactions-${stamp()}.csv`, exportTransactionsCsv(data), 'text/csv', 'public.comma-separated-values-text') },
          ])} />
        </View>
      </Card>
    </SubScreen>
  );
}
