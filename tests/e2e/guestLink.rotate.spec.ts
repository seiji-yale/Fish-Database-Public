import { expect, test, type Page } from '@playwright/test';
import { actAs } from './auth';

// Replacing the Guest link signs every Guest out. It runs in its own project after all other
// write specs (see playwright.config.ts) so no spec running at the same time loses its Guest session.
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('the Guest link: replacing it ends guest sessions', async ({ page }) => {
  await actAs(page, 'Admin');
  const before = (await (await page.request.get('/api/guest-link')).json()) as { token: string };
  await page.goto('/settings#preferences');
  await page.getByRole('button', { name: 'Replace the guest link' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Replace the guest link' }).click();
  await expect(toast(page, 'Guest link replaced')).toBeVisible();
  const after = (await (await page.request.get('/api/guest-link')).json()) as { token: string };
  expect(after.token).not.toBe(before.token);
  expect((await page.request.post(`/api/guest/${before.token}`)).status()).toBe(404);
});
