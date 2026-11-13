import type { ComponentProps, ReactNode } from 'react';
import { TextInput, View } from 'react-native';
import { T } from './Text';
import { FONT, radius, useTheme } from './theme';

/** React 19: `ref` is a regular prop and is forwarded with the rest. */
export function Input({ invalid, style, ...rest }: ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  const { c } = useTheme();
  return (
    <TextInput
      placeholderTextColor={c.textTertiary}
      style={[{ minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: invalid ? c.negative : c.borderStrong, backgroundColor: c.surface, color: c.text, paddingHorizontal: 14, fontSize: 16, fontFamily: FONT.regular }, style]}
      maxFontSizeMultiplier={1.6}
      {...rest}
    />
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <T variant="footnote" color="textSecondary" style={{ fontFamily: FONT.semibold }}>{label}</T>
      {children}
      {error ? <T variant="footnote" color="negative" accessibilityRole="alert">{error}</T> : hint ? <T variant="caption" color="textTertiary">{hint}</T> : null}
    </View>
  );
}
