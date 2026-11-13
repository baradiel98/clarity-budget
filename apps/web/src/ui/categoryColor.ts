import type { Category } from '@clarity/shared';

/** Stable muted hue per category (by position), from the design tokens. Always shown next to the category name. */
export function categoryColors(categories: readonly Category[]): Map<string, string> {
  const m = new Map<string, string>();
  let i = 0;
  for (const c of categories) {
    if (c.kind !== 'expense') continue;
    m.set(c.id, `var(--cat-${(i % 8) + 1})`);
    i++;
  }
  return m;
}
