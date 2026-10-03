import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { TestInfo } from '@playwright/test';

function unique(testInfo: TestInfo, suffix: string): string {
  const viewport = testInfo.project.name.replace('-writes', '').replace(/^(\w)\w*-/, '$1');
  return `${viewport}-${suffix}`;
}

test('History scrolls inside its box instead of growing the page; the oldest version is at the end', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const created = await page.request.post('/api/lines', {
    data: { name: unique(testInfo, 'hm'), dob: '2026-01-05' },
  });
  const { id } = (await created.json()) as { id: string };
  // Version 1 is the creation; eleven edits make twelve versions.
  for (let version = 1; version <= 11; version += 1) {
    const edit = await page.request.patch(`/api/lines/${id}`, {
      data: { expectedVersion: version, notes: `note ${String(version)}` },
    });
    expect(edit.ok()).toBe(true);
  }
  await page.goto(`/lines/${id}`);
  const list = page.locator('#history .history-list');
  await expect(page.locator('#history .history-item')).toHaveCount(12);
  await expect(
    page.locator('#history').getByRole('button', { name: /^Show (more|less)/ }),
  ).toHaveCount(0);
  // The box has a maximum height and scrolls; the newest version is first, the creation last.
  const scrolls = await list.evaluate((element) => element.scrollHeight > element.clientHeight);
  expect(scrolls).toBe(true);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  // After scrolling the box, the last version sits inside the box's visible area.
  const visible = await list.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const last = element.querySelector('.history-item:last-child')?.getBoundingClientRect();
    return last !== undefined && last.bottom <= box.bottom + 1 && last.top >= box.top - 1;
  });
  expect(visible).toBe(true);
  await expect(page.locator('#history .history-item').last()).toContainText('Line created.');
});
