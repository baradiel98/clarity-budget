import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { T } from './Text';
import { glowStyle, radius, space, useTheme } from './theme';

/**
 * Solid surface for information (glass is reserved for floating chrome).
 * `glow` is only for the Home headline cards (projected month-end, Safe to Spend).
 */
export function Card({ title, right, children, style, glow }: { title?: string; right?: ReactNode; children: ReactNode; style?: ViewStyle; glow?: 'hero' | 'sts' }) {
  const { c } = useTheme();
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: space.xl }, glow ? glowStyle(c, glow) : null, style]}>
      {(title || right) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm }}>
          {title ? <T variant="footnote" color="textSecondary" style={{ fontFamily: 'Inter_600SemiBold' }} accessibilityRole="header">{title}</T> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function Divider() {
  const { c } = useTheme();
  return <View style={{ height: 1, backgroundColor: c.border, marginVertical: space.md }} />;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'accent' | 'pos' | 'warn' | 'neg' }) {
  const { c } = useTheme();
  const map = {
    neutral: [c.surfaceMuted, 'textSecondary'],
    accent: [c.accentSoft, 'accent'],
    pos: [c.positiveSoft, 'positive'],
    warn: [c.warningSoft, 'warning'],
    neg: [c.negativeSoft, 'negative'],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' }}>
      <T variant="caption" color={fg}>{label}</T>
    </View>
  );
}
