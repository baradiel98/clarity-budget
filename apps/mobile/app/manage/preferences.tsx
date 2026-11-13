import { useState } from 'react';
import { View } from 'react-native';
import { updateSettings } from '@clarity/data';
import { centsToDecimalString, parseAmountInput, TERMS } from '@clarity/shared';
import { useData, useRun } from '../../src/state/session';
import { Card } from '../../src/ui/Card';
import { Field, Input } from '../../src/ui/Field';
import { Segmented } from '../../src/ui/Segmented';
import { SubScreen } from '../../src/ui/SubScreen';
import { Chip } from '../add';

export default function Preferences() {
  const data = useData();
  const run = useRun();
  const cur = data.settings.baseCurrency;
  const [reserve, setReserve] = useState(centsToDecimalString(data.settings.minReserveCents));
  return (
    <SubScreen title="Preferences">
      <Card>
        <View style={{ gap: 18 }}>
          <Field label={TERMS.minReserve} hint="Safe to Spend keeps this much aside.">
            <Input value={reserve} onChangeText={(t) => setReserve(t.replace(/[^\d.,]/g, ''))} keyboardType="decimal-pad" onEndEditing={() => { const v = parseAmountInput(reserve, cur); if (v !== null) void run((ctx) => updateSettings(ctx, { minReserveCents: v })); }} />
          </Field>
          <Field label="Appearance">
            <Segmented label="Theme" value={data.settings.theme} onChange={(v) => void run((ctx) => updateSettings(ctx, { theme: v }))} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
          </Field>
          <Field label="Lock after leaving the app for" hint="On this phone the app always locks after 5 minutes in the background, even if a longer time is chosen.">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[1, 5, 15].map((m) => <Chip key={m} label={`${m} min`} on={data.settings.autoLockMinutes === m} onPress={() => void run((ctx) => updateSettings(ctx, { autoLockMinutes: m }))} />)}
            </View>
          </Field>
          <Field label="Default account">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {data.accounts.filter((a) => !a.archived).map((a) => <Chip key={a.id} label={a.name} on={data.settings.defaultAccountId === a.id} onPress={() => void run((ctx) => updateSettings(ctx, { defaultAccountId: a.id }))} />)}
            </View>
          </Field>
        </View>
      </Card>
    </SubScreen>
  );
}
