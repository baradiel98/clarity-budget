import { useState } from 'react';
import { Alert, Share, Switch, View } from 'react-native';
import { PassphraseFields, passphraseValid } from '../../src/features/Passphrase';
import { useSession, useStore } from '../../src/state/session';
import { Button } from '../../src/ui/Button';
import { Card } from '../../src/ui/Card';
import { Field, Input } from '../../src/ui/Field';
import { SubScreen } from '../../src/ui/SubScreen';
import { T } from '../../src/ui/Text';
import { useTheme } from '../../src/ui/theme';
import { useToast } from '../../src/ui/Toast';

export default function Security() {
  const s = useSession();
  const { store } = useStore();
  const { c } = useTheme();
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const [current, setCurrent] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasRecovery, setHasRecovery] = useState(store.hasRecoveryKey);
  const [newKey, setNewKey] = useState<string | null>(null);

  return (
    <SubScreen title="Security">
      <Card title="Biometric unlock">
        {s.biometric.available ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <T style={{ flex: 1 }}>Unlock with {s.biometric.label}</T>
            <Switch
              value={s.biometric.enabled}
              trackColor={{ true: c.accent }}
              accessibilityLabel={`Unlock with ${s.biometric.label}`}
              onValueChange={async (on) => {
                try {
                  await s.setBiometric(on);
                } catch (e) {
                  toast({ message: `Could not turn on ${s.biometric.label}: ${(e as Error).message}` });
                }
              }}
            />
          </View>
        ) : (
          <T color="textSecondary">Not available. Set up Face ID, Touch ID or a fingerprint in your phone's settings first. (In Expo Go on iPhone, Face ID requires a development build.)</T>
        )}
        <T variant="footnote" color="textSecondary" style={{ marginTop: 8 }}>A copy of the encryption key is kept in the phone's secure hardware ({'Keychain / Keystore'}) and released only after biometric verification. Your passphrase still works.</T>
      </Card>

      <Card title="Passphrase">
        {!changing ? (
          <Button title="Change passphrase" kind="secondary" small onPress={() => setChanging(true)} />
        ) : (
          <View style={{ gap: 14 }}>
            <Field label="Current passphrase" error={error}><Input value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" /></Field>
            <PassphraseFields pass={pass} confirm={confirm} setPass={setPass} setConfirm={setConfirm} showErrors={show} />
            <Button title={busy ? 'Saving…' : 'Change passphrase'} busy={busy} onPress={async () => {
              setShow(true);
              if (!passphraseValid(pass, confirm)) return;
              setBusy(true);
              try {
                await store.changePassphrase(current, pass);
                toast({ message: 'Passphrase changed. Older backups still need the old passphrase or your recovery key.' });
                setChanging(false);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }} />
          </View>
        )}
      </Card>

      <Card title="Recovery key">
        <T color="textSecondary">{hasRecovery ? 'Set up. Creating a new one makes the old key stop working.' : 'Not set up. Without one, a forgotten passphrase means your data cannot be recovered.'}</T>
        {newKey && (
          <View style={{ marginTop: 10, gap: 8 }}>
            <T selectable style={{ fontFamily: 'Courier', fontSize: 16, textAlign: 'center' }}>{newKey}</T>
            <Button title="Save to password manager or notes" small kind="secondary" onPress={() => void Share.share({ message: `Clarity recovery key: ${newKey}` })} />
            <T variant="footnote" color="warning">Shown only once. Save it now.</T>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Button title={hasRecovery ? 'Create new key' : 'Create key'} small kind="secondary" onPress={async () => { setNewKey(await store.regenerateRecoveryKey()); setHasRecovery(true); }} />
          {hasRecovery && <Button title="Remove" small kind="ghost" onPress={() => Alert.alert('Remove the recovery key?', 'Only your passphrase will unlock your data.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { await store.removeRecoveryKey(); setHasRecovery(false); setNewKey(null); } }])} />}
        </View>
      </Card>
    </SubScreen>
  );
}
