import * as Haptics from 'expo-haptics';
import { Delete } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { T } from './Text';
import { FONT, useTheme } from './theme';

/** One-handed amount entry. Produces a decimal string like "12.5"; parsing stays in parseAmountInput. */
export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { c } = useTheme();
  const press = (k: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (k === 'del') return onChange(value.slice(0, -1));
    if (k === '.') return onChange(value.includes('.') ? value : (value || '0') + '.');
    const [, frac] = value.split('.');
    if (frac !== undefined && frac.length >= 2) return;
    if (value === '0') return onChange(k);
    if (value.replace('.', '').length >= 9) return;
    onChange(value + k);
  };
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'del'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {keys.map((k) => (
        <Pressable
          key={k}
          accessibilityRole="button"
          accessibilityLabel={k === 'del' ? 'Delete digit' : k === '.' ? 'Decimal point' : k}
          onPress={() => press(k)}
          onLongPress={k === 'del' ? () => onChange('') : undefined}
          style={({ pressed }) => ({ width: '33.333%', height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: pressed ? c.surfacePressed : 'transparent' })}
        >
          {k === 'del' ? <Delete color={c.text} size={24} strokeWidth={1.8} /> : <T style={{ fontSize: 26, lineHeight: 32, fontFamily: FONT.medium }}>{k}</T>}
        </Pressable>
      ))}
    </View>
  );
}
