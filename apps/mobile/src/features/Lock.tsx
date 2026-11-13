import { Fingerprint, ScanFace } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Alert, Image, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSession } from '../state/session';
import { Button, LinkButton } from '../ui/Button';
import { Field, Input } from '../ui/Field';
import { T } from '../ui/Text';
import { useTheme } from '../ui/theme';
import { Panel } from './Panel';

export function LockScreen() {
  const s = useSession();
  const { c } = useTheme();
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tryBiometric = async () => {
    const r = await s.unlockWithBiometric();
    if (r === 'unavailable') setError(`${s.biometric.label} unlock is no longer available. Use your passphrase, then turn it on again in Settings.`);
  };
  useEffect(() => {
    if (s.biometric.enabled) void tryBiometric();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const unlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await s.unlock(mode === 'passphrase' ? { passphrase: secret } : { recoveryKey: secret });
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError((e as Error).message);
      setSecret('');
      setBusy(false);
    }
  };
  const BioIcon = s.biometric.label === 'Face ID' || s.biometric.label === 'face unlock' ? ScanFace : Fingerprint;
  return (
    <Panel
      footer={
        <>
          <Button title={busy ? 'Unlocking…' : 'Unlock'} busy={busy} disabled={!secret} onPress={() => void unlock()} />
          {s.biometric.enabled && <Button title={`Use ${s.biometric.label}`} kind="secondary" icon={<BioIcon size={18} color={c.text} />} onPress={() => void tryBiometric()} />}
        </>
      }
    >
      <Image source={require('../../assets/splash-icon.png')} style={{ width: 48, height: 48, marginTop: 20 }} />
      <T variant="title1" accessibilityRole="header">Welcome back</T>
      <T color="textSecondary">Your data is encrypted on this phone. Enter your {mode === 'passphrase' ? 'passphrase' : 'recovery key'} to unlock it.</T>
      <Field label={mode === 'passphrase' ? 'Passphrase' : 'Recovery key'} error={error}>
        <Input value={secret} onChangeText={setSecret} secureTextEntry={mode === 'passphrase'} autoCapitalize={mode === 'recovery' ? 'characters' : 'none'} autoCorrect={false} textContentType={mode === 'passphrase' ? 'password' : 'none'} onSubmitEditing={() => void unlock()} returnKeyType="go" invalid={!!error} />
      </Field>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <LinkButton title={mode === 'passphrase' ? 'Use recovery key instead' : 'Use passphrase instead'} onPress={() => { setMode(mode === 'passphrase' ? 'recovery' : 'passphrase'); setSecret(''); setError(null); }} />
        <LinkButton
          title="Lost both?"
          color="textSecondary"
          onPress={() =>
            Alert.alert(
              'If you lost your passphrase and recovery key',
              'Your data is encrypted with keys only you hold. Without them, no one — including us — can unlock it. If you have a backup file and remember the passphrase used to make it, delete this data and restore the backup.',
              [{ text: 'Back', style: 'cancel' }, { text: 'Delete data and start over', style: 'destructive', onPress: () => confirmWipe(s.wipe) }],
            )
          }
        />
      </View>
    </Panel>
  );
}

export function confirmWipe(wipe: () => Promise<void>) {
  Alert.alert('Delete all data on this phone?', 'This destroys the encryption keys on this phone and then deletes the database. The remaining data cannot be decrypted by anyone. Backup files you saved elsewhere are not affected.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete permanently', style: 'destructive', onPress: () => void wipe() },
  ]);
}
