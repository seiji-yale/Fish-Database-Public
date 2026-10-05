import { expect, test, type Page } from '@playwright/test';

const LONG_NAME = 'Zebrafish Line and Cryopreservation Database of the Developmental Genetics Lab';

/** Serves the real session with a long app name, as an Admin so the settings link shows too. */
async function useLongAppName(page: Page) {
  await page.route('**/api/session', async (route) => {
    const response = await route.fetch();
    const session = (await response.json()) as { appName?: string; user: { role: string } };
    await route.fulfill({
      response,
      json: { ...session, appName: LONG_NAME, user: { ...session.user, role: 'admin' } },
    });
  });
}

test('a long app name wraps inside the brand and the header controls stay on its row', async ({
  page,
}) => {
  await useLongAppName(page);
  await page.goto('/');
  const brand = page.locator('.app-brand');
  await expect(brand).toHaveText(LONG_NAME);
  const brandBox = await brand.boundingBox();
  const accountBox = await page.locator('.account-menu > summary').boundingBox();
  expect(brandBox).not.toBeNull();
  expect(accountBox).not.toBeNull();
  if (brandBox === null || accountBox === null) return;
  // Same row: the account button sits to the right of the brand, not below it.
  expect(accountBox.x).toBeGreaterThan(brandBox.x + brandBox.width - 1);
  expect(accountBox.y).toBeLessThan(brandBox.y + brandBox.height);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test.describe('search below desktop width', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 1024, 'desktop uses the header box');

  test('the Dashboard has a search box that opens the filtered Lines', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('searchbox', { name: 'Search lines' });
    await expect(box).toBeVisible();
    await box.fill('demo_a1');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/lines\?q=demo_a1$/);
    await expect(page.getByRole('searchbox', { name: 'Search lines' })).toHaveValue('demo_a1');
  });
});

test.describe('phone tab bar', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) >= 640, 'the tab bar is phone-only');

  test('Search opens Lines with the search box focused', async ({ page }) => {
    await page.goto('/');
    await page.locator('.bottom-tabs').getByRole('link', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/lines#search$/);
    await expect(page.getByRole('searchbox', { name: 'Search lines' })).toBeFocused();
  });
});

test('an Admin reaches Settings from the account menu, on every screen width', async ({ page }) => {
  await useLongAppName(page);
  await page.goto('/');
  await page.locator('.account-menu > summary').click();
  const settings = page.locator('.account-menu__list').getByRole('link', { name: 'Settings' });
  await expect(settings).toBeVisible();
  await settings.click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('a member sees no Settings item in the account menu', async ({ page }) => {
  await page.goto('/');
  await page.locator('.account-menu > summary').click();
  await expect(page.locator('.account-menu__list')).toBeVisible();
  await expect(
    page.locator('.account-menu__list').getByRole('link', { name: 'Settings' }),
  ).toHaveCount(0);
});
