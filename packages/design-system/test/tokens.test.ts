import { describe, expect, it } from 'vitest';
import { categorical, contrastRatio, dark, light } from '../src';

describe.each([['light', light], ['dark', dark]] as const)('%s scheme contrast (WCAG AA)', (_n, c) => {
  const surfaces = [c.bg, c.surface, c.surfaceMuted];
  it.each(['text', 'textSecondary', 'textTertiary', 'accent', 'positive', 'warning', 'negative'] as const)('%s ≥ 4.5:1 on every surface', (key) => {
    for (const s of surfaces) expect(contrastRatio(c[key], s)).toBeGreaterThanOrEqual(4.5);
  });
  it('accent button text ≥ 4.5:1', () => {
    expect(contrastRatio(c.accentText, c.accent)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('categorical palette', () => {
  it('every hue is distinguishable from the card surface (3:1, used for dots and bars with labels)', () => {
    for (const h of categorical.light) expect(contrastRatio(h, light.surface)).toBeGreaterThanOrEqual(3);
    for (const h of categorical.dark) expect(contrastRatio(h, dark.surface)).toBeGreaterThanOrEqual(3);
  });
});
