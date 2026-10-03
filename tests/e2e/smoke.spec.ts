import { expect, test } from '@playwright/test';

import { actAs, E2E_PASSWORD } from './auth';

test('app shell is responsive, stays signed in across a reload, and has no horizontal scroll', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  const phone = testInfo.project.name === 'phone-375';
  await expect(page.locator('.bottom-tabs')).toHaveCSS('display', phone ? 'flex' : 'none');
  await expect(page.locator('.top-nav')).toHaveCSS('display', phone ? 'none' : 'flex');
  // The browser starts signed in as a member (globalSetup); the session survives a reload because
  // the API keeps it in a 90-day cookie (ADR-0005).
  await expect(page.locator('.account-menu__name')).toHaveText('Bob');
  await page.reload();
  await expect(page.locator('.account-menu__name')).toHaveText('Bob');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `tests/e2e/__screenshots__/shell-${testInfo.project.name}.png` });
});

test('health endpoint is served by the Worker next to the page', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({ ok: true });
});

test.describe('without a session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('the sign-in page shows, refuses a wrong password and lets a member in', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Your name').fill('Dan');
    await page.getByLabel('Password', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('The name or password is not correct');
    await page.getByLabel('Password', { exact: true }).fill(E2E_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('.account-menu__name')).toHaveText('Dan');
  });

  test('the API refuses a request without a session', async ({ request }) => {
    expect((await request.get('/api/lines')).status()).toBe(401);
  });

  test('a wrong guest link is refused politely', async ({ page }) => {
    await page.goto('/guest/not-the-token');
    await expect(page.getByRole('alert')).toContainText('guest link is not valid');
  });

  test('an invalid invite link is refused politely', async ({ page }) => {
    await page.goto('/join/not-a-token');
    await expect(page.getByRole('alert')).toContainText('invite link is not valid');
  });
});

test('the account menu offers password, guest link and sign out; sign out returns to sign-in', async ({
  page,
}) => {
  await page.goto('/');
  await page
    .getByRole('button', { name: /Account menu for Bob/ })
    .or(page.locator('summary[aria-label^="Account menu"]'))
    .click();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy guest link' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await actAs(page, 'Bob');
});

test('a Guest sees the read-only banner, no Settings link and no "New Line" save', async ({
  page,
}) => {
  await actAs(page, 'Guest');
  await page.goto('/');
  await expect(page.locator('.guest-banner')).toContainText('Guest view');
  await expect(page.locator('.settings-link')).toHaveCount(0);
  await actAs(page, 'Bob');
});

test('an Admin sees the amber header and the Settings link', async ({ page }) => {
  await actAs(page, 'Admin');
  await page.goto('/');
  await expect(page.locator('.app-header--admin')).toBeVisible();
  await expect(page.locator('.account-menu__name')).toHaveText('Lab Admin');
  const phone = page.viewportSize()?.width === 375;
  if (!phone) await expect(page.locator('.settings-link')).toBeVisible();
  await actAs(page, 'Bob');
});
