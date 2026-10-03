import { expect, test } from '@playwright/test';
import { actAs } from './auth';

test('the Dashboard says who is signed in: a Guest cannot change data, a member can', async ({
  page,
}) => {
  await actAs(page, 'Guest');
  await page.goto('/');
  const hello = page.getByTestId('dashboard-hello');
  await expect(hello).toContainText('Hello, Guest');
  await expect(hello).toContainText('cannot change line data');

  await actAs(page, 'Dan');
  await page.reload();
  await expect(hello).toContainText('Hello, Dan');
  await expect(hello).not.toContainText('cannot change');
});
