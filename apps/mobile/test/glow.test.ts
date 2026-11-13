import { contrastRatio, dark, light } from '@clarity/design-system';
import { glowStyle, mixHex, rgba } from '../src/ui/theme';

describe('Home glow', () => {
  it('mixes colors like CSS color-mix', () => {
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(rgba('#2559DB', 0.2)).toBe('rgba(37, 89, 219, 0.2)');
  });

  it.each([['light', light], ['dark', dark]] as const)('%s: every text color stays ≥ 4.5:1 on the strongest tint', (_n, c) => {
    for (const kind of ['hero', 'sts'] as const) {
      const top = /linear-gradient\(\d+deg, (#[0-9A-F]{6})/.exec(glowStyle(c, kind).backgroundImage)![1]!;
      for (const key of ['text', 'textSecondary', 'textTertiary', 'accent', 'positive', 'negative', 'warning'] as const) {
        expect(contrastRatio(c[key], top)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
