import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, radius, space, type, type ColorScheme } from '@clarity/design-system';

export interface Theme {
  c: ColorScheme;
  scheme: 'light' | 'dark';
}

const Ctx = createContext<Theme>({ c: light, scheme: 'light' });

export function ThemeProvider({ preference, children }: { preference: 'system' | 'light' | 'dark'; children: ReactNode }) {
  const sys = useColorScheme();
  const scheme = preference === 'system' ? (sys === 'dark' ? 'dark' : 'light') : preference;
  return <Ctx.Provider value={{ c: scheme === 'dark' ? dark : light, scheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);

export const FONT = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

export const weightFont = (w: number) => (w >= 700 ? FONT.bold : w >= 600 ? FONT.semibold : w >= 500 ? FONT.medium : FONT.regular);

export { radius, space, type };

/** `#RRGGBB` → `rgba(r, g, b, a)`. React Native has no CSS color-mix, so tints are computed here. */
export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Opaque mix of `a` into `b` (p = share of `a`), matching CSS `color-mix(in srgb, a p%, b)`. */
export function mixHex(a: string, b: string, p: number): string {
  const ch = (h: string, i: number) => parseInt(h.replace('#', '').slice(i, i + 2), 16);
  return '#' + [0, 2, 4].map((i) => Math.round(ch(a, i) * p + ch(b, i) * (1 - p)).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Home signature glow (same recipe as the web app's .overview cards):
 * layered blue shadow, blue-tinted border, and a light top tint that fades to the plain surface.
 * Tints are capped (10% accent at most) so every text color keeps ≥ 4.5:1 contrast.
 */
export function glowStyle(c: ColorScheme, kind: 'hero' | 'sts') {
  const tintTop = kind === 'sts' ? mixHex(c.accent, c.surface, 0.1) : mixHex(c.accent, c.surface, 0.06);
  const tintMid = mixHex(c.accent, c.surface, kind === 'sts' ? 0.04 : 0.02);
  return {
    borderColor: rgba(c.accent, 0.22),
    boxShadow: `0px 1px 3px ${rgba(c.accent, 0.12)}, 0px 4px 16px ${rgba(c.accent, 0.12)}, 0px 16px 40px ${rgba(c.accent, 0.22)}`,
    backgroundImage: kind === 'sts'
      ? `linear-gradient(165deg, ${tintTop} 0%, ${tintMid} 45%, ${c.surface} 75%)`
      : `linear-gradient(180deg, ${tintTop} 0%, ${tintMid} 25%, ${c.surface} 42%)`,
  } as const;
}

/** Soft ambient blue light placed behind the Home headline cards. */
export function ambientGlow(c: ColorScheme): string {
  return `radial-gradient(ellipse at 50% 30%, ${rgba(c.accent, 0.2)} 0%, ${rgba(c.accent, 0)} 70%)`;
}
