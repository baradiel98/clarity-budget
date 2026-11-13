import { router } from 'expo-router';
import { Activity, Database, FileUp, KeyRound, Layers, Lock, ShieldCheck, SlidersHorizontal, Tags, Trash2, Wallet } from 'lucide-react-native';
import { NO_SYNC_NOTICE, TERMS } from '@clarity/shared';
import { confirmWipe } from '../../src/features/Lock';
import { useSession, useStore } from '../../src/state/session';
import { Card } from '../../src/ui/Card';
import { IconBubble, ListRow } from '../../src/ui/ListRow';
import { Screen } from '../../src/ui/Screen';
import { T } from '../../src/ui/Text';
import { useTheme } from '../../src/ui/theme';

export default function SettingsTab() {
  const s = useSession();
  const { demo } = useStore();
  const { c } = useTheme();
  const ic = (I: typeof Wallet, color = c.textSecondary) => <IconBubble><I size={17} color={color} /></IconBubble>;
  const go = (p: string) => () => router.push(p as never);
  return (
    <Screen title={TERMS.tabs.settings}>
      <T variant="footnote" color="textSecondary">{NO_SYNC_NOTICE}</T>
      <Card>
        <ListRow icon={ic(Wallet)} title="Accounts" onPress={go('/manage/accounts')} chevron />
        <ListRow icon={ic(Tags)} title="Categories" onPress={go('/manage/categories')} chevron />
        <ListRow icon={ic(SlidersHorizontal)} title="Preferences" subtitle="Reserve, appearance, auto-lock" onPress={go('/manage/preferences')} chevron last />
      </Card>
      <Card>
        <ListRow icon={ic(KeyRound)} title="Security" subtitle={s.biometric.enabled ? `${s.biometric.label} unlock on` : 'Passphrase, recovery key, biometrics'} onPress={demo ? undefined : go('/manage/security')} chevron={!demo} />
        <ListRow icon={ic(Database)} title="Backup & export" subtitle="Encrypted backup, restore, CSV" onPress={go('/manage/backup')} chevron />
        <ListRow icon={ic(FileUp)} title={TERMS.importStatement} onPress={go('/import')} chevron />
        <ListRow icon={ic(Layers)} title="Import history" onPress={go('/manage/imports')} chevron last />
      </Card>
      <Card>
        <ListRow icon={ic(ShieldCheck, c.accent)} title={TERMS.privacyCenter} onPress={go('/manage/privacy')} chevron />
        <ListRow icon={ic(Activity)} title="Self-test" subtitle="Check calculations and encryption on this phone" onPress={go('/manage/selftest')} chevron />
        {!demo && <ListRow icon={ic(Lock)} title="Lock now" onPress={s.lock} />}
        {!demo && <ListRow icon={<IconBubble><Trash2 size={17} color={c.negative} /></IconBubble>} title="Delete all data" onPress={() => confirmWipe(s.wipe)} last />}
      </Card>
    </Screen>
  );
}
