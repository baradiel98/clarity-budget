import { HardDrive, KeyRound, ShieldCheck, Upload } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { WorkspaceStore } from '@clarity/data';
import { NO_SYNC_NOTICE } from '@clarity/shared';
import { pickTextFile } from '../platform/files';
import { useSession } from '../state/session';
import { Button } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { Segmented } from '../ui/Segmented';
import { T } from '../ui/Text';
import { useTheme } from '../ui/theme';
import { Panel } from './Panel';
import { PassphraseFields, passphraseValid } from './Passphrase';

export function Welcome() {
  const session = useSession();
  const { c } = useTheme();
  const [step, setStep] = useState<'welcome' | 'passphrase' | 'restore'>('welcome');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [withRecovery, setWithRecovery] = useState(true);
  const [ack, setAck] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (step === 'restore') return <Restore onBack={() => setStep('welcome')} />;

  if (step === 'passphrase') {
    const create = async () => {
      setShowErrors(true);
      if (!passphraseValid(pass, confirm) || (!withRecovery && !ack)) return;
      setBusy(true);
      try {
        await session.createVault(pass, withRecovery);
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    };
    return (
      <Panel step={0} footer={<><Button title={busy ? 'Encrypting…' : 'Continue'} busy={busy} onPress={() => void create()} /><Button title="Back" kind="ghost" onPress={() => setStep('welcome')} /></>}>
        <T variant="title1" accessibilityRole="header">Create your passphrase</T>
        <T color="textSecondary">It encrypts your data on this phone. We never see it and can't reset it.</T>
        <PassphraseFields pass={pass} confirm={confirm} setPass={setPass} setConfirm={setConfirm} showErrors={showErrors} />
        <Check label="Create a recovery key (recommended)" hint="A second key that unlocks your data if you forget the passphrase." value={withRecovery} onChange={setWithRecovery} />
        {!withRecovery && <Check label="I understand that if I forget my passphrase, my data cannot be recovered by anyone." value={ack} onChange={setAck} warn />}
        {error && <T color="negative">{error}</T>}
      </Panel>
    );
  }

  return (
    <Panel footer={<><Button title="Get started" onPress={() => setStep('passphrase')} /><View style={{ flexDirection: 'row', gap: 8 }}><Button title="Restore backup" kind="secondary" style={{ flex: 1 }} onPress={() => setStep('restore')} icon={<Upload size={16} color={c.text} />} /><Button title="Sample data" kind="secondary" style={{ flex: 1 }} onPress={() => void session.startDemo()} /></View></>}>
      <Image source={require('../../assets/splash-icon.png')} style={{ width: 52, height: 52, marginTop: 20 }} accessibilityIgnoresInvertColors />
      <T variant="display" accessibilityRole="header">Understand your money. Privately.</T>
      <T color="textSecondary">See what you can safely spend, what's coming up, and where you'll land at the end of the month.</T>
      <View style={{ gap: 14, marginTop: 8 }}>
        <Point icon={<HardDrive size={18} color={c.accent} />} title="Your data stays on this phone." body="No account and no server holding your finances." />
        <Point icon={<ShieldCheck size={18} color={c.accent} />} title="No bank login, ever." body="Add transactions yourself or import a statement file." />
        <Point icon={<KeyRound size={18} color={c.accent} />} title="Encrypted with your passphrase." body="Unlock with Face ID or fingerprint once set up." />
      </View>
      <T variant="caption" color="textTertiary">{NO_SYNC_NOTICE}</T>
    </Panel>
  );
}

function Point({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ marginTop: 2 }}>{icon}</View>
      <T color="textSecondary" style={{ flex: 1 }}><T style={{ fontFamily: 'Inter_600SemiBold' }}>{title} </T>{body}</T>
    </View>
  );
}

export function Check({ label, hint, value, onChange, warn }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; warn?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: value }} onPress={() => onChange(!value)} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: warn ? 12 : 0, borderRadius: 12, backgroundColor: warn ? c.warningSoft : 'transparent' }}>
      <View style={{ width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: value ? c.accent : c.borderStrong, backgroundColor: value ? c.accent : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
        {value && <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: c.accentText }} />}
      </View>
      <View style={{ flex: 1 }}>
        <T color={warn ? 'warning' : 'text'}>{label}</T>
        {hint && <T variant="footnote" color="textTertiary">{hint}</T>}
      </View>
    </Pressable>
  );
}

export function Restore({ onBack, replacing }: { onBack: () => void; replacing?: boolean }) {
  const session = useSession();
  const [file, setFile] = useState<{ name: string; text: string; info: ReturnType<typeof WorkspaceStore.inspectBackup> } | null>(null);
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async () => {
    setError(null);
    try {
      const f = await pickTextFile(['application/json', 'application/octet-stream', '*/*']);
      if (f) setFile({ name: f.name, text: f.text, info: WorkspaceStore.inspectBackup(f.text) });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const restore = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await session.restore(file.text, mode === 'passphrase' ? { passphrase: secret } : { recoveryKey: secret });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <Panel footer={<><Button title={busy ? 'Decrypting…' : replacing ? 'Replace data on this phone' : 'Restore'} kind={replacing ? 'danger' : 'primary'} busy={busy} disabled={!file || !secret} onPress={() => void restore()} /><Button title="Back" kind="ghost" onPress={onBack} /></>}>
      <T variant="title1" accessibilityRole="header">Restore a backup</T>
      <T color="textSecondary">Choose a .claritybackup file made on this phone, another phone, or the Clarity web app.</T>
      {replacing && <T color="warning">Everything currently on this phone will be replaced by the backup.</T>}
      {!file ? (
        <Button title="Choose backup file" kind="secondary" onPress={() => void choose()} />
      ) : (
        <View style={{ gap: 12 }}>
          <T variant="callout"><T style={{ fontFamily: 'Inter_600SemiBold' }}>{file.name}</T>{'\n'}Made {new Date(file.info.createdAt).toLocaleString()} on {file.info.appPlatform}</T>
          {file.info.hasRecoveryKey && <Segmented label="Unlock with" value={mode} onChange={setMode} options={[{ value: 'passphrase', label: 'Passphrase' }, { value: 'recovery', label: 'Recovery key' }]} />}
          <Field label={mode === 'passphrase' ? 'Passphrase used when the backup was made' : 'Recovery key'}>
            <Input value={secret} onChangeText={setSecret} secureTextEntry={mode === 'passphrase'} autoCapitalize={mode === 'recovery' ? 'characters' : 'none'} autoCorrect={false} />
          </Field>
        </View>
      )}
      {error && <T color="negative" accessibilityRole="alert">{error}</T>}
    </Panel>
  );
}
