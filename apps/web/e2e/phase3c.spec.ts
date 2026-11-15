import { expect, test, type Page } from '@playwright/test';

async function sample(page: Page, width: number, height = 900, scheme: 'dark' | 'light' = 'dark') {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
  await page.setViewportSize({ width, height });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('month-end')).toBeVisible();
}
async function emptyWorkspace(page: Page, scheme: 'dark' | 'light') {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: scheme });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm passphrase').fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Current checking balance').fill('0');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByTestId('go-dashboard').click();
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);

/** WCAG contrast of an element's text against its (solid) background colour. */
const contrastOf = (page: Page, sel: string) => page.locator(sel).first().evaluate((el) => {
  const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number);
  const lum = (c: number[]) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!); };
  const cs = getComputedStyle(el); const a = lum(rgb(cs.color)), b = lum(rgb(cs.backgroundColor));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
});

test.describe('1. destructive button contrast', () => {
  for (const scheme of ['dark', 'light'] as const) {
    test(`${scheme}: "Delete all data" meets 4.5:1`, async ({ page }) => {
      await emptyWorkspace(page, scheme);
      await go(page, '/settings');
      const btn = page.locator('#data .btn-danger');
      await expect(btn).toBeEnabled();
      expect(await contrastOf(page, '#data .btn-danger')).toBeGreaterThanOrEqual(4.5);
    });
  }
});

test.describe('2. dialogs return focus to the control that opened them', () => {
  test('desktop: Add Transaction (Escape and Cancel), Why this number?', async ({ page }) => {
    await sample(page, 1280);
    const add = page.locator('.sidebar-add', { hasText: 'Add Transaction' });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Add Transaction' })).toBeVisible();
    await expect(page.getByTestId('amount')).toBeFocused(); // the dialog still starts in its first field
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(add).toBeFocused();
    await add.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(add).toBeFocused();
    const why = page.getByTestId('why-sts');
    await why.click();
    await page.keyboard.press('Escape');
    await expect(why).toBeFocused();
  });
  test('phone: Add Transaction from the tab bar', async ({ page }) => {
    await sample(page, 390, 844);
    const add = page.getByRole('navigation', { name: 'Main (compact)' }).getByRole('button', { name: 'Add Transaction' });
    await add.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(add).toBeFocused();
  });
});

