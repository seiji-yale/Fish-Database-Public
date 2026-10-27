import {
  expect,
  request as playwrightRequest,
  test,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { signInRequest } from './auth';

/**
 * T-034, owner acceptance 2, 4 and 5: setting, changing and clearing a day, the conflict between two
 * people, the history, and Repeat this week. Each viewport works in its own far-away month so the three
 * projects (which share one database) never touch the same day.
 */
const MONTH_OF: Record<string, string> = {
  'phone-375-writes': '2031-03',
  'tablet-768-writes': '2031-04',
  'desktop-1280-writes': '2031-05',
};
const monthOf = (testInfo: TestInfo) => MONTH_OF[testInfo.project.name] ?? '2031-06';
/** Repeat this week gets a month of its own: it fills every empty day after the chosen week. */
const REPEAT_MONTH_OF: Record<string, string> = {
  'phone-375-writes': '2031-09',
  'tablet-768-writes': '2031-10',
  'desktop-1280-writes': '2031-11',
};

const cell = (page: Page, date: string) => page.locator(`.feeding-grid [data-date="${date}"]`);

async function openDay(page: Page, date: string) {
  const listRow = page.locator(`.feeding-row[data-date="${date}"]`);
  if (await listRow.isVisible()) await listRow.click();
  else await cell(page, date).click();
}

async function personId(page: Page, name: string): Promise<string> {
  const users = (await (await page.request.get('/api/users')).json()) as {
    id: string;
    name: string;
  }[];
  const user = users.find((entry) => entry.name === name);
  if (user === undefined) throw new Error(`no user ${name}`);
  return user.id;
}

test('set, change and clear a day; the cell, the totals and the history follow', async ({
  page,
}, testInfo) => {
  const month = monthOf(testInfo);
  const date = `${month}-09`;
  await page.goto(`/feeding?month=${month}`);
  await openDay(page, date);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 2 })).toContainText(date);
  await dialog.getByLabel('Feeder').selectOption({ label: 'Alice' });
  await dialog.getByLabel('Note').fill('covering for the weekend');
  await expect(dialog.getByText('24/200')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: `Saved ${date}` })).toBeVisible();
  await expect(cell(page, date)).toContainText('Alice');
  await expect(page.locator('.feeding-totals')).toContainText('Alice · 1 day (');
  // Focus is back on the day that was opened.
  await expect(cell(page, date)).toBeFocused();

  await openDay(page, date);
  await expect(dialog.getByLabel('Note')).toHaveValue('covering for the weekend');
  await dialog.getByLabel('Feeder').selectOption({ label: 'Carol' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(cell(page, date)).toContainText('Carol');
  await expect(page.locator('.feeding-totals')).toContainText('Carol · 1 day');
  await expect(page.locator('.feeding-totals')).not.toContainText('Alice ·');

  await openDay(page, date);
  await dialog.getByText('Show history').click();
  const history = dialog.locator('.feeding-history li');
  await expect(history).toHaveCount(2);
  await expect(history.first()).toContainText('Carol');
  await expect(history.nth(1)).toContainText('Alice');
  await expect(history.nth(1)).toContainText('replaced by Bob');

  await dialog.getByLabel('Feeder').selectOption({ label: '— Nobody —' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toContainText(`Clear ${date}`.replace(date, ''));
  await expect(page.getByRole('dialog')).toContainText('(Carol)?');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(cell(page, date)).not.toContainText('Carol');
  await expect(page.locator('.feeding-totals')).toContainText('Nobody is assigned');
});

test('a day changed by someone else is refused, offered again after Reload, and the second save works', async ({
  page,
  baseURL,
}, testInfo) => {
  const month = monthOf(testInfo);
  const date = `${month}-12`;
  await page.goto(`/feeding?month=${month}`);
  await openDay(page, date);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Feeder').selectOption({ label: 'Alice' });

  // Meanwhile Dan, in another browser, sets the same day.
  const other = await playwrightRequest.newContext({ baseURL: baseURL ?? 'http://localhost:8788' });
  await signInRequest(other, 'Dan');
  const dan = (await (await other.get('/api/users')).json()) as { id: string; name: string }[];
  const put = await other.put(`/api/feeding/days/${date}`, {
    data: { userId: dan.find((entry) => entry.name === 'Dan')?.id, expectedAssignmentId: null },
  });
  expect(put.ok()).toBe(true);
  await other.dispose();

  await dialog.getByRole('button', { name: 'Save' }).click();
  const problem = dialog.getByRole('alert');
  await expect(problem).toContainText('This day was changed by Dan at');
  await expect(problem).toContainText('Reload to see the change, then try again.');
  await problem.getByRole('button', { name: 'Reload this day' }).click();
  await expect(dialog.getByLabel('Feeder')).toHaveValue(/.+/);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog).toContainText('Last changed by Dan on');
  await dialog.getByLabel('Feeder').selectOption({ label: 'Alice' });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(cell(page, date)).toContainText('Alice');
  await openDay(page, date);
  await dialog.getByText('Show history').click();
  await expect(dialog.locator('.feeding-history li')).toHaveCount(2);
  await expect(dialog.locator('.feeding-history li').nth(1)).toContainText('Dan');
});

test('Repeat this week fills the empty days after the week and keeps the assigned ones', async ({
  page,
}, testInfo) => {
  const month = REPEAT_MONTH_OF[testInfo.project.name] ?? '2031-12';
  const alice = await personId(page, 'Alice');
  const carol = await personId(page, 'Carol');
  // The first full week of the month starts on a Sunday; Mon, Tue and Fri get a feeder.
  const weeks = (await (await page.request.get(`/api/feeding?month=${month}`)).json()) as {
    days: { date: string; weekday: string }[];
  };
  const firstSunday = weeks.days.find((day) => day.weekday === 'Sunday')?.date ?? '';
  const at = (offset: number) => {
    const d = new Date(`${firstSunday}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  for (const [offset, userId] of [
    [1, alice],
    [2, carol],
    [5, alice],
  ] as const) {
    const response = await page.request.put(`/api/feeding/days/${at(offset)}`, {
      data: { userId, expectedAssignmentId: null },
    });
    expect(response.ok()).toBe(true);
  }
  // One later Monday already has someone else: it must be kept.
  await page.request.put(`/api/feeding/days/${at(8)}`, {
    data: { userId: carol, expectedAssignmentId: null },
  });
  const dry = (await (
    await page.request.post('/api/feeding/repeat-week', {
      data: { weekStart: firstSunday, month, overwrite: false, dryRun: true },
    })
  ).json()) as { filled: number; kept: number };

  await page.goto(
    `/feeding?month=${month}${testInfo.project.name.startsWith('phone') ? '&view=list' : ''}`,
  );
  if (testInfo.project.name.startsWith('phone'))
    await page
      .locator('.feeding-list__heading', { hasText: firstSunday })
      .getByRole('button', { name: 'Repeat this week…' })
      .click();
  else {
    await page
      .locator('.feeding-grid tbody tr', { has: page.locator(`[data-date="${at(1)}"]`) })
      .getByRole('button', { name: /Repeat this week/ })
      .click();
  }
  const dialog = page.getByRole('dialog');
  const preview = dialog.getByTestId('feeding-repeat-preview');
  await expect(preview).toContainText(
    `Will fill ${String(dry.filled)} empty days; ${String(dry.kept)} already assigned day`,
  );
  expect(dry.kept).toBe(1);
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('status').filter({ hasText: `Filled ${String(dry.filled)}` }),
  ).toBeVisible();
  const later = (await (await page.request.get(`/api/feeding?month=${month}`)).json()) as {
    days: { date: string; assignment: { userName: string } | null }[];
  };
  const byDate = new Map(later.days.map((day) => [day.date, day.assignment?.userName ?? null]));
  expect(byDate.get(at(8))).toBe('Carol');
  expect(byDate.get(at(9))).toBe('Carol');
  expect(byDate.get(at(12))).toBe('Alice');
  expect(byDate.get(at(15))).toBe('Alice');
});
