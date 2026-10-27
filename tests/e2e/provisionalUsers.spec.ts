import { expect, test } from '@playwright/test';
import { actAs } from './auth';

/** T-036: people named by the Feeding Schedule sheet import wait in Settings > Users for an Admin's decision. */
test('Settings > Users points at the provisional people and marks them', async ({ page }) => {
  await actAs(page, 'Admin');
  await page.route('**/api/admin/overview', async (route) => {
    const response = await route.fetch();
    const overview = (await response.json()) as { users: Record<string, unknown>[] };
    overview.users.push({
      id: 'prov-feeder-four',
      name: 'Feeder Four',
      role: 'feeder',
      isActive: false,
      isBuiltin: false,
      invitePending: false,
      canSignIn: false,
      provisional: true,
    });
    await route.fulfill({ response, json: overview });
  });
  await page.goto('/settings');
  const notice = page.getByRole('status').filter({ hasText: 'waiting for your decision' });
  await expect(notice).toContainText(
    '1 person from the Feeding Schedule sheet is waiting for your decision.',
  );
  await expect(page.getByText('Feeder Four')).toHaveCount(0);
  await notice.getByRole('button', { name: 'Show them' }).click();
  const row = page.locator('.settings-row').filter({ hasText: 'Feeder Four' });
  await expect(row).toContainText('Provisional');
  await expect(row).toContainText('Removed');
  await row.locator('summary').click();
  await expect(page.getByRole('button', { name: 'Reactivate' })).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
