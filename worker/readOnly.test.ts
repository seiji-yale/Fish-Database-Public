import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { getSetting } from './db/queries/settings';
import { browser, type ErrorBody } from './testBrowser';
import { createMigratedDb } from './db/testing/testDb';

async function setup(name = 'Admin') {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  const s = browser(db);
  await s.actAs(name);
  return { ...s, db };
}

/** Turns read-only mode on (the signed-in Admin is the author, BR-5). */
async function turnOn(s: Awaited<ReturnType<typeof setup>>, enabled = true) {
  return s.call('/api/admin/read-only', { enabled }, 'PUT');
}

describe('read-only mode (T-021)', () => {
  it('is off by default and the session says so to everyone', async () => {
    const s = await setup('Guest');
    expect(await (await s.call('/api/session')).json<{ readOnly: boolean }>()).toMatchObject({
      readOnly: false,
    });
  });

  it('is for Admins only and writes an activity', async () => {
    const member = await setup('Bob');
    expect((await turnOn(member)).status).toBe(403);
    const s = await setup();
    expect((await turnOn(s)).status).toBe(200);
    expect(await getSetting(s.db, 'read_only')).toBe('1');
    const activity = await s.db
      .prepare("SELECT summary FROM activities WHERE summary LIKE 'Read-only%' ORDER BY rowid DESC")
      .first<{ summary: string }>();
    expect(activity?.summary).toContain('turned on');
    expect((await turnOn(s)).status).toBe(400); // already on: nothing to change
    expect(
      (await s.call('/api/admin/overview').then((r) => r.json<{ readOnly: boolean }>())).readOnly,
    ).toBe(true);
    expect((await turnOn(s, false)).status).toBe(200);
    expect(await getSetting(s.db, 'read_only')).toBeNull();
  });

  it('refuses every write with 503 and a clear message, but keeps reading, signing in, Export now and the switch', async () => {
    const s = await setup();
    await turnOn(s);
    const refused = await s.call('/api/lines', { name: 'x' });
    expect(refused.status).toBe(503);
    const body = (await refused.json<ErrorBody>()).error;
    expect(body.code).toBe('READ_ONLY');
    expect(body.message).toContain('read-only');
    expect((await s.call('/api/lines/fx-demo_c3', { note: 'x' }, 'PATCH')).status).toBe(503);
    expect((await s.call('/api/admin/users', { name: 'New', role: 'member' })).status).toBe(503);
    expect((await s.call('/api/messages', { body: 'hi' })).status).toBe(503);
    // Still open:
    expect((await s.call('/api/lines')).status).toBe(200);
    expect((await s.call('/api/session')).status).toBe(200);
    expect((await s.call('/api/admin/mirror/run', {})).status).toBe(409); // not connected, but not blocked
    expect((await s.call('/api/messages/read-all', {})).status).not.toBe(503);
    // Signing in still works (it records failed attempts, but changes no lab data).
    await s.actAs('Bob');
    await s.actAs('Admin');
    // And everything works again once it is off.
    await turnOn(s, false);
    expect((await s.call('/api/messages', { body: 'hi' })).status).not.toBe(503);
  });

  it('marks nothing as changed for the Dropbox copy when a write is refused', async () => {
    const s = await setup();
    await turnOn(s);
    await s.db.prepare("DELETE FROM settings WHERE key = 'mirror_dirty_at'").run();
    await s.call('/api/lines', { name: 'x' });
    expect(await getSetting(s.db, 'mirror_dirty_at')).toBeNull();
  });
});
