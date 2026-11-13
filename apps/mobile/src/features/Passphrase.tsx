import { View } from 'react-native';
import { checkPassphrase } from '@clarity/security';
import { Field, Input } from '../ui/Field';
import { useTheme } from '../ui/theme';

export function PassphraseFields({ pass, confirm, setPass, setConfirm, showErrors }: { pass: string; confirm: string; setPass: (v: string) => void; setConfirm: (v: string) => void; showErrors: boolean }) {
  const { c } = useTheme();
  const check = checkPassphrase(pass);
  const mismatch = (confirm.length > 0 || showErrors) && confirm !== pass;
  return (
    <View style={{ gap: 16 }}>
      <Field label="Passphrase" hint={pass ? check.message : 'At least 10 characters. A few unrelated words work well.'} error={showErrors && !check.ok ? check.message : null}>
        <Input value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" autoComplete="new-password" invalid={showErrors && !check.ok} autoFocus accessibilityLabel="Passphrase" />
        <View style={{ flexDirection: 'row', gap: 4 }} accessibilityElementsHidden>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={{ flex: 1, height: 4, borderRadius: 3, backgroundColor: pass && check.ok && check.score >= i ? (check.score < 2 ? c.warning : c.positive) : c.surfaceMuted }} />
          ))}
        </View>
      </Field>
      <Field label="Confirm passphrase" error={mismatch ? 'Passphrases do not match.' : null}>
        <Input value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" autoCorrect={false} textContentType="newPassword" invalid={mismatch} accessibilityLabel="Confirm passphrase" />
      </Field>
    </View>
  );
}

export const passphraseValid = (pass: string, confirm: string) => checkPassphrase(pass).ok && pass === confirm;
