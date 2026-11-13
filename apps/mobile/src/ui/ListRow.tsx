import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { T } from './Text';
import { useTheme } from './theme';

export function ListRow({ icon, title, subtitle, right, onPress, onLongPress, chevron, accessibilityLabel, last }: { icon?: ReactNode; title: string; subtitle?: ReactNode; right?: ReactNode; onPress?: () => void; onLongPress?: () => void; chevron?: boolean; accessibilityLabel?: string; last?: boolean }) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: c.border, opacity: pressed ? 0.6 : 1 })}
    >
      {icon}
      <View style={{ flex: 1, gap: 2 }}>
        <T numberOfLines={1} style={{ fontFamily: 'Inter_500Medium' }}>{title}</T>
        {typeof subtitle === 'string' ? <T variant="footnote" color="textTertiary" numberOfLines={2}>{subtitle}</T> : subtitle}
      </View>
      {right}
      {chevron && <ChevronRight size={18} color={c.textTertiary} />}
    </Pressable>
  );
}

export function IconBubble({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'inflow' }) {
  const { c } = useTheme();
  return <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: tone === 'inflow' ? c.positiveSoft : c.surfaceMuted }}>{children}</View>;
}
