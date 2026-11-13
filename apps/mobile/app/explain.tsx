import { router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { formatShortDate, TERMS } from '@clarity/shared';
import { takeExplain } from '../src/state/nav';
import { useData } from '../src/state/session';
import { LinkButton } from '../src/ui/Button';
import { Money } from '../src/ui/Money';
import { T } from '../src/ui/Text';
import { useTheme } from '../src/ui/theme';

/** "Why this number?" — renders the engine's own line items. */
export default function Explain() {
  const ex = takeExplain();
  const data = useData();
  const { c } = useTheme();
  const cur = data.settings.baseCurrency;
  if (!ex) return null;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 }}>
        <T variant="headline" accessibilityRole="header">{TERMS.whyThisNumber}</T>
        <LinkButton title="Done" onPress={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 4, paddingBottom: 40 }}>
        <T variant="title2">{ex.title}</T>
        <T color="textSecondary" style={{ marginBottom: 12 }}>{ex.summary}</T>
        {ex.lines.map((l, i) => (
          <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 10, borderTopWidth: l.kind === 'result' ? 0 : 1, borderTopColor: c.border }} accessible>
            <View style={{ flex: 1 }}>
              <T style={{ fontFamily: l.kind === 'result' ? 'Inter_700Bold' : 'Inter_400Regular' }} color={l.kind === 'excluded' ? 'textTertiary' : 'text'}>{l.label}</T>
              {(l.date || l.note) && <T variant="caption" color="textTertiary">{[l.date ? formatShortDate(l.date) : '', l.note ?? ''].filter(Boolean).join(' · ')}</T>}
            </View>
            {l.cents !== undefined && <Money cents={l.cents} currency={cur} sign={l.kind === 'in' || l.kind === 'out' || l.kind === 'reserve' ? 'always' : 'auto'} style={{ fontFamily: l.kind === 'result' ? 'Inter_700Bold' : 'Inter_500Medium' }} color={l.kind === 'excluded' ? 'textTertiary' : 'text'} />}
          </View>
        ))}
        <T variant="headline" style={{ marginTop: 20 }}>Assumptions</T>
        {ex.assumptions.map((a) => <T key={a} variant="footnote" color="textSecondary" style={{ marginTop: 6 }}>• {a}</T>)}
      </ScrollView>
    </View>
  );
}
