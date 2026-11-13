/**
 * Clarity design tokens — the single source for both apps.
 * Web consumes the generated CSS variables (apps/web/src/styles/tokens.css);
 * mobile imports these objects directly into StyleSheets.
 *
 * Principles: calm neutrals, one accent, semantic colors used sparingly,
 * glass only for floating chrome (navigation, sheets, toasts), solid surfaces for data.
 */

export interface ColorScheme {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceMuted: string;
  surfacePressed: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentText: string; // text on accent fill
  accentSoft: string;
  positive: string;
  positiveSoft: string;
  warning: string;
  warningSoft: string;
  negative: string;
  negativeSoft: string;
  focus: string;
  glassFill: string;
  glassBorder: string;
  glassShadow: string;
  overlay: string;
  chartLine: string;
  chartFill: string;
  chartGrid: string;
}

export const light: ColorScheme = {
  bg: '#F4F4F6',
  bgElevated: '#FAFAFB',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F0F3',
  surfacePressed: '#E7E7EB',
  text: '#1C1C1F',
  textSecondary: '#5E5E66',
  textTertiary: '#66666E',
  border: 'rgba(20, 20, 30, 0.08)',
  borderStrong: 'rgba(20, 20, 30, 0.16)',
  accent: '#0F5F73',
  accentText: '#FFFFFF',
  accentSoft: 'rgba(15, 95, 115, 0.10)',
  positive: '#2B6E4A',
  positiveSoft: 'rgba(43, 110, 74, 0.10)',
  warning: '#8A5A0B',
  warningSoft: 'rgba(196, 135, 30, 0.14)',
  negative: '#B42318',
  negativeSoft: 'rgba(180, 35, 24, 0.08)',
  focus: '#2F7FA0',
  glassFill: 'rgba(255, 255, 255, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.65)',
  glassShadow: '0 8px 32px rgba(20, 20, 40, 0.10), 0 1px 0 rgba(20, 20, 40, 0.06)',
  overlay: 'rgba(15, 15, 20, 0.32)',
  chartLine: '#0F5F73',
  chartFill: 'rgba(15, 95, 115, 0.10)',
  chartGrid: 'rgba(20, 20, 30, 0.06)',
};

export const dark: ColorScheme = {
  bg: '#0C0D0F',
  bgElevated: '#121316',
  surface: '#17181B',
  surfaceMuted: '#1E1F23',
  surfacePressed: '#26272C',
  text: '#F3F3F5',
  textSecondary: '#A9A9B2',
  textTertiary: '#9898A2',
  border: 'rgba(255, 255, 255, 0.07)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  accent: '#5DB6C7',
  accentText: '#062A33',
  accentSoft: 'rgba(93, 182, 199, 0.14)',
  positive: '#6CC796',
  positiveSoft: 'rgba(108, 199, 150, 0.12)',
  warning: '#E5B05C',
  warningSoft: 'rgba(229, 176, 92, 0.14)',
  negative: '#F2847A',
  negativeSoft: 'rgba(242, 132, 122, 0.12)',
  focus: '#7CC6D4',
  glassFill: 'rgba(30, 31, 36, 0.70)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassShadow: '0 8px 32px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.04) inset',
  overlay: 'rgba(0, 0, 0, 0.55)',
  chartLine: '#5DB6C7',
  chartFill: 'rgba(93, 182, 199, 0.14)',
  chartGrid: 'rgba(255, 255, 255, 0.06)',
};

export const fontFamily = {
  sans: 'Inter',
  webStack: "'Inter Variable', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
} as const;

/** Type scale (px). Financial numbers use tabular figures everywhere. */
export const type = {
  hero: { size: 44, line: 48, weight: 600, tracking: -0.9 },
  display: { size: 34, line: 40, weight: 600, tracking: -0.6 },
  title1: { size: 26, line: 32, weight: 600, tracking: -0.4 },
  title2: { size: 20, line: 26, weight: 600, tracking: -0.2 },
  headline: { size: 16, line: 22, weight: 600, tracking: -0.1 },
  body: { size: 15, line: 22, weight: 400, tracking: 0 },
  callout: { size: 14, line: 20, weight: 400, tracking: 0 },
  footnote: { size: 13, line: 18, weight: 400, tracking: 0 },
  caption: { size: 12, line: 16, weight: 500, tracking: 0.1 },
  overline: { size: 11, line: 14, weight: 600, tracking: 0.6 },
} as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, x3: 32, x4: 40, x5: 48, x6: 64 } as const;

/** One radius scale. Cards 18, controls 12, chips 8, pills only for segmented controls/tab bar. */
export const radius = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 } as const;

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  spring: { damping: 22, stiffness: 260, mass: 1 },
} as const;

export const glass = {
  blur: 24,
  saturate: 1.8,
  /** expo-blur intensity for the same visual weight. */
  nativeIntensity: 60,
} as const;

export const layout = {
  mobileGutter: 16,
  desktopSidebar: 240,
  desktopContentMax: 1280,
  touchTarget: 44,
} as const;

export const tokens = { light, dark, fontFamily, type, space, radius, motion, glass, layout } as const;
export type Tokens = typeof tokens;
