import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4B.4 through the real UI in Chromium (production build, sample data). Past-due items: one line on Home, the
 * catch-up review in Planning, resolved one occurrence at a time with the existing Mark paid / Record (which can link
 * an existing payment) and Skip. Nothing is assumed paid or skipped.
 */
const SHOTS = process.env.SHOTS_DIR;
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function sample(page: Page, at: string, width = 1440) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  if (at !== '2026-11-13') {
    await page.clock.setFixedTime(new Date(`${at}T10:00:00`));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }
}
const rows = (page: Page) => page.getByTestId('catch-up-row');

test('one past-due bill: one line on Home, reviewed in Planning, Mark paid → all caught up; Safe to Spend unchanged by paying what was counted', async ({ page }) => {
  await sample(page, '2026-11-19'); // Electricity (≈$91.40) was due Wed, Nov 18
  const pd = page.getByTestId('past-due');
  await expect(pd).toContainText('Past due');
  await expect(page.getByTestId('past-due-summary')).toHaveText('Electricity, due Wed, Nov 18, needs a decision');
  await expect(page.getByTestId('upcoming')).not.toContainText('Electricity');
  await expect(page.locator('main')).not.toContainText('Electricity is overdue');
  const sts = await page.getByTestId('safe-to-spend').innerText();
  // keyboard: Review opens Planning's catch-up
  await page.getByTestId('past-due-review').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /^Catch up · 1 past due$/ })).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Wed, Nov 18');
  await expect(rows(page).first()).toContainText('≈−$91.40');
  await page.getByRole('button', { name: 'Mark paid: Electricity, due Nov 18' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByTestId('mark-paid-scheduled')).toContainText('Electricity · due Nov 18');
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('catch-up-done')).toHaveText('All caught up. Nothing is past due.');
  await go(page, '/');
  await expect(page.getByTestId('past-due')).toHaveCount(0);
  // the $91.40 was counted as owed today; now it is recorded as paid today: the same $91.40, counted once
  await expect(page.getByTestId('safe-to-spend')).toHaveText(sts);
});

test('returning weeks later (Jan 10, 2027): 16 items in one line on Home; Planning groups them; link an existing payment, skip one; later occurrences untouched', async ({ page }) => {
  await sample(page, '2027-01-10');
  await expect(page.getByTestId('past-due-summary')).toHaveText('16 items since Nov 18 need a decision');
  // Upcoming now starts with what is still ahead
  await expect(page.getByTestId('upcoming').locator('.up-row').first()).toContainText('Thu, Jan 14');
  await expect(page.getByTestId('upcoming')).not.toContainText('Overdue');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b4-01-home-past-due.png`, fullPage: false });
  // a $1,450 rent payment recorded on Jan 8, not linked to anything
  await page.keyboard.press('n');
  let d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('1450');
  await d.getByTestId('merchant').fill('OAKWOOD RENT');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('Date').fill('2027-01-08');
  const strong = d.getByRole('checkbox', { name: /won't be counted again in your forecast/ });
  if (await strong.count()) await strong.uncheck(); // leave it unlinked: the review must not assume
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Safe to Spend now, with the payment recorded but not linked (the Jan 1 rent is still counted as owed today)
  const sts = await page.getByTestId('safe-to-spend').innerText();
  await go(page, '/planning');
  const card = page.getByTestId('catch-up');
  await expect(page.getByRole('heading', { name: /^Catch up · 16 past due$/ })).toBeVisible();
  const names = await page.getByTestId('catch-up-group').locator('h3').allInnerTexts();
  expect(names).toEqual(['Electricity · 2 past due', 'Paycheck · 4 past due', 'Phone · 2 past due', 'Card payment · 2 past due', 'Savings · 2 past due', 'Rent · 2 past due', 'Streaming · 2 past due']);
  await expect(card).toContainText('Not recorded');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b4-02-catch-up-1440.png`, fullPage: false });
  // Rent due Jan 1: Mark paid offers the Jan 8 payment; linking it adds nothing
  await page.getByRole('button', { name: 'Mark paid: Rent, due Jan 1' }).click();
  d = page.getByRole('dialog');
  await d.getByLabel(/^Jan 8 · OAKWOOD RENT · −\$1,450\.00 · Everyday Checking · posted/).check();
  await expect(d.getByTestId('save-tx')).toContainText('Link transaction');
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /^Catch up · 15 past due$/ })).toBeVisible();
  await expect(page.getByTestId('catch-up-group').filter({ hasText: 'Rent' }).locator('h3')).toHaveText('Rent');
  await expect(page.getByRole('button', { name: 'Mark paid: Rent, due Dec 1' })).toBeVisible(); // December's rent is its own decision
  // linking the Jan 8 payment stops the Jan 1 rent also being counted as owed today: Safe to Spend rises by exactly $1,450.00
  const n = (s: string) => (s.startsWith('Short by') ? -1 : 1) * Number(s.replace(/[^0-9.]/g, ''));
  await go(page, '/');
  await expect.poll(async () => Math.round((n(await page.getByTestId('safe-to-spend').innerText()) - n(sts)) * 100)).toBe(145000);
  await go(page, '/planning');
  // Skip Streaming due Dec 9 (explicit); Streaming Jan 9 stays
  await page.getByRole('button', { name: 'Skip: Streaming, due Dec 9' }).click();
  await expect(page.getByRole('heading', { name: /^Catch up · 14 past due$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip: Streaming, due Jan 9' })).toBeVisible();
  // the Rent payment was linked, not duplicated
  await go(page, '/transactions');
  await expect(page.locator('table.data tbody tr').filter({ hasText: 'OAKWOOD RENT' })).toHaveCount(1);
  await go(page, '/');
  await expect(page.getByTestId('past-due-summary')).toHaveText('14 items since Nov 18 need a decision');
});

test('390px: Home line and the catch-up review stack cleanly; nothing past due shows neither', async ({ page }) => {
  await sample(page, '2027-01-10', 390);
  await expect(page.getByTestId('past-due')).toBeVisible();
  await page.getByTestId('past-due').scrollIntoViewIfNeeded();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b4-03-home-390.png`, fullPage: false });
  await page.getByTestId('past-due-review').click();
  await expect(page.getByTestId('catch-up')).toBeVisible();
  await page.getByTestId('catch-up').scrollIntoViewIfNeeded();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b4-04-catch-up-390.png`, fullPage: false });
  const box = await rows(page).first().boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  // Nov 13 (nothing past due): no line on Home, no review in Planning
  const p2 = await page.context().newPage();
  await sample(p2, '2026-11-13', 390);
  await expect(p2.getByTestId('past-due')).toHaveCount(0);
  await go(p2, '/planning');
  await expect(p2.getByTestId('catch-up')).toHaveCount(0);
});
