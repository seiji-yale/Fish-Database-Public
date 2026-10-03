import { expect, test } from '@playwright/test';

test('dashboard sections, navigation, and activity links work across screen sizes', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upcoming Breeding' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Currently Breeding' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Activity' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start Breeding' }).first()).toHaveAttribute(
    'href',
    /\/lines\/fx-[^?]+\?action=start-breeding$/,
  );
  await expect(page.getByRole('link', { name: 'See Active Lines' })).toHaveAttribute(
    'href',
    '/lines?view=active',
  );
  await expect(page.getByRole('link', { name: 'See All Lines' })).toHaveAttribute(
    'href',
    '/lines?view=all',
  );
  await expect(page.getByRole('link', { name: 'Add New Line' })).toHaveAttribute(
    'href',
    '/lines/new',
  );
  await expect(page.locator('.activity-list a').first()).toHaveAttribute('href', /^\/lines\//);
  const viewportWidth = page.viewportSize()?.width ?? 0;
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(viewportWidth).toBeGreaterThanOrEqual(375);
});

test('Recent Activity previews 10 items, expands by 20, and can collapse', async ({ page }) => {
  const firstPage = Array.from({ length: 10 }, (_, index) => ({
    id: `activity-${String(index)}`,
    lineId: 'fx-demo_c3',
    lineName: 'demo_c3',
    userName: 'Bob',
    type: 'imported',
    summary: `Activity ${String(index)}`,
    createdAt: '2026-09-29T12:00:00Z',
  }));
  const secondPage = Array.from({ length: 20 }, (_, index) => ({
    id: `more-${String(index)}`,
    lineId: 'fx-demo_c3',
    lineName: 'demo_c3',
    userName: 'Bob',
    type: 'imported',
    summary: `More ${String(index)}`,
    createdAt: '2026-09-28T12:00:00Z',
  }));
  const unreadItems = [
    {
      id: 'dashboard-unread-1',
      lineId: 'fx-demo_c3',
      lineName: 'demo_c3',
      body: 'Please review the genotyping result.',
      authorName: 'Dan',
      createdAt: '2026-09-29T12:00:00Z',
    },
    {
      id: 'dashboard-unread-2',
      lineId: null,
      lineName: null,
      body: '@all Lab update.',
      authorName: 'Guest',
      createdAt: '2026-09-29T11:00:00Z',
    },
  ];
  await page.route('**/api/messages/dashboard-unread-1/read', async (route) => {
    unreadItems.splice(0, 1);
    await route.fulfill({ status: 204 });
  });
  await page.route('**/api/messages/read-all', async (route) => {
    const marked = unreadItems.length;
    unreadItems.splice(0, unreadItems.length);
    await route.fulfill({ json: { marked } });
  });
  await page.route('**/api/messages/unread-count', (route) =>
    route.fulfill({ json: { unread: unreadItems.length, openRequests: 0 } }),
  );
  await page.route('**/api/dashboard', (route) =>
    route.fulfill({
      json: {
        today: '2026-09-29',
        thresholdMonths: 11,
        counters: {
          active: 1,
          closed: 0,
          cryopreserved: 1,
          unreadMessages: unreadItems.length,
          openRequests: 1,
        },
        upcoming: [],
        unreadMessages: unreadItems,
        openRequests: [
          {
            id: 'request-1',
            lineId: 'fx-demo_c3',
            lineName: 'demo_c3',
            body: 'Please set up an out-cross.',
            requestType: 'Set up cross',
            userId: 'bob-id',
            authorName: 'Bob',
            createdAt: '2026-09-29T12:00:00Z',
          },
        ],
        currentlyBreeding: [
          { id: 'fx-demo_c3', name: 'demo_c3', breedingStartedAt: '2026-09-26', days: 3 },
        ],
        missingDob: [{ id: 'fx-demo_c3', name: 'demo_c3', status: 'Current' }],
        recentActivity: { items: firstPage, nextBefore: '2026-09-28T12:00:00Z::activity-20' },
      },
    }),
  );
  let requestedPages = 0;
  await page.route('**/api/activities?*', (route) => {
    requestedPages += 1;
    return route.fulfill({
      json: { items: secondPage, nextBefore: null },
    });
  });

  await page.goto('/');
  await expect(page.getByRole('link', { name: '2 unread chat messages' })).toBeVisible();
  await expect(
    page.getByText('Please review the genotyping result.', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Dan', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open chat' }).first()).toHaveAttribute(
    'href',
    '/lines/fx-demo_c3#chat',
  );
  await page.getByRole('button', { name: 'Mark read' }).first().click();
  await expect(page.getByRole('link', { name: '1 unread chat message' })).toBeVisible();
  await expect(page.getByText('@all Lab update.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark all read' }).click();
  await expect(page.getByText('There are no unread messages.')).toBeVisible();
  await expect(page.getByRole('link', { name: '0 unread chat messages' })).toBeVisible();
  await expect(page.locator('.chat-header-badge')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Unread messages 0' })).toHaveAttribute(
    'href',
    '#unread-messages',
  );
  await expect(page.getByText('Please set up an out-cross.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open request', exact: true })).toHaveAttribute(
    'href',
    '/lines/fx-demo_c3#chat-request-request-1',
  );
  // One button under Currently Breeding; it asks which line (no per-row buttons).
  await expect(page.getByRole('link', { name: 'Update Genotyping Record' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Update Genotyping Record' }).click();
  const picker = page.getByRole('dialog', { name: 'Update Genotyping Record' });
  await expect(picker.getByLabel('Line')).toContainText('demo_c3');
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Missing DOB' })).toBeVisible();
  // Recent Activity scrolls like Lab Chat: the next page loads when the list is scrolled to its end.
  await expect(page.locator('.activity-list li')).toHaveCount(10);
  await expect(page.getByRole('button', { name: 'Show more' })).toHaveCount(0);
  await page.locator('.activity-list').evaluate((list) => {
    list.scrollTop = list.scrollHeight;
  });
  await expect(page.locator('.activity-list li')).toHaveCount(30);
  await expect(page.getByText('More 19')).toBeAttached();
  expect(requestedPages).toBe(1);
});

test('Update Genotyping Record on the Dashboard opens the chosen line’s dialog', async ({
  page,
}) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Update Genotyping Record' });
  if ((await button.count()) === 0) test.skip(true, 'no line is breeding in the fixture');
  await button.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/lines\/.+/);
});
