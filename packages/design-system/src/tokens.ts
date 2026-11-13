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
  chartNeutral: string;
  shadowSm: string;
  shadowMd: string;
}

export const light: ColorScheme = {
  bg: '#F6F5F2',
  bgElevated: '#FBFAF8',
  surface: '#FFFFFF',
  surfaceMuted: '#F1EFEB',
  surfacePressed: '#E7E4DF',
  text: '#1A1917',
  textSecondary: '#57544E',
  textTertiary: '#66635C',
  border: 'rgba(26, 25, 23, 0.08)',
  borderStrong: 'rgba(26, 25, 23, 0.16)',
  accent: '#0A5A63',
  accentText: '#FFFFFF',
  accentSoft: 'rgba(10, 90, 99, 0.08)',
  positive: '#1E6A45',
  positiveSoft: 'rgba(30, 106, 69, 0.10)',
  warning: '#85560A',
  warningSoft: 'rgba(190, 130, 30, 0.14)',
  negative: '#B3261E',
  negativeSoft: 'rgba(179, 38, 30, 0.08)',
  focus: '#2C7F8C',
  glassFill: 'rgba(250, 249, 246, 0.74)',
  glassBorder: 'rgba(255, 255, 255, 0.7)',
  glassShadow: '0 10px 40px rgba(26, 25, 23, 0.10), 0 1px 2px rgba(26, 25, 23, 0.06)',
  overlay: 'rgba(20, 19, 17, 0.36)',
  chartLine: '#0A5A63',
  chartFill: 'rgba(10, 90, 99, 0.10)',
  chartGrid: 'rgba(26, 25, 23, 0.07)',
  chartNeutral: '#8E8A81',
  shadowSm: '0 1px 2px rgba(26, 25, 23, 0.05)',
  shadowMd: '0 1px 2px rgba(26, 25, 23, 0.04), 0 8px 24px rgba(26, 25, 23, 0.06)',
};

export const dark: ColorScheme = {
  bg: '#0D0D0C',
  bgElevated: '#131312',
  surface: '#181817',
  surfaceMuted: '#201F1D',
  surfacePressed: '#2A2927',
  text: '#F4F3EF',
  textSecondary: '#ABA89F',
  textTertiary: '#98958C',
  border: 'rgba(255, 252, 245, 0.08)',
  borderStrong: 'rgba(255, 252, 245, 0.15)',
  accent: '#6CC5CB',
  accentText: '#06292D',
  accentSoft: 'rgba(108, 197, 203, 0.12)',
  positive: '#6FCB9B',
  positiveSoft: 'rgba(111, 203, 155, 0.12)',
  warning: '#E6B566',
  warningSoft: 'rgba(230, 181, 102, 0.13)',
  negative: '#F28B82',
  negativeSoft: 'rgba(242, 139, 130, 0.12)',
  focus: '#86D2D7',
  glassFill: 'rgba(28, 28, 26, 0.72)',
  glassBorder: 'rgba(255, 252, 245, 0.09)',
  glassShadow: '0 10px 40px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(255, 252, 245, 0.04) inset',
  overlay: 'rgba(0, 0, 0, 0.6)',
  chartLine: '#6CC5CB',
  chartFill: 'rgba(108, 197, 203, 0.14)',
  chartGrid: 'rgba(255, 252, 245, 0.07)',
  chartNeutral: '#7C7971',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  shadowMd: '0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px rgba(0, 0, 0, 0.28)',
};

export const fontFamily = {
  sans: 'Inter',
  /** San Francisco on Apple devices; self-hosted Inter everywhere else. */
  webStack: "-apple-system, BlinkMacSystemFont, 'Inter Variable', 'Inter', 'Segoe UI', Roboto, sans-serif",
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
export const radius = { sm: 8, md: 10, lg: 16, xl: 22, pill: 999 } as const;

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

/** Muted categorical hues for category dots and charts (never the only cue: always paired with a label). */
export const categorical = {
  light: ['#0A5A63', '#A8662F', '#55699F', '#84568F', '#3B7F62', '#A84F5A', '#6F7434', '#497596'],
  dark: ['#6CC5CB', '#E0A26E', '#98A8E6', '#C89BD8', '#7FCBA9', '#E8929B', '#BCC077', '#8FBADE'],
} as const;

export const tokens = { light, dark, fontFamily, type, space, radius, motion, glass, layout } as const;
export type Tokens = typeof tokens;
