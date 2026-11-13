import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, View, type PressableProps, type ViewStyle } from 'react-native';
import { T } from './Text';
import { radius, useTheme } from './theme';

type Kind = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({ title, kind = 'primary', icon, busy, small, style, onPress, disabled, ...rest }: Omit<PressableProps, 'style'> & { title: string; kind?: Kind; icon?: ReactNode; busy?: boolean; small?: boolean; style?: ViewStyle }) {
  const { c } = useTheme();
  const bg = kind === 'primary' ? c.accent : kind === 'danger' ? c.negative : kind === 'secondary' ? c.surface : 'transparent';
  const fg = kind === 'primary' ? 'accentText' : kind === 'danger' ? 'accentText' : kind === 'ghost' ? 'textSecondary' : 'text';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      disabled={disabled || busy}
      onPress={(e) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(e);
      }}
      style={({ pressed }) => [
        {
          minHeight: small ? 36 : 50,
          paddingHorizontal: small ? 14 : 20,
          borderRadius: small ? 10 : radius.md,
          backgroundColor: bg,
          borderWidth: kind === 'secondary' ? 1 : 0,
          borderColor: c.borderStrong,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: 8,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
        style,
      ]}
      {...rest}
    >
      {busy ? <ActivityIndicator color={kind === 'primary' ? c.accentText : c.text} /> : <>{icon ? <View>{icon}</View> : null}<T variant={small ? 'footnote' : 'headline'} color={fg} style={{ fontFamily: 'Inter_600SemiBold' }}>{title}</T></>}
    </Pressable>
  );
}

export function LinkButton({ title, onPress, color = 'accent' }: { title: string; onPress: () => void; color?: 'accent' | 'textSecondary' | 'negative' }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, paddingVertical: 4 })}>
      <T variant="callout" color={color} style={{ fontFamily: 'Inter_500Medium' }}>{title}</T>
    </Pressable>
  );
}
