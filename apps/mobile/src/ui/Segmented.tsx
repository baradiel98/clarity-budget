import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';
import { T } from './Text';
import { FONT, useTheme } from './theme';

export function Segmented<V extends string>({ value, options, onChange, label }: { value: V; options: readonly { value: V; label: string }[]; onChange: (v: V) => void; label: string }) {
  const { c } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: c.surfaceMuted, borderRadius: 12, padding: 3, gap: 2 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => {
              void Haptics.selectionAsync();
              onChange(o.value);
            }}
            style={{ flex: 1, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, backgroundColor: on ? c.surface : 'transparent', borderWidth: on ? 1 : 0, borderColor: c.border }}
          >
            <T variant="footnote" color={on ? 'text' : 'textSecondary'} style={{ fontFamily: FONT.semibold }} numberOfLines={1}>{o.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}
