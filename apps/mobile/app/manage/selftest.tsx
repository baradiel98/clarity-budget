import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { runEngineSelfTest } from '@clarity/engine';
import { runCryptoSelfTest, type SelfTestResult } from '@clarity/security';
import { provider } from '../../src/platform/crypto';
import { Badge, Card } from '../../src/ui/Card';
import { SubScreen } from '../../src/ui/SubScreen';
import { T } from '../../src/ui/Text';

/** Recomputes the golden scenarios and crypto vectors on this device; shows Argon2id timing. */
export default function SelfTest() {
  const [engine] = useState(() => runEngineSelfTest());
  const [crypto, setCrypto] = useState<SelfTestResult[] | null>(null);
  useEffect(() => {
    const t = setTimeout(() => void runCryptoSelfTest(provider).then(setCrypto), 50);
    return () => clearTimeout(t);
  }, []);
  const all = [...engine.map((e) => ({ name: `Engine: ${e.name}`, ok: e.ok, detail: e.detail })), ...(crypto ?? []).map((x) => ({ name: `Crypto: ${x.name}`, ok: x.ok, detail: x.ok ? `${Math.round(x.ms)} ms` : x.detail }))];
  const passed = crypto && all.every((r) => r.ok);
  return (
    <SubScreen title="Self-test">
      <T color={!crypto ? 'textSecondary' : passed ? 'positive' : 'negative'} style={{ fontFamily: 'Inter_600SemiBold' }}>{!crypto ? 'Running… (Argon2id can take several seconds on a phone)' : passed ? 'All checks passed' : 'Some checks failed'}</T>
      <T variant="footnote" color="textTertiary">{Platform.OS} {String(Platform.Version)}</T>
      <Card>
        {all.map((r) => (
          <View key={r.name} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, gap: 8 }}>
            <T style={{ flex: 1 }}>{r.name}</T>
            <Badge label={`${r.ok ? 'Pass' : 'Fail'}${r.detail ? ` · ${r.detail}` : ''}`} tone={r.ok ? 'pos' : 'neg'} />
          </View>
        ))}
      </Card>
    </SubScreen>
  );
}
