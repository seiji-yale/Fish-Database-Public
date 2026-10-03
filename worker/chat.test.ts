import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { createMigratedDb } from './db/testing/testDb';
import { browser } from './testBrowser';

async function setup() {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  return browser(db);
}

describe('T-017 chat endpoints', () => {
  it('records the signed-in Admin as the message author, not via Admin (BR-5, ADR-0005)', async () => {
    const client = await setup();
    const adminId = await client.actAs('Admin');
    const posted = await client.call('/api/lines/fx-demo_c3/messages', {
      body: 'Please check this.',
      chosenUserId: await client.idOf('Alice'),
    });
    expect(posted.status).toBe(201);
    const row = await client.db
      .prepare('SELECT user_id, via_admin FROM chat_messages')
      .first<{ user_id: string; via_admin: number }>();
    expect(row).toEqual({ user_id: adminId, via_admin: 0 });
    const activity = await client.db
      .prepare('SELECT type, user_id, via_admin FROM activities WHERE ref_type = ?')
      .bind('chat_message')
      .first<{ type: string; user_id: string; via_admin: number }>();
    expect(activity).toEqual({ type: 'chat_posted', user_id: adminId, via_admin: 0 });
  });

  it('refuses Guest chat (OQ-40), validates message and request type, and soft removes edited messages', async () => {
    const client = await setup();
    await client.actAs('Guest');
    const guest = await client.call('/api/messages', { body: 'Hello from outside.' });
    expect(guest.status).toBe(403);
    await client.actAs('Carol');
    expect((await client.call('/api/messages', { body: '   ' })).status).toBe(400);
    expect(
      (await client.call('/api/messages', { body: 'Request', requestType: 'Unknown' })).status,
    ).toBe(400);
    const response = await client.call('/api/messages', {
      body: 'Need help with fish.',
      requestType: 'Other',
    });
    expect(response.status).toBe(201);
    const { id } = await response.json<{ id: string }>();
    expect(
      (await client.call(`/api/messages/${id}`, { body: 'Updated message' }, 'PATCH')).status,
    ).toBe(200);
    expect((await client.call(`/api/messages/${id}`, undefined, 'DELETE')).status).toBe(204);
    const list = await client.call('/api/messages');
    const page = await list.json<{
      items: { id: string; body: string; deleted_at: string | null }[];
    }>();
    expect(page.items[0]).toMatchObject({ id, body: 'This message is no longer available.' });
    expect(page.items[0]?.deleted_at).not.toBeNull();
    expect(
      await client.db
        .prepare('SELECT COUNT(*) AS count FROM chat_messages')
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
  });

  it('rejects an edit after 16 minutes and prevents another user from editing', async () => {
    const client = await setup();
    const authorId = await client.actAs('Bob');
    const posted = await client.call('/api/messages', { body: 'Original' });
    const { id } = await posted.json<{ id: string }>();
    await client.actAs('Alice');
    expect(
      (await client.call(`/api/messages/${id}`, { body: 'Other author' }, 'PATCH')).status,
    ).toBe(403);
    await client.db
      .prepare('UPDATE chat_messages SET created_at = ? WHERE id = ?')
      .bind(new Date(Date.now() - 16 * 60_000).toISOString().replace('.000Z', 'Z'), id)
      .run();
    await client.actAs('Bob');
    const expired = await client.call(`/api/messages/${id}`, { body: 'Too late' }, 'PATCH');
    expect(expired.status).toBe(403);
    expect(await expired.json<{ error: { code: string } }>()).toMatchObject({
      error: { code: 'EDIT_WINDOW_EXPIRED' },
    });
    expect(
      (
        await client.db
          .prepare('SELECT user_id FROM chat_messages WHERE id = ?')
          .bind(id)
          .first<{ user_id: string }>()
      )?.user_id,
    ).toBe(authorId);
  });

  it('marks other messages read idempotently, lets users revoke marks, and rejects own reads', async () => {
    const client = await setup();
    const bobId = await client.actAs('Bob');
    const posted = await client.call('/api/lines/fx-demo_c3/messages', {
      body: '@Alice Read this',
    });
    const { id } = await posted.json<{ id: string }>();
    expect((await client.call(`/api/messages/${id}/read`, undefined, 'POST')).status).toBe(403);
    const dashboardBefore = await (
      await client.call('/api/dashboard')
    ).json<{ counters: { unreadMessages: number } }>();
    expect(dashboardBefore.counters.unreadMessages).toBe(0);
    const aliceId = await client.actAs('Alice');
    await client.call(`/api/messages/${id}/read`, undefined, 'POST');
    const list = await (
      await client.call('/api/lines/fx-demo_c3/messages')
    ).json<{ items: { reads: { userId: string }[]; readByMe: boolean }[] }>();
    expect(list.items[0]).toMatchObject({ reads: [{ userId: aliceId }], readByMe: true });
    await client.call(`/api/messages/${id}/read`, undefined, 'POST');
    expect(
      await client.db
        .prepare(
          'SELECT COUNT(*) AS count FROM chat_read_state WHERE message_id = ? AND deleted_at IS NULL',
        )
        .bind(id)
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
    await client.call(`/api/messages/${id}/read`, undefined, 'DELETE');
    const dashboardAfter = await (
      await client.call('/api/dashboard')
    ).json<{ counters: { unreadMessages: number } }>();
    expect(dashboardAfter.counters.unreadMessages).toBe(1);
    expect(
      (
        await client.db
          .prepare(
            'SELECT user_id FROM chat_read_state WHERE message_id = ? AND deleted_at IS NOT NULL',
          )
          .bind(id)
          .first<{ user_id: string }>()
      )?.user_id,
    ).toBe(aliceId);
    expect(bobId).not.toBe(aliceId);
  });

  it('keeps request completion idempotent and counts open requests', async () => {
    const client = await setup();
    const bobId = await client.actAs('Bob');
    const posted = await client.call('/api/lines/fx-demo_c3/messages', {
      body: 'Set up an out-cross.',
      requestType: 'Set up cross',
    });
    const { id } = await posted.json<{ id: string }>();
    const open = await (
      await client.call('/api/messages/unread-count')
    ).json<{ openRequests: number }>();
    expect(open.openRequests).toBe(1);
    const perLine = await (
      await client.call('/api/lines/fx-demo_c3/messages')
    ).json<{ openRequestCount: number }>();
    expect(perLine.openRequestCount).toBe(1);
    const done1 = await client.call(`/api/messages/${id}/request`, { status: 'done' }, 'PATCH');
    expect(await done1.json()).toMatchObject({ status: 'done', doneBy: 'Bob' });
    const done2 = await client.call(`/api/messages/${id}/request`, { status: 'done' }, 'PATCH');
    expect(await done2.json()).toMatchObject({ status: 'done' });
    expect(
      await client.db
        .prepare("SELECT COUNT(*) AS count FROM activities WHERE type = 'request_done'")
        .first<{ count: number }>(),
    ).toEqual({ count: 1 });
    const closed = await (
      await client.call('/api/messages/unread-count')
    ).json<{ openRequests: number }>();
    expect(closed.openRequests).toBe(0);
    const closedOnLine = await (
      await client.call('/api/lines/fx-demo_c3/messages')
    ).json<{ openRequestCount: number }>();
    expect(closedOnLine.openRequestCount).toBe(0);
    await client.actAs('Admin');
    const reopen = await client.call(`/api/messages/${id}/request`, { status: 'open' }, 'PATCH');
    expect(await reopen.json()).toMatchObject({ status: 'open' });
    expect(bobId).not.toBe(await client.idOf('Admin'));
  });

  it('notifies only mentioned users and expands @all to active users except the author', async () => {
    const client = await setup();
    const bobId = await client.actAs('Bob');
    const aliceId = await client.idOf('Alice');
    const danId = await client.idOf('Dan');
    const explicit = await client.call('/api/messages', {
      body: 'Please check, @Alice and @Dan. @Erin @Alicex',
    });
    const explicitId = (await explicit.json<{ id: string }>()).id;
    const firstPage = await (
      await client.call('/api/messages')
    ).json<{ items: { id: string; mentions: { userId: string; userName: string }[] }[] }>();
    const mentions = firstPage.items.find((item) => item.id === explicitId)?.mentions;
    expect(mentions).toHaveLength(2);
    expect(mentions).toEqual(
      expect.arrayContaining([
        { userId: danId, userName: 'Dan' },
        { userId: aliceId, userName: 'Alice' },
      ]),
    );

    await client.actAs('Alice');
    expect(
      (await (await client.call('/api/messages/unread-count')).json<{ unread: number }>()).unread,
    ).toBe(1);
    await client.actAs('Guest');
    expect(
      (await (await client.call('/api/messages/unread-count')).json<{ unread: number }>()).unread,
    ).toBe(0);

    await client.actAs('Bob');
    const all = await client.call('/api/messages', { body: 'Please review this, @ALL.' });
    const allId = (await all.json<{ id: string }>()).id;
    const recipients = await client.db
      .prepare(
        'SELECT user_id FROM chat_mentions WHERE message_id = ? AND deleted_at IS NULL ORDER BY user_id',
      )
      .bind(allId)
      .all<{ user_id: string }>();
    expect(recipients.results.map((row) => row.user_id)).toEqual(
      [
        await client.idOf('Guest'),
        await client.idOf('Dan'),
        await client.idOf('Carol'),
        await client.idOf('Alice'),
      ].sort(),
    );
    expect(recipients.results.map((row) => row.user_id)).not.toContain(bobId);
  });

  it('replaces mention recipients when an author edits a message', async () => {
    const client = await setup();
    await client.actAs('Bob');
    const posted = await client.call('/api/messages', { body: '@Alice Original note' });
    const { id } = await posted.json<{ id: string }>();
    await client.call(`/api/messages/${id}`, { body: '@Dan Updated note' }, 'PATCH');

    const mentions = await client.db
      .prepare('SELECT user_id, deleted_at FROM chat_mentions WHERE message_id = ? ORDER BY rowid')
      .bind(id)
      .all<{ user_id: string; deleted_at: string | null }>();
    expect(mentions.results[0]).toMatchObject({ user_id: await client.idOf('Alice') });
    expect(typeof mentions.results[0]?.deleted_at).toBe('string');
    expect(mentions.results[1]).toEqual({
      user_id: await client.idOf('Dan'),
      deleted_at: null,
    });

    await client.actAs('Alice');
    expect(
      (await (await client.call('/api/messages/unread-count')).json<{ unread: number }>()).unread,
    ).toBe(0);
    await client.actAs('Dan');
    expect(
      (await (await client.call('/api/messages/unread-count')).json<{ unread: number }>()).unread,
    ).toBe(1);
  });

  it('marks all unread mentions as read once and leaves unmentioned messages out of the badge', async () => {
    const client = await setup();
    const aliceId = await client.actAs('Alice');
    await client.actAs('Bob');
    await client.call('/api/messages', { body: '@Alice First message' });
    await client.call('/api/lines/fx-demo_c3/messages', { body: '@all Second message' });
    await client.call('/api/messages', { body: 'No one is mentioned' });

    await client.actAs('Alice');
    const before = await (
      await client.call('/api/messages/unread-count')
    ).json<{ unread: number }>();
    expect(before.unread).toBe(2);
    const marked = await client.call('/api/messages/read-all', undefined, 'POST');
    expect(marked.status).toBe(200);
    expect(await marked.json()).toEqual({ marked: 2 });
    const after = await (
      await client.call('/api/messages/unread-count')
    ).json<{ unread: number }>();
    expect(after.unread).toBe(0);
    const repeated = await client.call('/api/messages/read-all', undefined, 'POST');
    expect(await repeated.json()).toEqual({ marked: 0 });
    expect(
      await client.db
        .prepare(
          'SELECT COUNT(*) AS count FROM chat_read_state WHERE user_id = ? AND deleted_at IS NULL',
        )
        .bind(aliceId)
        .first<{ count: number }>(),
    ).toEqual({ count: 2 });
    expect(
      await client.db
        .prepare('SELECT COUNT(*) AS count FROM chat_reads WHERE user_id = ?')
        .bind(aliceId)
        .first<{ count: number }>(),
    ).toEqual({ count: 2 });
  });

  it('paginates older messages, supports lab-wide chat, and validates the line', async () => {
    const client = await setup();
    await client.actAs('Dan');
    const ids: string[] = [];
    for (let index = 0; index < 32; index += 1) {
      const response = await client.call('/api/lines/fx-demo_c3/messages', {
        body: `Message ${String(index)}`,
      });
      ids.push((await response.json<{ id: string }>()).id);
    }
    const newest = await (
      await client.call('/api/lines/fx-demo_c3/messages')
    ).json<{ items: { id: string }[]; nextBefore: string | null }>();
    expect(newest.items).toHaveLength(30);
    expect(newest.nextBefore).not.toBeNull();
    const older = await (
      await client.call(
        `/api/lines/fx-demo_c3/messages?before=${encodeURIComponent(newest.nextBefore ?? '')}`,
      )
    ).json<{ items: { id: string }[]; nextBefore: string | null }>();
    expect(older.items.map((item) => item.id)).toEqual([...ids].sort().slice(0, 2));
    expect(older.nextBefore).toBeNull();
    expect((await client.call('/api/lines/missing/messages')).status).toBe(404);
    expect((await client.call('/api/messages', { body: 'Lab message' })).status).toBe(201);
    const lab = await (
      await client.call('/api/messages')
    ).json<{ items: { line_id: string | null }[] }>();
    expect(lab.items).toHaveLength(1);
    expect(lab.items[0]?.line_id).toBeNull();
  });
});
