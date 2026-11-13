import { formatCents, type Cents } from '@clarity/shared';
import type { TextProps } from 'react-native';
import { T } from './Text';

/** Every amount on screen: tabular figures, true minus sign, and a spoken label for screen readers. */
export function Money({ cents, currency, sign = 'auto', variant = 'body', color, ...rest }: { cents: Cents; currency: string; sign?: 'auto' | 'always' | 'never'; variant?: Parameters<typeof T>[0]['variant']; color?: Parameters<typeof T>[0]['color'] } & TextProps) {
  const text = formatCents(cents, currency, { sign });
  const spoken = `${cents < 0 ? 'minus ' : sign === 'always' && cents > 0 ? 'plus ' : ''}${formatCents(Math.abs(cents), currency)}`;
  return (
    <T num variant={variant} color={color ?? 'text'} accessibilityLabel={spoken} {...rest}>
      {text}
    </T>
  );
}
