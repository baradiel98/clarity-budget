import { expect, test, type Page } from '@playwright/test';
import { fresh, onboard, PASS, toDashboard } from './helpers';

/** Real vault, real cryptography: nothing here is mocked. */
async function lockedVault(page: Page, opts: { recovery?: boolean } = {}) {
  await fresh(page);
  let key: string | null = null;
  if (opts.recovery === false) {
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passphrase').fill(PASS);
    await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
    await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Current checking balance').fill('500');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Next payday').fill('2026-09-12');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
  } else {
    key = await onboard(page);
  }
  await toDashboard(page);
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(page.getByRole('heading', { name: 'Unlock Clarity' })).toBeVisible();
  return key;
}

const field = (page: Page) => page.getByLabel('Passphrase', { exact: true });
const unlockBtn = (page: Page) => page.getByRole('button', { name: 'Unlock', exact: true });

test.describe('unlock screen', () => {
  test('branding, copy, forced dark theme and no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ colorScheme: 'light' });
    await lockedVault(page);
    await expect(page.locator('.auth-brand')).toHaveText('Clarity');
    await expect(page.getByText('Your financial world, securely stored on this device.')).toBeVisible();
    await expect(page.getByText('Encrypted on this device. No account, no server.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await expect(field(page)).toBeFocused();
    // the button is never shown disabled just because the field is empty
    await expect(unlockBtn(page)).toBeEnabled();
    await field(page).fill(PASS);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('month-end')).toBeVisible();
    // the user's theme setting (system) applies again after unlocking
    expect(await page.evaluate(() => document.documentElement.dataset.theme ?? null)).toBeNull();
    expect(errors).toEqual([]);
  });

  test('empty submit explains what to do without trying to unlock', async ({ page }) => {
    await lockedVault(page);
    await unlockBtn(page).click();
    await expect(page.getByRole('alert')).toHaveText('Enter your passphrase to unlock.');
    await expect(field(page)).toBeFocused();
    await expect(field(page)).toHaveAttribute('aria-invalid', 'true');
    await field(page).fill('x');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('wrong passphrase: clear error, field cleared and refocused; Enter shows a single loading state', async ({ page }) => {
    await lockedVault(page);
    // Record every state the button goes through (the key derivation is quick, so polling could miss it).
    await page.evaluate(() => {
      const w = window as unknown as { __states: string[] };
      w.__states = [];
      new MutationObserver(() => {
        const b = document.querySelector<HTMLButtonElement>('.auth-primary');
        if (b) w.__states.push(`${b.textContent?.trim()}|${b.disabled}`);
      }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    });
    await field(page).fill('not my passphrase');
    await field(page).press('Enter');
    await field(page).press('Enter'); // a repeated Enter must not start a second attempt
    await expect(page.getByRole('alert')).toHaveText('That passphrase is not correct.');
    const states = await page.evaluate(() => (window as unknown as { __states: string[] }).__states);
    expect(states).toContain('Unlocking…|true');
    await expect(field(page)).toHaveValue('');
    await expect(field(page)).toBeFocused();
    await expect(page.locator('.auth-input')).toHaveClass(/invalid/);
    await field(page).fill(PASS);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await field(page).press('Enter');
    await expect(page.getByTestId('month-end')).toBeVisible();
  });

  test('show / hide passphrase', async ({ page }) => {
    await lockedVault(page);
    await field(page).fill('secret words here');
    const eye = page.getByRole('button', { name: 'Show passphrase' });
    await expect(field(page)).toHaveAttribute('type', 'password');
    await eye.click();
    await expect(field(page)).toHaveAttribute('type', 'text');
    await expect(page.getByRole('button', { name: 'Hide passphrase' })).toHaveAttribute('aria-pressed', 'true');
    await expect(field(page)).toHaveAttribute('autocapitalize', 'none');
    await expect(field(page)).toHaveAttribute('spellcheck', 'false');
    await page.getByRole('button', { name: 'Hide passphrase' }).click();
    await expect(field(page)).toHaveAttribute('type', 'password');
    await expect(field(page)).toHaveValue('secret words here');
  });

  test('keyboard order: field → show → Unlock → recovery key → help', async ({ page }) => {
    await lockedVault(page);
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show passphrase' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(unlockBtn(page)).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Use recovery key instead' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Forgot your passphrase?' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: "Can't unlock Clarity?" })).toBeVisible();
  });

  test('recovery key: wrong key is rejected, the right one unlocks', async ({ page }) => {
    const key = (await lockedVault(page))!;
    await page.getByRole('button', { name: 'Use recovery key instead' }).click();
    await expect(page.getByRole('heading', { name: 'Use your recovery key' })).toBeVisible();
    const rk = page.getByLabel('Recovery key', { exact: true });
    await expect(rk).toBeFocused();
    await rk.fill('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA');
    await rk.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('That recovery key does not match.');
    await page.getByRole('button', { name: 'Use passphrase instead' }).click();
    await expect(field(page)).toBeFocused();
    await page.getByRole('button', { name: 'Use recovery key instead' }).click();
    await page.getByLabel('Recovery key', { exact: true }).fill(key.toLowerCase().replaceAll('-', ''));
    await page.getByLabel('Recovery key', { exact: true }).press('Enter');
    await expect(page.getByTestId('month-end')).toBeVisible();
  });

  test('help explains the options; cancelling erase keeps the data', async ({ page }) => {
    await lockedVault(page);
    await page.getByRole('button', { name: 'Forgot your passphrase?' }).click();
    const panel = page.locator('.auth-panel');
    await expect(panel).toContainText('no password reset');
    await expect(panel).toContainText("can't be decrypted by you, by us, or by anyone");
    await panel.getByRole('button', { name: 'Use recovery key' }).click();
    await expect(page.getByRole('heading', { name: 'Use your recovery key' })).toBeVisible();
    await page.getByRole('button', { name: 'Use passphrase instead' }).click();
    await page.getByRole('button', { name: 'Forgot your passphrase?' }).click();
    await page.getByRole('button', { name: 'Erase data on this device…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('cannot be decrypted by anyone');
    await expect(dialog.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Back to unlock' }).click();
    await field(page).fill(PASS);
    await field(page).press('Enter');
    await expect(page.getByTestId('month-end')).toBeVisible();
  });

  test('erase from help, after typing DELETE, returns to the welcome screen', async ({ page }) => {
    await lockedVault(page);
    await page.getByRole('button', { name: 'Forgot your passphrase?' }).click();
    await page.getByRole('button', { name: 'Erase data on this device…' }).click();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByRole('button', { name: 'Restore a backup' })).toBeVisible();
  });

  test('without a recovery key, the screen does not offer one', async ({ page }) => {
    await lockedVault(page, { recovery: false });
    await expect(page.getByRole('button', { name: 'Use recovery key instead' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Forgot your passphrase?' }).click();
    await expect(page.locator('.auth-panel')).toContainText('No recovery key was set up for the data on this device');
    await expect(page.getByRole('button', { name: 'Use recovery key' })).toHaveCount(0);
  });

  test('phone: fits without horizontal scroll and Unlock stays above the keyboard area', async ({ page }) => {
    await lockedVault(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    // Every view fits a 390px screen with 16px side margins (panel 358px), with no horizontal scroll.
    const fits = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      expect(Math.round((await page.locator('.auth-panel').boundingBox())!.width)).toBe(358);
    };
    await fits();
    const box = (await unlockBtn(page).boundingBox())!;
    // An iPhone keyboard covers roughly the bottom 340px of an 844px screen.
    expect(box.y + box.height).toBeLessThan(844 - 340);
    expect(box.x).toBeGreaterThanOrEqual(16);
    await page.getByRole('button', { name: 'Use recovery key instead' }).click();
    await fits();
    await page.getByRole('button', { name: 'Forgot your passphrase?' }).click();
    await fits();
  });
});
