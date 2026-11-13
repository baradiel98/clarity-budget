/**
 * Clarity design tokens — the single source for both apps.
 * Web consumes the generated CSS variables (apps/web/src/styles/tokens.css);
 * mobile imports these objects directly into StyleSheets.
 *
 * Principles: cool blue-tinted neutrals, navy text, one blue accent, semantic colors used sparingly,
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
  /** Fills only (bars, markers), never text: brighter than `positive`. */
  chartPositive: string;
  shadowSm: string;
  shadowMd: string;
}

export const light: ColorScheme = {
  bg: '#F2F6FC',
  bgElevated: '#F8FAFE',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF3FA',
  surfacePressed: '#E2E9F4',
  text: '#12263F',
  textSecondary: '#4A5C75',
  textTertiary: '#56677F',
  border: 'rgba(18, 38, 63, 0.08)',
  borderStrong: 'rgba(18, 38, 63, 0.15)',
  accent: '#2559DB',
  accentText: '#FFFFFF',
  accentSoft: 'rgba(37, 89, 219, 0.08)',
  positive: '#0E7A45',
  positiveSoft: 'rgba(14, 160, 90, 0.10)',
  warning: '#B04A07',
  warningSoft: 'rgba(234, 120, 20, 0.12)',
  negative: '#CC2A22',
  negativeSoft: 'rgba(225, 45, 35, 0.08)',
  focus: '#3B7BF6',
  glassFill: 'rgba(248, 251, 255, 0.72)',
  glassBorder: 'rgba(255, 255, 255, 0.8)',
  glassShadow: '0 12px 40px rgba(30, 70, 140, 0.12), 0 1px 3px rgba(18, 38, 63, 0.06)',
  overlay: 'rgba(12, 24, 44, 0.32)',
  chartLine: '#2559DB',
  chartFill: 'rgba(59, 123, 246, 0.14)',
  chartGrid: 'rgba(18, 38, 63, 0.07)',
  chartNeutral: '#94A3B8',
  chartPositive: '#1FAF62',
  shadowSm: '0 1px 2px rgba(18, 38, 63, 0.04), 0 2px 10px rgba(40, 90, 180, 0.04)',
  shadowMd: '0 1px 3px rgba(18, 38, 63, 0.05), 0 10px 30px rgba(40, 90, 180, 0.08)',
};

export const dark: ColorScheme = {
  bg: '#0A0F19',
  bgElevated: '#0E1420',
  surface: '#131A27',
  surfaceMuted: '#1A2232',
  surfacePressed: '#232D40',
  text: '#EEF3FB',
  textSecondary: '#A6B3C8',
  textTertiary: '#8F9DB4',
  border: 'rgba(200, 220, 255, 0.08)',
  borderStrong: 'rgba(200, 220, 255, 0.15)',
  accent: '#79A6FF',
  accentText: '#06173A',
  accentSoft: 'rgba(121, 166, 255, 0.13)',
  positive: '#4FD394',
  positiveSoft: 'rgba(79, 211, 148, 0.12)',
  warning: '#F6B35C',
  warningSoft: 'rgba(246, 179, 92, 0.13)',
  negative: '#FF8A80',
  negativeSoft: 'rgba(255, 138, 128, 0.12)',
  focus: '#8FB5FF',
  glassFill: 'rgba(19, 26, 39, 0.72)',
  glassBorder: 'rgba(200, 220, 255, 0.09)',
  glassShadow: '0 12px 40px rgba(0, 0, 0, 0.5), 0 1px 0 rgba(200, 220, 255, 0.04) inset',
  overlay: 'rgba(2, 6, 14, 0.6)',
  chartLine: '#79A6FF',
  chartFill: 'rgba(121, 166, 255, 0.16)',
  chartGrid: 'rgba(200, 220, 255, 0.07)',
  chartNeutral: '#6B7A92',
  chartPositive: '#4FD394',
  shadowSm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  shadowMd: '0 1px 2px rgba(0, 0, 0, 0.3), 0 10px 30px rgba(0, 0, 0, 0.32)',
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

/** One radius scale. Cards 20, sheets 26, inputs 12, chips 8; buttons and segmented controls are pills. */
export const radius = { sm: 8, md: 12, lg: 20, xl: 26, pill: 999 } as const;

/**
 * Motion. Short and calm: most feedback is `fast`, things that appear use `base`,
 * larger surfaces `slow`, charts drawing in `chart`. Movement is small (4–8px), never bouncy.
 * Exits are quicker than entrances. Everything collapses to instant with reduced motion.
 */
export const motion = {
  instant: 80, // press feedback
  fast: 140, // hover, focus, small state changes, exits
  base: 220, // things appearing: menus, tooltips, values changing
  slow: 320, // dialogs, sheets, pages
  chart: 700, // charts drawing in, progress filling
  stagger: 45, // delay between sections appearing together
  easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', // standard: state changes
  easeOut: 'cubic-bezier(0.16, 1, 0.3, 1)', // entrances: quick start, soft landing
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)', // exits
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

/** Clean, saturated categorical hues for category dots and charts (never the only cue: always paired with a label). */
export const categorical = {
  light: ['#2F6BF0', '#D9307A', '#0D9488', '#7C4DEB', '#E0640F', '#18A04C', '#0B8FC4', '#E11D48'],
  dark: ['#79A6FF', '#F472B6', '#2DD4BF', '#A78BFA', '#FB923C', '#4ADE80', '#38BDF8', '#FB7185'],
} as const;

export const tokens = { light, dark, fontFamily, type, space, radius, motion, glass, layout } as const;
export type Tokens = typeof tokens;