test.describe('3. Planning actions menu works from the keyboard', () => {
  for (const w of [1280, 390]) {
    test(`${w}px`, async ({ page }) => {
      await sample(page, w);
      await go(page, '/planning');
      const trigger = page.getByRole('button', { name: 'Actions for Electricity' }).first();
      await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
      await trigger.focus();
      await page.keyboard.press('Enter');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(menu).toHaveAccessibleName('Actions for Electricity');
      const items = menu.getByRole('menuitem');
      await expect(items).toHaveText(['Mark paid', 'Skip this one', 'Move date', 'Change amount']);
      await expect(items.nth(0)).toBeFocused();
      await page.keyboard.press('ArrowDown'); await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press('End'); await expect(items.nth(3)).toBeFocused();
      await page.keyboard.press('ArrowDown'); await expect(items.nth(0)).toBeFocused(); // wraps
      await page.keyboard.press('ArrowUp'); await expect(items.nth(3)).toBeFocused();
      await page.keyboard.press('Home'); await expect(items.nth(0)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      // Tab closes it; a click outside closes it
      await page.keyboard.press('Enter'); await expect(menu).toBeVisible();
      await page.keyboard.press('Tab'); await expect(menu).toHaveCount(0);
      await trigger.click(); await expect(menu).toBeVisible();
      await page.locator('h1').click(); await expect(menu).toHaveCount(0);
      // choosing an item opens its dialog; closing that dialog returns to the ··· button
      await trigger.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog', { name: 'Record Electricity' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
  }
});

test('4. form errors and hints are linked to their fields', async ({ page }) => {
  await sample(page, 1280);
  await page.keyboard.press('n');
  await page.getByTestId('save-tx').click();
  const amount = page.getByTestId('amount');
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(amount).toHaveAccessibleDescription('Enter an amount greater than zero.');
  const merchant = page.getByTestId('merchant');
  await expect(merchant).toHaveAttribute('aria-invalid', 'true');
  await expect(merchant).toHaveAccessibleDescription('Add a merchant or description.');
  await expect(page.getByRole('alert').first()).toBeVisible(); // still announced when it appears
  await amount.fill('12');
  await merchant.fill('Bakery');
  await page.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // a hint is the field's description when there is no error
  await go(page, '/settings');
  await expect(page.getByLabel('Minimum cash reserve')).toHaveAccessibleDescription("Safe to Spend keeps this much aside. It's never counted as spendable.");
  await expect(page.getByLabel('Minimum cash reserve')).not.toHaveAttribute('aria-invalid', 'true');
});

test.describe('5. phone sheets keep their actions on screen', () => {
  for (const [w, h] of [[320, 844], [360, 640], [390, 844], [430, 932]] as const) {
    test(`${w}×${h}: Can I afford this? and Add Transaction`, async ({ page }) => {
      await sample(page, w, h);
      await page.getByRole('button', { name: 'Can I afford this?' }).first().click();
      const dlg = page.getByRole('dialog');
      await dlg.locator('input').first().fill('3000');
      await expect(page.getByTestId('afford-result')).toBeVisible();
      const inView = async (name: string) => {
        const btn = page.getByRole('dialog').locator('.dialog-foot').getByRole('button', { name });
        // wait for the sheet's opening slide to finish, then the button must be fully on screen and on top
        await expect.poll(async () => { const b = (await btn.boundingBox())!; return b.y >= 0 && b.y + b.height <= h; }, { message: name }).toBe(true);
        expect(await btn.evaluate((e) => { const r = e.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit === e || e.contains(hit); }), name).toBe(true);
      };
      await inView('Close'); await inView('Add as transaction');
      // the footer reaches the bottom of the sheet: no strip of content shows below it
      const foot = (await dlg.locator('.dialog-foot').boundingBox())!;
      expect(foot.y + foot.height).toBeGreaterThanOrEqual(h - 1);
      // the content can still be scrolled fully into view above the pinned footer
      const last = dlg.getByText('This is a what-if. Nothing has been saved.');
      await dlg.locator('.dialog').or(dlg).first().evaluate((d) => { d.scrollTop = d.scrollHeight; });
      await page.waitForTimeout(100);
      const lb = (await last.boundingBox())!, fb = (await dlg.locator('.dialog-foot').boundingBox())!;
      expect(lb.y + lb.height).toBeLessThanOrEqual(fb.y + 1);
      await page.keyboard.press('Escape');
      await page.getByRole('navigation', { name: 'Main (compact)' }).getByRole('button', { name: 'Add Transaction' }).click();
      await inView('Cancel'); await inView('Save');
      await page.keyboard.press('Escape');
    });
  }
});

test('6. empty Transactions at 320px: actions stay inside the card', async ({ page }) => {
  await emptyWorkspace(page, 'dark');
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole('navigation', { name: 'Main (compact)' }).getByRole('link', { name: 'Transactions' }).click();
  const empty = page.locator('.card.flush .empty');
  await expect(empty).toContainText('No transactions yet');
  const r = await empty.evaluate((e) => { const card = e.closest('.card')!.getBoundingClientRect(); return { cardR: card.right, cardL: card.left, btns: [...e.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).map((b) => [b.left, b.right]), sw: e.closest('.card')!.scrollWidth, cw: e.closest('.card')!.clientWidth }; });
  for (const [l, rr] of r.btns) { expect(l).toBeGreaterThanOrEqual(r.cardL); expect(rr).toBeLessThanOrEqual(r.cardR); }
  expect(r.sw).toBeLessThanOrEqual(r.cw);
});

test('7–8. one name for the recorded balance; clear affordability label', async ({ page }) => {
  await sample(page, 1280);
  const eq = page.getByTestId('sts-breakdown');
  await expect(eq).toContainText('Current recorded balance$2,871.23');
  await expect(page.getByRole('region', { name: 'Key balances' })).toContainText('Current recorded balance');
  await expect(page.locator('main')).not.toContainText('Available cash now');
  await page.getByTestId('why-sts').click();
  await expect(page.getByRole('dialog')).toContainText('Current recorded balance');
  await expect(page.getByRole('dialog')).not.toContainText('Available cash now');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Can I afford this?' }).first().click();
  await page.getByRole('dialog').locator('input').first().fill('50');
  await expect(page.getByTestId('afford-result')).toContainText('Safe to Spend after this purchase');
});

test('9. phone tab bar is nearly opaque', async ({ page }) => {
  for (const scheme of ['dark', 'light'] as const) {
    await sample(page, 390, 844, scheme);
    const alpha = await page.locator('.tabbar').evaluate((e) => { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g)!.map(Number); return c.startsWith('rgba') || c.includes('/') ? m[3] ?? 1 : 1; });
    expect(alpha, scheme).toBeGreaterThanOrEqual(0.9);
  }
});

test('10. Capture box shows the same focus ring as other fields', async ({ page }) => {
  await sample(page, 1280);
  await page.keyboard.press('n');
  const amount = page.getByTestId('amount');
  await page.waitForTimeout(250);
  const fieldRing = await amount.evaluate((e) => getComputedStyle(e).boxShadow.split(/,(?![^(]*\))/)[0]!.trim());
  await page.keyboard.press('Escape');
  await go(page, '/capture');
  const box = page.locator('.capture-input');
  await page.getByTestId('capture-text').focus();
  await page.waitForTimeout(250);
  const s = await box.evaluate((e) => ({ shadow: getComputedStyle(e).boxShadow, border: getComputedStyle(e).borderTopColor }));
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim());
  expect(s.shadow.startsWith(fieldRing)).toBe(true);
  expect(s.border).toBe(await page.evaluate((a) => { const d = document.createElement('div'); d.style.color = a; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }, accent));
});

test('11. Settings preferences: reserve and default-account fields line up', async ({ page }) => {
  await sample(page, 1280);
  await go(page, '/settings');
  const top = (label: string) => page.getByLabel(label).evaluate((e) => e.getBoundingClientRect().top);
  await expect.poll(async () => Math.abs((await top('Minimum cash reserve')) - (await top('Default account for new transactions')))).toBeLessThanOrEqual(1);
});

test('12. keyboard hints are decorative: button names stay clean', async ({ page }) => {
  await sample(page, 1280);
  await expect(page.locator('.sidebar-add')).toHaveAccessibleName('Add Transaction');
  for (const k of await page.locator('kbd').all()) if (await k.isVisible()) expect(await k.getAttribute('aria-hidden')).toBe('true');
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
});
