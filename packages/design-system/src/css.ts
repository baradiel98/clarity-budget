import { categorical, dark, light, radius, space, type ColorScheme, fontFamily, motion, glass } from './tokens';

const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const colors = (c: ColorScheme, indent: string, cats: readonly string[] = c === dark ? categorical.dark : categorical.light) =>
  [...Object.entries(c).map(([k, v]) => `${indent}--c-${kebab(k)}: ${v};`), ...cats.map((v, i) => `${indent}--cat-${i + 1}: ${v};`)].join('\n');

/**
 * CSS custom properties for the web app. Light by default; dark under
 * prefers-color-scheme (unless data-theme="light") and under data-theme="dark".
 */
export function tokensCss(): string {
  const scalars = [
    ...Object.entries(space).map(([k, v]) => `  --space-${k}: ${v}px;`),
    ...Object.entries(radius).map(([k, v]) => `  --radius-${k}: ${v}px;`),
    `  --font-sans: ${fontFamily.webStack};`,
    `  --motion-fast: ${motion.fast}ms;`,
    `  --motion-base: ${motion.base}ms;`,
    `  --motion-slow: ${motion.slow}ms;`,
    `  --ease: ${motion.easing};`,
    `  --ease-out: ${motion.easeOut};`,
    `  --ease-in: ${motion.easeIn};`,
    `  --motion-instant: ${motion.instant}ms;`,
    `  --motion-chart: ${motion.chart}ms;`,
    `  --motion-stagger: ${motion.stagger}ms;`,
    `  --glass-blur: ${glass.blur}px;`,
    `  --glass-saturate: ${glass.saturate};`,
  ].join('\n');
  return `/* Generated from packages/design-system/src/tokens.ts — run \`npm run tokens\`. Do not edit. */
:root {
${scalars}
${colors(light, '  ')}
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
${colors(dark, '    ')}
    color-scheme: dark;
  }
}
:root[data-theme='dark'] {
${colors(dark, '  ')}
  color-scheme: dark;
}
`;
}
