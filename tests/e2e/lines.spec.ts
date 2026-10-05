import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';

const DEFAULT_COLUMNS = [
  'Line',
  'Gene',
  'Phenotype(s)',
  'DOB',
  'Status',
  'ID Method',
  'Last ID Date',
  'IDed number',
  'Cryopreserved',
  'Reference(s)',
];

/** The table (desktop/tablet) and the cards (phone) both exist in the DOM; only one is visible per
 * breakpoint (`.data-table`/`.card-list` CSS), so tests must scope to the visible one to avoid
 * waiting on a hidden element or a strict-mode "which one?" ambiguity. */
function rows(page: Page, testInfo: TestInfo) {
  return testInfo.project.name === 'phone-375'
    ? page.locator('.data-card')
    : page.locator('.data-table tbody tr');
}

test('Line List: Active hides Closed lines; All adds them and updates the URL (FR-LIST-02)', async ({
  page,
}, testInfo) => {
  await page.goto('/lines');
  await expect(page.getByRole('heading', { name: 'Lines' })).toBeVisible();
  await expect(rows(page, testInfo).first()).toBeVisible();
  await expect(page.getByText('DEMO_E5')).toHaveCount(0);

  const toolbar = page.getByRole('group', { name: 'Lines' });
  await toolbar.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page).toHaveURL(/\?view=all/);
  await expect(rows(page, testInfo).filter({ hasText: 'DEMO_E5' })).toBeVisible();
});

