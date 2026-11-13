import { Tabs, router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CalendarRange, House, Plus, ReceiptText, Settings } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TERMS } from '@clarity/shared';
import { setAddPrefill } from '../../src/state/nav';
import { useSession } from '../../src/state/session';
import { Glass } from '../../src/ui/Glass';
import { T } from '../../src/ui/Text';
import { useTheme } from '../../src/ui/theme';

const ICONS = { index: House, transactions: ReceiptText, planning: CalendarRange, settings: Settings } as const;
const LABELS = { index: TERMS.tabs.home, transactions: TERMS.tabs.transactions, planning: TERMS.tabs.planning, settings: TERMS.tabs.settings } as const;

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <GlassTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="transactions" />
      <Tabs.Screen name="planning" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

/** Floating glass tab bar with a central Add button within thumb reach. */
function GlassTabBar({ state, navigateToTab }: { state: { index: number; routes: { key: string; name: string }[] }; navigateToTab: (routeKey: string) => void }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const s = useSession();
  const demo = s.phase.kind === 'ready' && s.phase.demo;
  const tab = (i: number) => {
    const r = state.routes[i]!;
    const name = r.name as keyof typeof ICONS;
    const Icon = ICONS[name];
    const on = state.index === i;
    return (
      <Pressable
        key={r.key}
        accessibilityRole="tab"
        accessibilityState={{ selected: on }}
        accessibilityLabel={LABELS[name]}
        onPress={() => { void Haptics.selectionAsync(); navigateToTab(r.key); }}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 52 }}
      >
        <Icon size={22} color={on ? c.accent : c.textSecondary} strokeWidth={on ? 2.2 : 1.8} />
        <T variant="caption" color={on ? 'accent' : 'textSecondary'} maxFontSizeMultiplier={1.2}>{LABELS[name]}</T>
      </Pressable>
    );
  };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, bottom: Math.max(insets.bottom, 12) }}>
      {demo && (
        <Pressable onPress={s.exitDemo} accessibilityRole="button" style={{ alignSelf: 'center', marginBottom: 8, backgroundColor: c.warningSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
          <T variant="caption" color="warning">Sample data — nothing is saved · Tap to exit</T>
        </Pressable>
      )}
      <Glass style={{ borderRadius: 28, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 4 }}>
        {tab(0)}
        {tab(1)}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={TERMS.addTransaction}
          onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setAddPrefill(null); router.push('/add'); }}
          style={({ pressed }) => ({ width: 56, height: 56, borderRadius: 20, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center', marginHorizontal: 6, transform: [{ scale: pressed ? 0.94 : 1 }] })}
        >
          <Plus size={28} color={c.accentText} strokeWidth={2.4} />
        </Pressable>
        {tab(2)}
        {tab(3)}
      </Glass>
    </View>
  );
}
