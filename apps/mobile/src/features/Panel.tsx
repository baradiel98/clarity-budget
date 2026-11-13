import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space, useTheme } from '../ui/theme';

/** Full-screen step container for onboarding / lock. */
export function Panel({ children, footer, step }: { children: ReactNode; footer?: ReactNode; step?: number }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + space.xxl, paddingHorizontal: space.xl, gap: space.lg }}>
        {step !== undefined && (
          <View style={{ flexDirection: 'row', gap: 6 }} accessibilityElementsHidden>
            {[0, 1, 2, 3, 4].map((i) => <View key={i} style={{ flex: 1, height: 4, borderRadius: 4, backgroundColor: i <= step ? c.accent : c.surfaceMuted }} />)}
          </View>
        )}
        {children}
      </ScrollView>
      {footer && <View style={{ paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: insets.bottom + space.lg, gap: space.sm, backgroundColor: c.bg }}>{footer}</View>}
    </KeyboardAvoidingView>
  );
}
