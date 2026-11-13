import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View, type ScrollViewProps } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from './Text';
import { space, useTheme } from './theme';

/** Scrollable page with a large title, safe areas and room for the floating tab bar. */
export function Screen({ title, subtitle, right, children, tabBar = true, ...rest }: ScrollViewProps & { title?: string; subtitle?: string; right?: ReactNode; children: ReactNode; tabBar?: boolean }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: c.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + space.lg, paddingHorizontal: space.lg, paddingBottom: insets.bottom + (tabBar ? 120 : 40), gap: space.lg }}
        {...rest}
      >
        {title && (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: space.xs }}>
            <View style={{ flex: 1 }}>
              <T variant="display" accessibilityRole="header">{title}</T>
              {subtitle ? <T variant="callout" color="textSecondary">{subtitle}</T> : null}
            </View>
            {right}
          </View>
        )}
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