test('Line List is responsive: cards without horizontal scroll on phone, full table on desktop', async ({
  page,
}, testInfo) => {
  await page.goto('/lines');
  await expect(page.getByRole('heading', { name: 'Lines' })).toBeVisible();
  await expect(rows(page, testInfo).first()).toBeVisible();
  const phone = testInfo.project.name === 'phone-375';
  await expect(page.locator('.card-list')).toHaveCSS('display', phone ? 'block' : 'none');
  await expect(page.locator('.data-table')).toHaveCSS('display', phone ? 'none' : 'block');
  if (testInfo.project.name === 'desktop-1280') {
    for (const label of DEFAULT_COLUMNS) {
      await expect(page.locator('.data-table thead')).toContainText(label);
    }
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  if (testInfo.project.name === 'phone-375') {
    // The compact phone card: name and status, then DOB and ID Method as labelled facts.
    const card = rows(page, testInfo).filter({ hasText: 'demo_c3' });
    await expect(card.locator('.status-badge')).toBeVisible();
    await expect(card.locator('.line-card__facts dt')).toHaveText(['DOB', 'ID Method']);
    await expect(card).not.toContainText('Cryopreserved');
  }
});

test('Line List search has a magnifier, an accessible name, and a wide desktop field', async ({
  page,
}, testInfo) => {
  await page.goto('/lines');
  // One search box per screen (T-026): the header's on desktop, the page's on phone and tablet.
  const search = page.locator('input[data-search-input]:visible');
  await expect(search).toHaveCount(1);
  await expect(search).toHaveAccessibleName('Search lines');
  if (testInfo.project.name === 'desktop-1280') {
    await expect(page.locator('.header-search__key')).toBeVisible();
    const bounds = await search.boundingBox();
    expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(240);
  } else {
    await expect(page.locator('.lines-search__icon')).toBeVisible();
    const bounds = await search.boundingBox();
    expect(bounds?.width ?? 0).toBeGreaterThanOrEqual(240);
  }
});

test('Line List: clicking a row opens the Line Detail page', async ({ page }, testInfo) => {
  await page.goto('/lines');
  const row = rows(page, testInfo).filter({ hasText: 'demo_c3' });
  await row.first().click();
  await expect(page).toHaveURL(/\/lines\/.+/);
});

test('Line List Step 3 done-when: filtering ID Method to Fluorescence shows only fluorescence lines', async ({
  page,
}, testInfo) => {
  await page.goto('/lines?view=all');
  await expect(rows(page, testInfo).first()).toBeVisible();
  await page.getByLabel('ID Method').selectOption({ label: 'Fluorescence' });
  await expect(page).toHaveURL(/idMethod=fluorescence/);
  await expect(rows(page, testInfo)).toHaveCount(1);
  await expect(rows(page, testInfo).first()).toContainText('demo_b2');
});

test('Line List: search filters by gene (FR-GLB-05) and the URL carries the query', async ({
  page,
}, testInfo) => {
  await page.goto('/lines?view=all');
  await expect(rows(page, testInfo).first()).toBeVisible();
  await page.locator('input[data-search-input]:visible').fill('demogene5');
  await expect(page).toHaveURL(/q=demogene5/);
  await expect(rows(page, testInfo)).toHaveCount(1);
  await expect(rows(page, testInfo).first()).toContainText('demo_a1');
});

test('Line List: Cryopreserved filter chip narrows the rows', async ({ page }, testInfo) => {
  await page.goto('/lines?view=all');
  await expect(rows(page, testInfo).first()).toBeVisible();
  const chip = page.getByRole('group', { name: 'Cryopreserved' });
  await chip.getByRole('button', { name: 'Yes', exact: true }).click();
  await expect(page).toHaveURL(/cryo=yes/);
  await expect(rows(page, testInfo)).toHaveCount(3);
});

test('Line List Step 3 done-when: Export CSV downloads a file with the same row count as displayed', async ({
  page,
}, testInfo) => {
  await page.goto('/lines?view=all');
  await expect(rows(page, testInfo).first()).toBeVisible();
  const displayedRows = await rows(page, testInfo).count();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('link', { name: 'Export CSV' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^fish-lines_all_\d{4}-\d{2}-\d{2}\.csv$/);
  const path = await download.path();
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(path, 'utf8');
  const dataRows = text.trim().split(/\r\n/).length - 1;
  expect(dataRows).toBe(displayedRows);
});

test('Owner feedback (PR #13): full-width table, labelled filter panel, padded Export CSV button', async ({
  page,
}, testInfo) => {
  await page.goto('/lines?view=all');
  await expect(rows(page, testInfo).first()).toBeVisible();
  const filters = page.getByRole('group', { name: 'Filters' });
  for (const caption of ['ID Method', 'Cryopreserved', 'Upcoming breeding']) {
    await expect(filters.getByText(caption, { exact: true })).toBeVisible();
  }
  const exportPadding = await page
    .getByRole('link', { name: 'Export CSV' })
    .evaluate((element) => parseFloat(getComputedStyle(element).paddingLeft));
  expect(exportPadding).toBeGreaterThanOrEqual(16);
  if (testInfo.project.name === 'desktop-1280') {
    // Every default column fits the window: the last header ends inside the viewport.
    const last = await page.locator('.data-table thead th').last().boundingBox();
    expect(last).not.toBeNull();
    expect((last?.x ?? 0) + (last?.width ?? 0)).toBeLessThanOrEqual(1280);
  }
});

test('the way to a line’s details is obvious: pointer cursor, hover highlight, a real link', async ({
  page,
}, testInfo) => {
  await page.goto('/lines');
  await expect(rows(page, testInfo).first()).toBeVisible();
  await expect(page.getByText('Click a line to open its details.')).toBeVisible();
  const first = rows(page, testInfo).first();
  const link = first.locator('a.line-link');
  await expect(link).toHaveAttribute('href', /^\/lines\/.+/);
  await expect(link).toHaveCSS('text-decoration-line', 'underline');
  await expect(first).toHaveCSS('cursor', 'pointer');
  if (testInfo.project.name !== 'phone-375') {
    const before = await first.evaluate((element) => getComputedStyle(element).backgroundColor);
    await first.hover();
    const after = await first.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(after).not.toBe(before);
  }
  // Clicking the name navigates once, to that line.
  await link.click();
  await expect(page).toHaveURL(/\/lines\/[^/?]+$/);
});

test('Line List: Sort by orders the lines by status either way, and the URL carries it', async ({
  page,
}, testInfo) => {
  await page.goto('/lines?view=all');
  await expect(rows(page, testInfo).first()).toBeVisible();
  const sortBy = page.getByLabel('Sort by');
  await expect(sortBy).toHaveValue(':asc');
  await expect(rows(page, testInfo).last()).toContainText('DEMO_E5');
  await sortBy.selectOption({ label: 'Status: Breeding first' });
  await expect(page).toHaveURL(/sort=status&dir=desc/);
  await expect(rows(page, testInfo).first()).toContainText('DEMO_E5');
  await sortBy.selectOption({ label: 'Status: Current first' });
  await expect(page).not.toHaveURL(/sort=/);
  await expect(rows(page, testInfo).last()).toContainText('DEMO_E5');
});

test('Line Detail: Back to Lines returns to the same list view', async ({ page }, testInfo) => {
  await page.goto('/lines?view=all&sort=status&dir=desc');
  await rows(page, testInfo).filter({ hasText: 'demo_c3' }).first().click();
  await expect(page).toHaveURL(/\/lines\/[^/?]+$/);
  await page.getByRole('link', { name: 'Back to Lines' }).click();
  await expect(page).toHaveURL(/\/lines\?view=all&sort=status&dir=desc$/);
  await expect(rows(page, testInfo).first()).toContainText('DEMO_E5');
});
