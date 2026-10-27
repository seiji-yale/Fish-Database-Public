import { expect, test, type Page } from '@playwright/test';
import { actAs } from './auth';

/** T-034, owner acceptance 1, 3 and 6 (read only): navigation, the calendar at every width, the Guest view. */

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('the Dashboard and the account menu lead to the current month', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.dashboard-navigation a').last()).toHaveText('Feeding Schedule');
  await page.getByRole('link', { name: 'Feeding Schedule' }).first().click();
  await expect(page).toHaveURL(/\/feeding$/);
  await expect(page.getByRole('heading', { name: 'Feeding Schedule', level: 1 })).toBeVisible();
  await page.goto('/');
  await page.locator('.account-menu summary').click();
  await page.locator('.account-menu__list').getByRole('link', { name: 'Feeding Schedule' }).click();
  await expect(page.getByRole('heading', { name: 'Feeding Schedule', level: 1 })).toBeVisible();
  const month = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date());
  await expect(page.locator('.feeding-nav__month')).toHaveText(month);
});

test('October 2026 starts on Thursday and ends on Saturday; the URL follows the month', async ({
  page,
}, testInfo) => {
  await page.goto('/feeding?month=2026-10');
  await expect(page.locator('.feeding-nav__month')).toHaveText('October 2026');
  const first = page.locator('.feeding-grid [data-date="2026-10-01"]');
  await expect(first).toBeVisible();
  const column = await first.evaluate((cell) => cell.closest('td')?.cellIndex);
  expect(column).toBe(4);
  const last = page.locator('.feeding-grid [data-date="2026-10-31"]');
  expect(await last.evaluate((cell) => cell.closest('td')?.cellIndex)).toBe(6);
  await expect(page.locator('.feeding-grid thead th').first()).toHaveText('Sun');

  await page.getByRole('button', { name: /Next/ }).click();
  await expect(page).toHaveURL(/month=2026-11/);
  await expect(page.locator('.feeding-nav__month')).toHaveText('November 2026');
  await page.getByRole('button', { name: /Previous/ }).click();
  await page.getByRole('button', { name: /Previous/ }).click();
  await expect(page).toHaveURL(/month=2026-09/);
  await page.locator('.feeding-nav__picker').fill('2027-02');
  await expect(page).toHaveURL(/month=2027-02/);
  await expect(page.locator('.feeding-nav__month')).toHaveText('February 2027');
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(page).not.toHaveURL(/month=2027-02/);
  await expect(page.locator('.feeding-cell--today')).toContainText('Today');
  await noSideScroll(page);

  for (const cell of await page.locator('.feeding-cell').all()) {
    const box = await cell.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  expect(testInfo.project.name).toBeTruthy();
});

test('the next 14 days without a feeder say Unassigned, with a warning mark', async ({ page }) => {
  await page.goto('/feeding');
  const today = page.locator('.feeding-cell--today');
  await expect(today).toContainText('Unassigned');
  await expect(today.locator('.feeding-cell__who [aria-hidden="true"]').first()).toHaveText('⚠');
  // The page shows one month: today through today + 13, or to the end of the month.
  const [year, month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' })
    .format(new Date())
    .split('-')
    .map(Number);
  const daysInMonth = new Date(Date.UTC(year ?? 0, month ?? 0, 0)).getUTCDate();
  await expect(page.locator('.feeding-cell--soon')).toHaveCount(
    Math.min(14, daysInMonth - (day ?? 0) + 1),
  );
});

test('the phone shows a List view with every day', async ({ page }, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith('phone'),
    'the Grid | List toggle is a phone control',
  );
  await page.goto('/feeding?month=2026-10');
  await expect(page.locator('.feeding-view-toggle')).toBeVisible();
  await noSideScroll(page);
  await page.getByRole('button', { name: 'List' }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page.locator('.feeding-grid')).toBeHidden();
  await expect(page.locator('.feeding-row')).toHaveCount(31);
  await expect(page.locator('.feeding-row').first()).toContainText('Thu 1');
  await noSideScroll(page);
  await page.getByRole('button', { name: 'Grid' }).click();
  await expect(page).not.toHaveURL(/view=list/);
  await expect(page.locator('.feeding-grid')).toBeVisible();
});

test.describe('the Guest view', () => {
  test.beforeEach(async ({ page }) => {
    await actAs(page, 'Guest');
  });
  test.afterEach(async ({ page }) => {
    await actAs(page, 'Bob');
  });

  test('shows Not available and offers no Feeding Schedule entry', async ({ page }) => {
    await page.goto('/feeding');
    await expect(
      page.getByRole('heading', { name: 'Not available in the Guest view' }),
    ).toBeVisible();
    await expect(page.locator('.feeding-grid')).toHaveCount(0);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Feeding Schedule' })).toHaveCount(0);
  });
});

test('the header offers the Feeding Schedule, and the month shows once', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  const entry = testInfo.project.name.startsWith('phone')
    ? page.locator('.bottom-tabs').getByRole('link', { name: 'Feeding Schedule' })
    : page.locator('.top-nav').getByRole('link', { name: 'Feeding Schedule' });
  await entry.click();
  await expect(page.getByRole('heading', { name: 'Feeding Schedule', level: 1 })).toBeVisible();
  // One month box, no second "Month Year" next to it.
  await expect(page.locator('.feeding-nav__picker')).toBeVisible();
  await expect(page.locator('.feeding-nav h2')).toHaveClass(/sr-only/);
});

test('held upright the totals sit under the calendar; held wide they sit beside it', async ({
  page,
}) => {
  await page.goto('/feeding?month=2026-10');
  const grid = await page.locator('.feeding-grid').boundingBox();
  const totals = await page.locator('.feeding-totals').boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  if (width >= 1024)
    expect(totals?.x ?? 0).toBeGreaterThan((grid?.x ?? 0) + (grid?.width ?? 0) - 1);
  else expect(totals?.y ?? 0).toBeGreaterThan((grid?.y ?? 0) + (grid?.height ?? 0) - 1);
  await page.setViewportSize({ width: 1024, height: 1366 });
  const upright = await page.locator('.feeding-totals').boundingBox();
  const calendar = await page.locator('.feeding-grid').boundingBox();
  expect(upright?.y ?? 0).toBeGreaterThan((calendar?.y ?? 0) + (calendar?.height ?? 0) - 1);
});
