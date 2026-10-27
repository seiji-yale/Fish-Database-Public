import { expect, test, type Page, type TestInfo } from '@playwright/test';

/**
 * T-037, owner acceptance 1 to 3: schedule events in the Day dialog: a one-off, a weekly repeat across a
 * month boundary, both delete scopes and both edit scopes. Each viewport works in two months of its own.
 */
const MONTHS: Record<string, [string, string]> = {
  'phone-375-writes': ['2032-03', '2032-04'],
  'tablet-768-writes': ['2032-05', '2032-06'],
  'desktop-1280-writes': ['2032-07', '2032-08'],
};
const monthsOf = (testInfo: TestInfo): [string, string] =>
  MONTHS[testInfo.project.name] ?? ['2032-09', '2032-10'];

interface ApiMonth {
  days: {
    date: string;
    weekday: string;
    events: { id: string; title: string; followingCount: number }[];
  }[];
}
const getMonth = async (page: Page, month: string) =>
  (await (await page.request.get(`/api/feeding?month=${month}`)).json()) as ApiMonth;

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const lastOf = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y ?? 0, m ?? 0, 0)).toISOString().slice(0, 10);
};

async function openDay(page: Page, date: string) {
  await page.locator(`.feeding-grid [data-date="${date}"]`).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** The dates (YYYY-MM-DD) carrying an event with this title, over some months, from the API. */
async function datesWith(page: Page, months: string[], title: string): Promise<string[]> {
  const found: string[] = [];
  for (const month of months)
    for (const day of (await getMonth(page, month)).days)
      if (day.events.some((event) => event.title === title)) found.push(day.date);
  return found;
}

test('a one-off event: add, edit and remove with one confirmation', async ({ page }, testInfo) => {
  const [month] = monthsOf(testInfo);
  const date = `${month}-10`;
  await page.goto(`/feeding?month=${month}`);
  await openDay(page, date);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('No events on this day.')).toBeVisible();
  await dialog.getByRole('button', { name: '+ Add event' }).click();
  await dialog.getByLabel('Title').fill('Inspection');
  await dialog.getByLabel('Event note').fill('Bring the badge');
  await expect(dialog.getByLabel('Repeat weekly')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event added' })).toBeVisible();
  await expect(dialog.locator('.feeding-events__item')).toContainText('Inspection');
  await expect(dialog.locator('.feeding-events__item')).toContainText('Bring the badge');
  await expect(dialog.locator('.feeding-events__item')).not.toContainText('Repeats weekly');
  expect(await datesWith(page, [month], 'Inspection')).toEqual([date]);

  await dialog.getByRole('button', { name: 'Edit: Inspection' }).click();
  await expect(dialog.getByText('This and all following')).toHaveCount(0);
  await dialog.getByLabel('Title').fill('Fire inspection');
  await dialog.getByRole('button', { name: 'Save event' }).click();
  await expect(dialog.locator('.feeding-events__item')).toContainText('Fire inspection');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  // The cell shows the label (a dot on a phone); the List view shows the full text.
  const cell = page.locator(`.feeding-grid [data-date="${date}"]`);
  if (!testInfo.project.name.startsWith('phone'))
    await expect(cell).toContainText('Fire inspection');
  else await expect(cell.locator('.feeding-cell__event-dot')).toBeVisible();

  await openDay(page, date);
  await dialog.getByRole('button', { name: 'Remove: Fire inspection' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('button', { name: 'Delete this event' })).toBeVisible();
  await expect(confirm.getByRole('button', { name: /and all following/ })).toHaveCount(0);
  await confirm.getByRole('button', { name: 'Delete this event' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event removed' })).toBeVisible();
  await expect(dialog.getByText('No events on this day.')).toBeVisible();
  expect(await datesWith(page, [month], 'Fire inspection')).toEqual([]);
});

test('a weekly repeat across a month boundary shows on every Monday; both delete scopes; both edit scopes', async ({
  page,
}, testInfo) => {
  const [first, second] = monthsOf(testInfo);
  const days = (await getMonth(page, first)).days;
  const monday = days.find((day) => day.weekday === 'Monday')?.date ?? '';
  const until = lastOf(second);
  const expected: string[] = [];
  for (let d = monday; d <= until; d = addDays(d, 7)) expected.push(d);
  expect(expected.length).toBeGreaterThan(6);

  await page.goto(`/feeding?month=${first}`);
  await openDay(page, monday);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '+ Add event' }).click();
  await dialog.getByLabel('Title').fill('Test Water Quality');
  await dialog.getByLabel('Repeat weekly').check();
  await expect(dialog.getByLabel('Repeat until')).toHaveValue(lastOf(first));
  await dialog.getByLabel('Repeat until').fill(until);
  const preview = dialog.getByTestId('feeding-event-preview');
  await expect(preview).toHaveText(
    `Will add ${String(expected.length)} events, every Monday until ${expected[expected.length - 1] ?? ''}.`,
  );
  await dialog.getByRole('button', { name: 'Save event' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: `${String(expected.length)} events added` }),
  ).toBeVisible();
  expect(await datesWith(page, [first, second], 'Test Water Quality')).toEqual(expected);
  await expect(dialog.locator('.feeding-events__item')).toContainText('Repeats weekly');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // The CSV lists the title on each of its days (first month shown here).
  const csv = await (await page.request.get(`/api/feeding/summary.csv?month=${first}`)).text();
  for (const date of expected.filter((d) => d.startsWith(first)))
    expect(csv).toContain(`day,${date},Monday,,,Test Water Quality`);

  // List and print views show the label as well.
  await page.goto(`/feeding/print?month=${first}`);
  await expect(
    page.locator('.feeding-print__event', { hasText: 'Test Water Quality' }),
  ).toHaveCount(expected.filter((d) => d.startsWith(first)).length);

  // Delete only the second Monday.
  await page.goto(`/feeding?month=${first}`);
  const [m1, m2, m3, m4] = expected as [string, string, string, string];
  await openDay(page, m2);
  await dialog.getByRole('button', { name: 'Remove: Test Water Quality' }).click();
  await expect(
    dialog.getByRole('button', { name: /Delete this and all following \(\d+\)/ }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete this event', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event removed' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await datesWith(page, [first, second], 'Test Water Quality')).toEqual(
    expected.filter((d) => d !== m2),
  );

  // Edit this and all following from the third Monday: the title changes from there on.
  await openDay(page, m3);
  await dialog.getByRole('button', { name: 'Edit: Test Water Quality' }).click();
  await dialog.getByLabel('Title').fill('Water test');
  await dialog.getByLabel(/This and all following/).check();
  await dialog.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'events updated' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await datesWith(page, [first, second], 'Water test')).toEqual(
    expected.filter((d) => d >= m3),
  );
  expect(await datesWith(page, [first, second], 'Test Water Quality')).toEqual([
    m1,
    ...expected.filter((d) => d < m3 && d !== m1 && d !== m2),
  ]);

  // Edit one event only (the fourth Monday): the others keep their title.
  await openDay(page, m4);
  await dialog.getByRole('button', { name: 'Edit: Water test' }).click();
  await dialog.getByLabel('Title').fill('Water test (moved)');
  await dialog.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Event updated' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await datesWith(page, [first, second], 'Water test (moved)')).toEqual([m4]);

  // Delete this and all following from the third Monday: it and every later one go, the first stays.
  await openDay(page, m3);
  await dialog.getByRole('button', { name: 'Remove: Water test' }).click();
  await dialog.getByRole('button', { name: /Delete this and all following/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'events removed' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(await datesWith(page, [first, second], 'Water test')).toEqual([]);
  expect(await datesWith(page, [first, second], 'Water test (moved)')).toEqual([]);
  expect(await datesWith(page, [first, second], 'Test Water Quality')).toEqual([m1]);
});

test('the Title field suggests titles used before', async ({ page }, testInfo) => {
  const [, second] = monthsOf(testInfo);
  await page.request.post('/api/feeding/events', {
    data: { date: `${second}-20`, title: 'Dissection day', note: null },
  });
  await page.goto(`/feeding?month=${second}`);
  await openDay(page, `${second}-21`);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '+ Add event' }).click();
  await expect(dialog.locator('datalist option[value="Dissection day"]')).toHaveCount(1);
});
