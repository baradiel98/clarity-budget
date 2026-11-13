import { Text, type TextProps, type TextStyle } from 'react-native';
import type { ColorScheme } from '@clarity/design-system';
import { type as scale, useTheme, weightFont } from './theme';

type Variant = keyof typeof scale;
type ColorKey = keyof Pick<ColorScheme, 'text' | 'textSecondary' | 'textTertiary' | 'accent' | 'positive' | 'negative' | 'warning' | 'accentText'>;

/** Typography from the shared scale. Respects the user's text size (allowFontScaling, capped for layout safety). */
export function T({ variant = 'body', color = 'text', num, style, ...rest }: TextProps & { variant?: Variant; color?: ColorKey; num?: boolean }) {
  const { c } = useTheme();
  const s = scale[variant];
  const base: TextStyle = {
    fontSize: s.size,
    lineHeight: s.line,
    fontFamily: weightFont(s.weight),
    letterSpacing: s.tracking,
    color: c[color],
    ...(variant === 'overline' ? { textTransform: 'uppercase' } : {}),
    ...(num ? { fontVariant: ['tabular-nums'] } : {}),
  };
  return <Text maxFontSizeMultiplier={variant === 'hero' || variant === 'display' ? 1.3 : 1.8} {...rest} style={[base, style]} />;
}
