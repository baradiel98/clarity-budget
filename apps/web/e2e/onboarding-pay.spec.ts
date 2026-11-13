import { expect, test } from '@playwright/test';
import { fresh, PASS, toDashboard } from './helpers';

async function toPayStep(page: import('@playwright/test').Page) {
  await fresh(page);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm passphrase').fill(PASS);
  await page.getByRole('button', { name: 'Continue' }).click();
  const key = (await page.getByTestId('recovery-key').textContent())!;
  await page.getByLabel(/type the last group/).fill(key.split('-').pop()!);
  await page.getByRole('button', { name: "I've saved it" }).click();
  await page.getByLabel('Current checking balance').fill('1200');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'When do you get paid?' })).toBeVisible();
}

test.describe('pay schedule step', () => {
  test('shared account: two paychecks with different schedules are both counted', async ({ page }) => {
    await toPayStep(page);
    await page.getByLabel('Next payday').fill('2026-09-12');
    await expect(page.getByTestId('pay-preview')).toHaveText(/Sat, Sep 12 · Sat, Sep 26 · Sat, Oct 10/);
    await page.getByLabel('Usual paycheck amount (optional)').fill('1800');

    await page.getByRole('button', { name: 'Add another paycheck' }).click();
    const second = page.getByRole('group', { name: 'Paycheck 2' });
    await second.getByLabel('Name').fill("Partner's paycheck");
    const partner = page.getByRole('group', { name: "Partner's paycheck" });
    await partner.getByRole('radio', { name: 'Twice a month' }).check();
    await partner.getByRole('radio', { name: '1st and 15th' }).check();
    await expect(partner.getByTestId('pay-preview')).toHaveText(/Tue, Sep 15 · Thu, Oct 1 · Thu, Oct 15/);
    await partner.getByLabel('Usual paycheck amount (optional)').fill('2000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();

    // Sep 3 → Sep 30: 1,200 + 1,800 (Sep 12) + 2,000 (Sep 15) + 1,800 (Sep 26) = 6,800
    await expect(page.getByTestId('overview-month-end')).toHaveText('$6,800.00');
    await toDashboard(page);
    await page.getByRole('link', { name: /Planning/ }).first().click();
    await expect(page.getByText("Partner's paycheck").first()).toBeVisible();
    await expect(page.getByText('Paycheck', { exact: true }).first()).toBeVisible();
  });

  test('each paycheck is validated on its own; a removed one is not saved', async ({ page }) => {
    await toPayStep(page);
    await page.getByRole('button', { name: 'Add another paycheck' }).click();
    const second = page.getByRole('group', { name: 'Paycheck 2' });
    await second.getByLabel('Name').fill('');
    await second.getByLabel('Usual paycheck amount (optional)').fill('0');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Give this paycheck a name.')).toBeVisible();
    await expect(page.getByText('Enter an amount, or choose “It varies”.')).toBeVisible();
    await page.getByRole('button', { name: /Remove/ }).last().click();
    await expect(page.getByRole('group', { name: /Paycheck 2/ })).toHaveCount(0);
    await page.getByLabel('Usual paycheck amount (optional)').fill('1000');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { name: 'Any big bill coming up?' })).toBeVisible();
  });

  test('irregular pay: no dates, no assumed income; no horizontal scroll on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await toPayStep(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.getByRole('radio', { name: 'Irregular' }).check();
    await expect(page.getByLabel('Next payday')).toHaveCount(0);
    await expect(page.getByText("Clarity won't assume this income")).toBeVisible();
    await page.getByRole('button', { name: 'Add another paycheck' }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});
