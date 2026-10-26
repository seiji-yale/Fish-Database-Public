import { expect, test, type Page } from '@playwright/test';
import { actAs } from './auth';

/** T-032, owner acceptance 1, 2 and 5: what a Guest sees at every screen width. */
test.describe('the Guest view', () => {
  test.beforeEach(async ({ page }) => {
    await actAs(page, 'Guest');
  });
  test.afterEach(async ({ page }) => {
    await actAs(page, 'Bob');
  });

  async function noSideScroll(page: Page) {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  test('Dashboard: greeting, three counters and two buttons only', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('dashboard-hello')).toContainText('Hello, Guest');
    await expect(page.locator('.dashboard-counter')).toHaveCount(3);
    await expect(page.locator('.dashboard-navigation a')).toHaveText([
      'See Active Lines',
      'See All Lines',
    ]);
    for (const id of ['unread-messages', 'open-requests'])
      await expect(page.locator(`#${id}`)).toHaveCount(0);
    await expect(page.locator('.dashboard-upcoming')).toHaveCount(0);
    await expect(page.locator('.chat-header-link')).toHaveCount(0);
    await noSideScroll(page);
  });

  test('Lines: overview columns, one filter, no Export CSV', async ({ page }, testInfo) => {
    await page.goto('/lines?view=all');
    await expect(page.getByRole('link', { name: 'demo_c3' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByText('Cryopreserved', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Breed soon/ })).toHaveCount(0);
    if (testInfo.project.name.startsWith('desktop'))
      await expect(page.locator('thead th')).toHaveCount(9);
    await noSideScroll(page);
  });

  test('a line shows one overview card', async ({ page }) => {
    await page.goto('/lines/fx-demo_c3');
    await expect(page.getByRole('heading', { name: 'demo_c3', level: 1 })).toBeVisible();
    await expect(page.locator('#summary')).toContainText('Last ID Date');
    await expect(page.locator('#refs')).toBeVisible();
    await expect(page.locator('.section-jump')).toHaveCount(0);
    await noSideScroll(page);
  });

  test('refused pages show the standard screen; the API answers 403', async ({ page }) => {
    for (const path of ['/settings', '/lines/new', '/lines/fx-demo_c3/print', '/feeding']) {
      await page.goto(path);
      await expect(
        page.getByRole('heading', { name: 'Not available in the Guest view' }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'Back to Dashboard' })).toBeVisible();
    }
    for (const path of ['/api/messages', '/api/activities', '/api/lines.csv'])
      expect((await page.request.get(path)).status()).toBe(403);
  });
});
