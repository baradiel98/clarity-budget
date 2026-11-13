import { BlurView } from 'expo-blur';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import { glass } from '@clarity/design-system';
import { useTheme } from './theme';

/**
 * Floating chrome surface. iOS 26+: native Liquid Glass. Earlier iOS: system blur material.
 * Android: a translucent solid surface (real-time blur is expensive on many Android devices).
 */
export function Glass({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const { c, scheme } = useTheme();
  const border = { borderWidth: 1, borderColor: c.glassBorder, overflow: 'hidden' as const };
  if (Platform.OS === 'ios' && isLiquidGlassAvailable()) {
    return <GlassView glassEffectStyle="regular" style={[border, style]}>{children}</GlassView>;
  }
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={glass.nativeIntensity} tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'} style={[border, style]}>
        {children}
      </BlurView>
    );
  }
  return <View style={[border, { backgroundColor: scheme === 'dark' ? 'rgba(30,31,36,0.96)' : 'rgba(255,255,255,0.96)', elevation: 6 }, style]}>{children}</View>;
}
