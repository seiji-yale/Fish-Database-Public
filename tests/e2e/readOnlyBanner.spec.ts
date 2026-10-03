import { expect, test } from '@playwright/test';

/** T-021: while the Admin restores the database everyone sees a banner (the session says `readOnly`). */
test('the read-only banner shows for everyone', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({
      json: {
        appName: 'Fish Database',
        user: { id: 'u', name: 'Bob', role: 'member' },
        mustChangePassword: false,
        readOnly: true,
        mirrorStale: false,
      },
    }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('alert').filter({ hasText: 'Read-only: an Admin is restoring' }),
  ).toBeVisible();
  // The banner must not push the page sideways on a phone.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('without read-only mode there is no banner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(page.getByText('Read-only: an Admin is restoring')).toHaveCount(0);
});
