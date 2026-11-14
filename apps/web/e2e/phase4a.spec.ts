import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A: the rent entered during onboarding (due Dec 1) is counted in Safe to Spend and can be found
 * on every screen that relies on it. Today is Fri, Nov 13, 2026.
 */
async function onboardWithRent(page: Page, opts: { pay?: string } = {}) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm passphrase').fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Current checking balance').fill('1850.25');
  await page.getByRole('button', { name: 'Continue' }).click();
  if (opts.pay) {
    await page.getByLabel('Next payday').fill('2026-11-20');
    await page.getByLabel('Usual paycheck amount (optional)').fill(opts.pay);
    await page.getByRole('button', { name: 'Continue' }).click();
  } else {
    await page.getByRole('button', { name: 'Skip' }).click();
  }
  await page.getByLabel('Name').fill('Rent');
  await page.getByLabel('Amount').fill('1400');
  await page.getByLabel('Due date').fill('2026-12-01');
  await page.getByRole('button', { name: 'See my overview' }).click();
}

test.describe('Phase 4A: Safe to Spend counts the rent due Dec 1, and the user can see it', () => {
  test('no income: Safe to Spend leaves the rent ($450.25), and every screen shows why', async ({ page }) => {
    await onboardWithRent(page);
    // first overview
    const counted = page.getByTestId('overview-counted');
    await expect(counted).toContainText('Counted in Safe to Spend through Dec 31');
    await expect(counted).toContainText('Dec 1Rent−$1,400.00');
    await page.getByTestId('go-dashboard').click();
    // dashboard
    await expect(page.getByTestId('safe-to-spend')).toHaveText('$450.25');
    await expect(page.getByTestId('upcoming-none')).toHaveText('Nothing scheduled through Nov 30.');
    const later = page.getByTestId('upcoming-later');
    await expect(later).toContainText('Later · also counted in Safe to Spend');
    await expect(later.locator('li').first()).toHaveText('Dec 1Rent−$1,400.00');
    await expect(later).toContainText('Safe to Spend looks through Dec 31.');
    // why this number
    await page.getByTestId('why-sts').click();
    const why = page.getByRole('dialog');
    await expect(why).toContainText('through the end of next month (Dec 31)');
    await expect(why).toContainText('Rent');
    await expect(why).toContainText('Anything scheduled after Dec 31 is not included.'); // Phase 4A.2 wording
    await page.keyboard.press('Escape');
    // Planning
    await later.getByRole('button', { name: 'See all in Planning' }).click();
    await expect(page.getByRole('heading', { name: 'Through Dec 31' })).toBeVisible();
    await expect(page.getByTestId('timeline')).toContainText('Tue, Dec 1');
    await expect(page.getByTestId('timeline')).toContainText('Rent');
  });

  test('paid $2,100 on Nov 20 (before the rent): the paycheck covers it, and the rent is still listed', async ({ page }) => {
    await onboardWithRent(page, { pay: '2100' });
    await expect(page.getByTestId('overview-counted')).toContainText('Dec 1Rent−$1,400.00');
    await page.getByTestId('go-dashboard').click();
    await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,850.25');
    const later = page.getByTestId('upcoming-later');
    await expect(later.locator('li')).toHaveText(['Dec 1Rent−$1,400.00', 'Dec 4Paycheck+$2,100.00', 'Dec 18Paycheck+$2,100.00']);
    await page.getByTestId('why-sts').click();
    await expect(page.getByRole('dialog')).toContainText('Rent');
    await expect(page.getByRole('dialog')).toContainText("after the lowest point, doesn't lower it");
  });
});
