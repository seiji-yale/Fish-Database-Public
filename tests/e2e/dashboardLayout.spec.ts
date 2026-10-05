import { expect, test } from '@playwright/test';

test('on a wide screen Lab Chat sits to the right of Recent Activity, below Currently Breeding', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-1280',
    'the side-by-side layout is for wide screens',
  );
  await page.goto('/');
  // Measure only after the panels have their data: late content moves the grid rows.
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.dashboard-current')).toBeVisible();
  const activity = await page.locator('.dashboard-activity').boundingBox();
  const chat = await page.locator('#lab-chat').boundingBox();
  const current = await page.locator('.dashboard-current').boundingBox();
  if (activity === null || chat === null || current === null) throw new Error('panels missing');
  // Same row, chat on the right.
  expect(chat.x).toBeGreaterThan(activity.x + activity.width - 4);
  expect(chat.y).toBeLessThan(activity.y + activity.height);
  expect(chat.y + chat.height).toBeGreaterThan(activity.y);
  // Both are below Currently Breeding.
  expect(activity.y).toBeGreaterThanOrEqual(current.y + current.height - 4);
  await expect(page.locator('#lab-chat details')).toHaveAttribute('open', '');
});

test('on a phone Lab Chat stays folded, after Recent Activity', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-375', 'phone layout only');
  await page.goto('/');
  await expect(page.locator('#lab-chat details')).not.toHaveAttribute('open', '');
});

test('every counter and panel heading has one decorative icon beside its unchanged label', async ({
  page,
}) => {
  await page.goto('/');
  const counters = page.locator('.dashboard-counter');
  await expect(counters).toHaveCount(5);
  for (const counter of await counters.all()) {
    await expect(counter.locator('svg.dashboard-icon')).toHaveCount(1);
    await expect(counter.locator('svg.dashboard-icon')).toHaveAttribute('aria-hidden', 'true');
  }
  for (const name of ['Upcoming Breeding', 'Currently Breeding', 'Recent Activity', 'Lab Chat']) {
    const heading = page.getByRole('heading', { level: 2, name, exact: true });
    await expect(heading.locator('svg.dashboard-icon')).toHaveCount(1);
  }
  // A counter and the panel it opens share their icon.
  for (const [href, id] of [
    ['#unread-messages', 'unread-messages-title'],
    ['#open-requests', 'open-requests-title'],
  ] as const) {
    const counterIcon = await page
      .locator(`.dashboard-counter[href="${href}"] svg`)
      .getAttribute('data-icon');
    await expect(page.locator(`#${id} svg`)).toHaveAttribute('data-icon', counterIcon ?? '');
  }
});
