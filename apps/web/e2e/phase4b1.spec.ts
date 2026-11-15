import { expect, test, type Page } from '@playwright/test';
import { toDashboard } from './helpers';

/**
 * Phase 4B.1 through the real UI in Chromium (production build). Wording, spacing and duplicate actions only: every
 * number on these screens is unchanged.
 */
const SHOTS = process.env.SHOTS_DIR;
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);

test('first run: short balance question with the full explanation on request; one-bill breakdown says "comes … it doesn\'t"', async ({ page }) => {
  // $2,400 checking, $1,800 every 2 weeks from Nov 22, Rent $1,200 on Dec 1; today Sun, Nov 15
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm passphrase').fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  // the question: label, the short line (as the field's description), and a collapsed disclosure
  const input = page.getByLabel('Current checking balance');
  await expect(input).toHaveAccessibleDescription('The posted balance your bank shows right now.');
  const more = page.getByRole('button', { name: 'More about this balance' });
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('balance-more')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b1-01-balance-question.png` });
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('balance-more')).toHaveText(/^Enter the posted \(cleared\) balance your bank shows right now, without pending items\. If the account is overdrawn, type a minus sign/);
  await expect(more).toHaveAttribute('aria-controls', 'balance-more');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b1-02-balance-more.png` });
  await more.click(); // collapses again
  await expect(page.getByTestId('balance-more')).toHaveCount(0);
  // the step still validates and continues as before; optional steps keep Skip
  await input.fill('2400');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  await page.getByLabel('Next payday').fill('2026-11-22');
  await page.getByLabel('Usual paycheck amount (optional)').fill('1800');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible();
  await page.getByLabel('Name').fill('Rent');
  await page.getByLabel('Amount').fill('1200');
  await page.getByLabel('Due date').fill('2026-12-01');
  await page.getByRole('button', { name: 'See my overview' }).click();
  await toDashboard(page);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,400.00');
  // Phase 4B.2: this sentence is in "Why this number?" now
  await page.getByTestId('why-sts').click();
  await expect(page.getByRole('dialog')).toContainText("Rent ($1,200.00) comes after Nov 15, once $5,400.00 has come in. Your balance stays at or above the Nov 15 low through Dec 31, so it doesn't lower Safe to Spend.");
  await page.keyboard.press('Escape');
  // the "Next after…" caption sits below the explanation with a visible gap (it used to touch it)
  const above = await page.locator('.card.sts > p.t-callout').boundingBox();
  const next = await page.getByTestId('sts-next').boundingBox();
  expect(next!.y - (above!.y + above!.height)).toBeGreaterThanOrEqual(6);
  // Home has no Add Transaction of its own in the page header; the sidebar's opens the dialog; the empty state keeps its own
  await expect(page.locator('main .page-head').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Transaction' })).toHaveCount(2); // sidebar + "Nothing recorded yet" card
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b1-03-first-dashboard.png`, fullPage: true });
  await page.locator('.sidebar-add').click();
  await expect(page.getByRole('dialog', { name: 'Add Transaction' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'Add Transaction' })).toBeVisible();
});

test('narrow window: Add Transaction stays reachable from the tab bar', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await page.getByRole('navigation', { name: 'Main (compact)' }).getByRole('button', { name: 'Add Transaction' }).click();
  await expect(page.getByRole('dialog', { name: 'Add Transaction' })).toBeVisible();
});

test('Capture: the default-account note appears once for the batch, not on each draft', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await go(page, '/capture');
  await page.getByTestId('capture-text').fill('Spent $14.50 on lunch at Panera yesterday and $60 on gas today');
  await page.getByTestId('capture-read').click();
  const drafts = page.getByTestId('draft');
  await expect(drafts).toHaveCount(2);
  await expect(page.getByTestId('capture-batch-note')).toHaveCount(1);
  await expect(page.getByTestId('capture-batch-note')).toHaveText('No account was mentioned in these 2 drafts, so Everyday Checking is used for them.');
  await expect(page.getByText(/No account was mentioned, so/)).toHaveCount(0);
  // each draft keeps its other notes and its field-source labels; nothing is saved before approval
  await expect(drafts.nth(1)).toContainText('No merchant was named; “Gas” is used as the description.');
  for (const i of [0, 1]) await expect(drafts.nth(i)).toContainText('your default');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b1-04-capture-batch.png`, fullPage: true });
  // one draft only: its own note stays on the draft
  await page.getByRole('button', { name: 'Discard all' }).click();
  await page.getByTestId('capture-text').fill('Spent $14.50 on lunch at Panera yesterday');
  await page.getByTestId('capture-read').click();
  await expect(drafts).toHaveCount(1);
  await expect(page.getByTestId('capture-batch-note')).toHaveCount(0);
  await expect(drafts.first()).toContainText('No account was mentioned, so Everyday Checking is used.');
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
});
