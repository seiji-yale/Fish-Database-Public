import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { TestInfo } from '@playwright/test';

function shortMessage(testInfo: TestInfo) {
  const viewport = testInfo.project.name.replace('-writes', '').replace(/^\w+-/, '').slice(0, 1);
  return `Chat ${viewport}${String(Date.now()).slice(-4)}`;
}

test('T-017: a request is shared between two users, read state is visible, and status can be completed', async ({
  page,
  browser,
}, testInfo) => {
  const message = `@Bob ${shortMessage(testInfo)}`;
  await actAs(page, 'Alice');
  await page.goto('/lines/fx-demo_c3');
  const composer = page.getByLabel('Write a message', { exact: true }).first();
  await composer.fill(message);
  await page
    .getByLabel('Request (optional)', { exact: true })
    .selectOption({ label: 'Set up cross' });
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(message, { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText('Set up cross · Open request', { exact: true }).first(),
  ).toBeVisible();

  const otherContext = await browser.newContext({ baseURL: 'http://localhost:8788' });
  const otherPage = await otherContext.newPage();
  try {
    await actAs(otherPage, 'Bob');
    const unreadBefore = (await (
      await otherPage.request.get('/api/messages/unread-count')
    ).json()) as { unread: number };
    await otherPage.goto('/lines/fx-demo_c3');
    const targetMessage = otherPage.locator('.chat-message').filter({ hasText: message });
    await expect(targetMessage).toBeVisible();
    await expect(
      otherPage.getByRole('link', {
        name: `${String(unreadBefore.unread)} unread chat message${unreadBefore.unread === 1 ? '' : 's'}`,
        exact: true,
      }),
    ).toBeVisible();
    await targetMessage.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(targetMessage.getByText('Read by Bob', { exact: true })).toBeVisible();
    await expect(
      otherPage.getByRole('link', {
        name: `${String(unreadBefore.unread - 1)} unread chat message${unreadBefore.unread - 1 === 1 ? '' : 's'}`,
        exact: true,
      }),
    ).toBeVisible();
    await targetMessage.getByRole('button', { name: 'Mark unread', exact: true }).click();
    await expect(
      otherPage.getByRole('link', {
        name: `${String(unreadBefore.unread)} unread chat message${unreadBefore.unread === 1 ? '' : 's'}`,
        exact: true,
      }),
    ).toBeVisible();
    const targetRequest = otherPage.locator('.chat-request').filter({ hasText: message });
    await targetRequest.getByRole('button', { name: 'Mark done', exact: true }).click();
    await expect(targetMessage.getByText('Set up cross · Done', { exact: true })).toBeVisible();
    await expect(
      otherPage.getByRole('link', {
        name: `${String(unreadBefore.unread - 1)} unread chat message${unreadBefore.unread - 1 === 1 ? '' : 's'}`,
        exact: true,
      }),
    ).toBeVisible();
    await page.reload();
    const authorMessage = page.locator('.chat-message').filter({ hasText: message });
    await expect(authorMessage.getByText('Read by Bob', { exact: true })).toBeVisible();
    await expect(authorMessage.getByText('Set up cross · Done', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  } finally {
    await otherContext.close();
  }
});

test('T-017: an Admin posts as themselves, with no "who sends" dialog (ADR-0005)', async ({
  page,
}) => {
  await actAs(page, 'Admin');
  await page.goto('/lines/fx-demo_c3');
  const text = `Admin chat ${String(Date.now()).slice(-5)}`;
  await page.getByLabel('Write a message', { exact: true }).first().fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(text, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('T-027: a Guest reads the chat but has no message box', async ({ page }) => {
  await actAs(page, 'Guest');
  await page.goto('/lines/fx-demo_c3');
  await expect(page.getByLabel('Write a message', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText('Guests can read messages but cannot write them.').first(),
  ).toBeVisible();
});

test('T-023 Part D: Shift+Enter sends a message, Enter starts a new line, and an empty box sends nothing', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Alice');
  await page.goto('/lines/fx-demo_c3');
  const composer = page.getByLabel('Write a message', { exact: true }).first();
  const first = `Shift ${shortMessage(testInfo)}`;
  await composer.click();
  // Shift+Enter in an empty box sends nothing.
  await page.keyboard.press('Shift+Enter');
  await expect(composer).toHaveValue('');
  await page.keyboard.type(first);
  await page.keyboard.press('Enter');
  await page.keyboard.type('second line');
  await expect(composer).toHaveValue(`${first}\nsecond line`);
  await page.keyboard.press('Shift+Enter');
  await expect(composer).toHaveValue('');
  await expect(page.getByText('second line').first()).toBeVisible();
  await expect(page.getByText(first, { exact: false }).first()).toBeVisible();

  // Editing a message: Shift+Enter saves it too.
  await page
    .locator('.chat-message')
    .filter({ hasText: 'second line' })
    .first()
    .getByRole('button', { name: 'Edit' })
    .click();
  const editor = page.locator('.chat-edit-form textarea');
  await editor.fill(`${first} edited`);
  await editor.press('Shift+Enter');
  await expect(page.getByText(`${first} edited`).first()).toBeVisible();
  await expect(page.locator('.chat-edit-form')).toHaveCount(0);
});
