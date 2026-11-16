import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 5A.3 through the real UI in Chromium (production build). F1: the keyboard row in Transactions takes real focus
 * and shows a ring of at least 3:1 against the row (light and dark). F2: with a single account, Planning shows that
 * account's own view (no chooser) and today's Day details starts from the confirmed balance.
 */
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function sample(page: Page, width = 1440, scheme: 'light' | 'dark' = 'light') {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
/** WCAG contrast of the focused row's ring against the row's own background (composited over the table card). */
const ringContrast = (page: Page) => page.evaluate(() => {
  const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
  const td = document.activeElement!.querySelector('td')!;
  const ring = parse(getComputedStyle(td).boxShadow.match(/rgba?\([^)]*\)/)![0]);
  let el: Element | null = td.closest('table'); let base = [255, 255, 255];
  while (el) { const c = parse(getComputedStyle(el).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0) { base = c.slice(0, 3); break; } el = el.parentElement; }
  const bg = parse(getComputedStyle(td).backgroundColor); const a = bg[3] ?? 1;
  const row = [0, 1, 2].map((i) => Math.round(bg[i]! * a + base[i]! * (1 - a)));
  const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
  const [l1, l2] = [lum(ring), lum(row)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`F1 (${scheme}): ↓ moves real focus to the row, with a visible ring of at least 3:1; E edits that row`, async ({ page }) => {
    await sample(page, 1440, scheme);
    await go(page, '/transactions');
    await page.getByRole('heading', { name: 'Transactions' }).click();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    const focused = page.locator('table.data tbody tr:focus');
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveClass(/cursor/);
    expect(await focused.evaluate((r) => r.matches(':focus-visible'))).toBe(true);
    expect(await focused.getAttribute('aria-selected')).toBeNull(); // not valid on a plain table row; the checkbox says "selected"
    const contrast = await ringContrast(page);
    expect(contrast).toBeGreaterThanOrEqual(3);
    const name = (await focused.locator('.btn-link').innerText()).trim();
    await page.keyboard.press('e');
    await expect(page.getByRole('dialog').getByTestId('merchant')).toHaveValue(new RegExp(name.slice(0, 6)));
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

test('F1 (phone width): ↓ focuses the row button, which has its own visible focus ring', async ({ page }) => {
  await sample(page, 390);
  await go(page, '/transactions');
  await page.getByRole('heading', { name: 'Transactions' }).click();
  await page.keyboard.press('ArrowDown');
  const active = await page.evaluate(() => ({ cls: document.activeElement?.className, row: document.activeElement?.closest('[data-row]')?.tagName, outline: getComputedStyle(document.activeElement!).outlineStyle }));
  expect(active).toEqual({ cls: 'tx-main', row: 'LI', outline: 'solid' });
});

test('F2: one account: no chooser, the account view is shown, today starts from the confirmed balance', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-16T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm passphrase').fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Current checking balance').fill('1200');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('radio', { name: 'Every 2 weeks' }).check();
  await page.getByLabel('Next payday').fill('2026-11-25');
  await page.getByLabel(/Usual paycheck amount/).fill('1800');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Name').fill('Rent'); await page.getByLabel('Amount').fill('1400'); await page.getByLabel('Due date').fill('2026-11-26');
  await page.getByRole('button', { name: 'See my overview' }).click();
  await page.getByTestId('go-dashboard').click();
  // $1,200.00 + $1,800.00 − $1,400.00 = $1,600.00 at month-end
  await expect(page.getByTestId('month-end')).toHaveText('$1,600.00');
  await go(page, '/planning');
  await expect(page.getByTestId('ledger-scope')).toHaveCount(0);
  // the same day figures as all spendable cash: Nov 25 $3,000.00, Nov 26 $1,600.00
  await expect(page.locator('.tl-day').filter({ hasText: 'Thu, Nov 26' }).getByTestId('tl-day-end')).toContainText('$1,600.00');
  // Update balance (exact match), then a purchase: today's Day details starts from the confirmed figure
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Update balance of Checking' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Posted balance per bank').fill('1200');
  await d.getByRole('button', { name: 'Confirm balance' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.clock.setFixedTime(new Date('2026-11-16T10:05:00')); // the purchase is recorded after confirming
  await page.keyboard.press('n');
  const a = page.getByRole('dialog');
  await a.getByTestId('amount').fill('10'); await a.getByTestId('merchant').fill('QA coffee');
  await a.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/planning');
  await page.getByRole('button', { name: 'Day details: Mon, Nov 16, Checking' }).click();
  const lines = page.getByRole('dialog').locator('.explain-line');
  await expect(lines.first()).toContainText('Confirmed balance (Nov 16)');
  await expect(lines.first()).toContainText('$1,200.00');
  const qa = lines.filter({ hasText: 'QA coffee' });
  await expect(qa).toContainText('recorded after you confirmed the balance');
  await expect(qa.getByTestId('balance-after')).toContainText('$1,190.00');
  await expect(lines.filter({ hasText: 'End of day' })).toContainText('$1,190.00');
});
