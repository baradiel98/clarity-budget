import { expect, test, type Page } from '@playwright/test';
import { addExpense, fresh, onboard, toDashboard } from './helpers';

const animNames = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? el.getAnimations().map((a) => (a as CSSAnimation).animationName) : null;
  }, selector);

test.describe('motion system', () => {
  test('dashboard: page, sections and chart animate; values are exact from the first frame', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    // sections enter one after another
    const delays = await page.evaluate(() => [...document.querySelectorAll('.stagger > *')].map((el) => getComputedStyle(el).animationDelay));
    expect(delays.slice(0, 3)).toEqual(['0s', '0.045s', '0.09s']);
    // the forecast draws in from left to right
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.fc-reveal')!).animationName)).toBe('reveal-x');
    // navigating plays the page transition
    await page.getByRole('link', { name: /Transactions/ }).first().click();
    expect(await animNames(page, '.main-inner')).toContain('page-in');
    expect(errors).toEqual([]);
  });

  test('a changed number fades in already correct (never counts through other values); new rows are highlighted', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await expect(page.getByTestId('available-cash')).toHaveText('$1,200.00');
    await page.evaluate(() => {
      const w = window as unknown as { __seen: Set<string> };
      w.__seen = new Set();
      const el = document.querySelector('[data-testid="available-cash"]')!;
      new MutationObserver(() => w.__seen.add(el.textContent ?? '')).observe(el, { subtree: true, childList: true, characterData: true });
    });
    await addExpense(page, '43.21', 'Trader Joes');
    await expect(page.getByTestId('available-cash')).toHaveText('$1,156.79');
    const seen = await page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen]);
    for (const v of seen) expect(['$1,200.00', '$1,156.79']).toContain(v);
    await expect(page.getByTestId('available-cash').locator('.value-in')).toHaveCount(1);
    // the new transaction is highlighted briefly in Recent transactions
    await expect(page.getByTestId('recent').locator('.list-row.fresh')).toHaveCount(1);
  });

  test('dialogs leave with a short exit; the segmented control slides', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await page.getByRole('button', { name: 'Add Transaction' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.overlay.closing')).toHaveCount(1);
    await expect(dialog).toHaveCount(0);
    // range control: the selection indicator moves under the chosen option
    const seg = page.getByRole('group', { name: 'Chart range' });
    const target = seg.getByRole('button').nth(1);
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    const measure = () => seg.evaluate((el) => {
      const t = el.querySelector<HTMLElement>('.seg-thumb')!;
      const b = el.querySelector<HTMLElement>('button[aria-pressed="true"]')!;
      return { x: Math.round(new DOMMatrix(getComputedStyle(t).transform).m41), target: b.offsetLeft, moving: t.getAnimations().length > 0 };
    });
    // it is a transition (moving right after the click), and it lands exactly under the chosen option
    expect((await measure()).moving).toBe(true);
    await expect.poll(async () => { const m = await measure(); return m.x === m.target && !m.moving; }).toBe(true);
  });

  test('budget: month changes slide in the direction of travel', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await page.getByRole('link', { name: /Budget/ }).first().click();
    await page.getByRole('button', { name: 'Previous month' }).click();
    await expect(page.locator('.month-body')).toHaveAttribute('data-dir', 'prev');
    expect(await animNames(page, '.month-body')).toContain('month-prev');
    await page.getByRole('button', { name: 'Next month' }).click();
    await expect(page.locator('.month-body')).toHaveAttribute('data-dir', 'next');
  });

  test('busy buttons show a spinner while work happens (setup encrypts)', async ({ page }) => {
    await fresh(page);
    await page.evaluate(() => {
      const w = window as unknown as { __spun: boolean };
      w.__spun = false;
      new MutationObserver(() => { if (document.querySelector('button[aria-busy="true"] .spinner')) w.__spun = true; }).observe(document.body, { subtree: true, childList: true, attributes: true });
    });
    await onboard(page);
    expect(await page.evaluate(() => (window as unknown as { __spun: boolean }).__spun)).toBe(true);
  });

  test('reduced motion: everything is instant, nothing waits on a delay, dialogs close at once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    const slow = await page.evaluate(() =>
      document.getAnimations()
        .map((a) => ({ name: (a as CSSAnimation).animationName, t: a.effect!.getComputedTiming() }))
        .filter((x) => x.name !== 'spin' && x.name !== 'auth-spin' && ((x.t.duration as number) > 1 || (x.t.delay ?? 0) > 0)),
    );
    expect(slow).toEqual([]);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.stagger > :nth-child(3)')!).animationDelay)).toBe('0s');
    await page.getByRole('button', { name: 'Add Transaction' }).first().click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 100 });
  });
});
