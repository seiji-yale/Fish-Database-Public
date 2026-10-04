import { expect, test } from '@playwright/test';
import { actAs } from './auth';

// T-026 (OQ-33): search in the header on desktop, and the `/` shortcut.
test.describe('desktop header search', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1024, 'the header box is desktop-only');

  test('"/" focuses the header box; Enter shows the filtered Lines', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('searchbox', { name: 'Search lines' });
    await expect(box).toBeVisible();
    await page.keyboard.press('/');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('');
    await page.keyboard.type('demo_a1');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/lines\?q=demo_a1$/);
    await expect(page.locator('.data-table tbody tr')).toHaveCount(1);
    await expect(page.getByRole('searchbox', { name: 'Search lines' })).toHaveValue('demo_a1');
    // One box per screen: the Lines page's own box is hidden next to the header's.
    await expect(page.locator('.lines-search')).toBeHidden();
  });

  test('on the Lines page typing filters live and the box follows the back button', async ({
    page,
  }) => {
    await page.goto('/lines');
    const rows = page.locator('.data-table tbody tr');
    const before = await rows.count();
    const box = page.getByRole('searchbox', { name: 'Search lines' });
    await box.fill('demo_a1');
    await expect(rows).toHaveCount(1);
    await expect(page).toHaveURL(/q=demo_a1/);
    await page.goBack();
    await expect(box).toHaveValue('');
    await expect(rows).toHaveCount(before);
  });

  test('a "/" typed into the chat box or a form field stays a "/"', async ({ page }) => {
    await page.goto('/lines/fx-demo_c3');
    const composer = page.getByLabel('Write a message', { exact: true }).first();
    await composer.click();
    await page.keyboard.type('a/b');
    await expect(composer).toHaveValue('a/b');
    await expect(page.getByRole('searchbox', { name: 'Search lines' })).not.toBeFocused();
  });

  test('Escape leaves the box, and "/" is ignored while a dialog is open', async ({ page }) => {
    await page.goto('/lines/fx-demo_c3');
    const box = page.getByRole('searchbox', { name: 'Search lines' });
    await expect(box).toBeVisible();
    await page.keyboard.press('/');
    await expect(box).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(box).not.toBeFocused();
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByLabel('Gene', { exact: true }).blur();
    await page.getByRole('dialog').getByRole('heading').first().click();
    await page.keyboard.press('/');
    await expect(box).not.toBeFocused();
  });
});

test.describe('phone and tablet', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'the header box is desktop-only');

  test('there is no header box; "/" focuses the Dashboard and Lines page boxes', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('.app-header .header-search')).toBeHidden();
    // The Dashboard shows its own box instead (it renders with the Dashboard data).
    await expect(page.locator('input[data-search-input]:visible')).toHaveCount(1);
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search lines' })).toBeFocused();
    await page.goto('/lines');
    await expect(page.getByRole('searchbox', { name: 'Search lines' })).toBeVisible();
    await page.keyboard.press('/');
    await expect(page.getByRole('searchbox', { name: 'Search lines' })).toBeFocused();
  });
});

test('the header does not overflow at the 1024 px desktop breakpoint, even for an Admin', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await actAs(page, 'Admin');
  await page.goto('/');
  await expect(page.getByRole('searchbox', { name: 'Search lines' })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await actAs(page, 'Bob');
});
