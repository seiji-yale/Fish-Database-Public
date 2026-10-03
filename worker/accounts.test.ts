/** Accounts, invites and the Guest URL (ADR-0005, T-027). */
import { describe, expect, it } from 'vitest';
import { getSetting } from './db/queries/settings';
import { getUserByName } from './db/queries/users';
import { createMigratedDb } from './db/testing/testDb';
import { buildExportFiles } from './export/build';
import {
  browser,
  TEST_ADMIN,
  TEST_PASSWORD,
  testPasswordHash,
  type ErrorBody,
} from './testBrowser';

type Browser = ReturnType<typeof browser>;

const code = async (response: Response) => (await response.json<ErrorBody>()).error.code;
const sessionUser = async (s: Browser) =>
  (await (await s.call('/api/session')).json<{ user: { name: string; role: string } | null }>())
    .user;

/** Admin adds `name` with an initial password and returns the invite token. */
async function invite(
  admin: Browser,
  name: string,
  role = 'member',
  initialPassword = 'first-pass',
) {
  const response = await admin.call('/api/admin/users', { name, role, initialPassword });
  expect(response.status).toBe(201);
  return (await response.json<{ id: string; inviteToken: string }>()).inviteToken;
}

describe('signing in (ADR-0005)', () => {
  it('refuses every API call without a session, except health, session and sign-in', async () => {
    const s = browser();
    const lines = await s.call('/api/lines');
    expect(lines.status).toBe(401);
    expect(await code(lines)).toBe('LOGIN_REQUIRED');
    expect((await s.call('/api/users')).status).toBe(401);
    expect((await s.call('/api/health')).status).toBe(200);
    expect(await sessionUser(s)).toBeNull();
  });

  it('signs in by name (any case) and password, and Sign out ends it', async () => {
    const s = browser();
    await s.db
      .prepare('UPDATE users SET password_hash = ? WHERE name = ?')
      .bind(await testPasswordHash(), 'Carol')
      .run();
    expect(
      (await s.call('/api/session/login', { name: 'carol', password: TEST_PASSWORD })).status,
    ).toBe(200);
    expect(await sessionUser(s)).toEqual({
      id: expect.any(String) as string,
      name: 'Carol',
      role: 'member',
    });
    expect((await s.call('/api/lines')).status).toBe(200);
    await s.call('/api/session/logout', {});
    expect((await s.call('/api/lines')).status).toBe(401);
  });

  it('gives the same answer for an unknown name and a wrong password, and locks after 10 failures', async () => {
    const s = browser();
    await s.actAs('Carol');
    await s.call('/api/session/logout', {});
    const unknown = await s.call('/api/session/login', { name: 'Nobody', password: 'whatever1' });
    expect(unknown.status).toBe(401);
    expect(await code(unknown)).toBe('SIGN_IN_FAILED');
    for (let attempt = 1; attempt < 10; attempt += 1) {
      const wrong = await s.call('/api/session/login', { name: 'Carol', password: 'wrong-pass' });
      expect(await code(wrong)).toBe('SIGN_IN_FAILED');
    }
    const tenth = await s.call('/api/session/login', { name: 'Carol', password: 'wrong-pass' });
    expect(tenth.status).toBe(429);
    const right = await s.call('/api/session/login', { name: 'Carol', password: TEST_PASSWORD });
    expect(await code(right)).toBe('ACCOUNT_LOCKED');
  });

  it('counts parallel wrong guesses: 30 at once still lock the account', async () => {
    const s = browser();
    await s.actAs('Carol');
    await s.call('/api/session/logout', {});
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        s.call('/api/session/login', { name: 'Carol', password: 'wrong-pass' }),
      ),
    );
    expect(results.some((response) => response.status === 429)).toBe(true);
    const right = await s.call('/api/session/login', { name: 'Carol', password: TEST_PASSWORD });
    expect(right.status).toBe(429);
  });

  it('never signs anyone in as the built-in Guest or the retired built-in Admin by password', async () => {
    const s = browser();
    expect(
      (await s.call('/api/session/login', { name: 'Guest', password: 'anything1' })).status,
    ).toBe(401);
    expect((await s.call('/api/session/login', { name: 'Admin', password: 'admin' })).status).toBe(
      401,
    );
  });
});

describe('invites', () => {
  it('Admin adds a member; the invite asks for the initial password, then a new one (which may equal it), and works once', async () => {
    const admin = browser();
    await admin.actAs('Admin');
    const token = await invite(admin, 'Newbie');
    const s = browser(admin.db);
    // The initial password alone is not enough: the invite URL is needed too.
    const direct = await s.call('/api/session/login', { name: 'Newbie', password: 'first-pass' });
    expect(await code(direct)).toBe('INVITE_REQUIRED');
    expect(await (await s.call(`/api/join/${token}`)).json()).toEqual({
      name: 'Newbie',
      role: 'member',
    });
    const wrong = await s.call(`/api/join/${token}`, {
      initialPassword: 'nope',
      newPassword: 'my-own-pass',
    });
    expect(wrong.status).toBe(400);
    const short = await s.call(`/api/join/${token}`, {
      initialPassword: 'first-pass',
      newPassword: 'short',
    });
    expect(short.status).toBe(400);
    const ok = await s.call(`/api/join/${token}`, {
      initialPassword: 'first-pass',
      newPassword: 'first-pass',
    });
    expect(ok.status).toBe(200);
    expect((await sessionUser(s))?.name).toBe('Newbie');
    expect(await code(await s.call(`/api/join/${token}`))).toBe('INVITE_INVALID');
    // From now on the user signs in with the new password.
    const other = browser(admin.db);
    expect(
      (await other.call('/api/session/login', { name: 'Newbie', password: 'first-pass' })).status,
    ).toBe(200);
  });

  it('an invite expires after 7 days; a new invite retires the old one and signs the user out', async () => {
    const admin = browser();
    await admin.actAs('Admin');
    const first = await invite(admin, 'Late');
    await admin.db.prepare("UPDATE invites SET expires_at = '2000-01-01T00:00:00Z'").run();
    expect(await code(await admin.call(`/api/join/${first}`))).toBe('INVITE_INVALID');
    const late = await getUserByName(admin.db, 'Late');
    const again = await admin.call(`/api/admin/users/${late?.id ?? ''}/invite`, {
      initialPassword: 'second-pass',
    });
    expect(again.status).toBe(200);
    const { inviteToken } = await again.json<{ inviteToken: string }>();
    const s = browser(admin.db);
    expect(
      (
        await s.call(`/api/join/${inviteToken}`, {
          initialPassword: 'second-pass',
          newPassword: 'late-but-here',
        })
      ).status,
    ).toBe(200);
    // A later invite (forgotten password) ends that session.
    await admin.call(`/api/admin/users/${late?.id ?? ''}/invite`, {
      initialPassword: 'third-pass',
    });
    expect((await s.call('/api/lines')).status).toBe(401);
  });

  it('an invite works once even when two requests arrive together', async () => {
    const admin = browser();
    await admin.actAs('Admin');
    const token = await invite(admin, 'Twin');
    const body = { initialPassword: 'first-pass', newPassword: 'whichever-pw' };
    const results = await Promise.all([
      browser(admin.db).call(`/api/join/${token}`, body),
      browser(admin.db).call(`/api/join/${token}`, body),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 404]);
  });

  it("a removed user's unused invite stays dead after reactivation", async () => {
    const admin = browser();
    await admin.actAs('Admin');
    const token = await invite(admin, 'Comeback');
    const person = await getUserByName(admin.db, 'Comeback');
    const id = person?.id ?? '';
    await admin.call(`/api/admin/users/${id}`, { isActive: false }, 'PATCH');
    await admin.call(`/api/admin/users/${id}`, { isActive: true }, 'PATCH');
    expect(await code(await browser(admin.db).call(`/api/join/${token}`))).toBe('INVITE_INVALID');
  });

  it('an Admin cannot send an invite to themselves', async () => {
    const admin = browser();
    const id = await admin.actAs('Admin');
    const response = await admin.call(`/api/admin/users/${id}/invite`, {
      initialPassword: 'second-pass',
    });
    expect(response.status).toBe(400);
    expect((await admin.call('/api/lines')).status).toBe(200);
  });

  it('only Admins add users or send invites; Guest is not a role for people', async () => {
    const s = browser();
    await s.actAs('Carol');
    expect(
      (await s.call('/api/admin/users', { name: 'X', initialPassword: 'first-pass' })).status,
    ).toBe(403);
    const admin = browser(s.db);
    await admin.actAs('Admin');
    const guestRole = await admin.call('/api/admin/users', {
      name: 'X',
      role: 'guest',
      initialPassword: 'first-pass',
    });
    expect(guestRole.status).toBe(400);
  });
});

describe('removing users and roles', () => {
  it('removing a user signs them out at once; their name stays', async () => {
    const s = browser();
    const id = await s.actAs('Dan');
    const admin = browser(s.db);
    await admin.actAs('Admin');
    expect((await admin.call(`/api/admin/users/${id}`, { isActive: false }, 'PATCH')).status).toBe(
      200,
    );
    expect((await s.call('/api/lines')).status).toBe(401);
    expect((await getUserByName(s.db, 'Dan'))?.is_active).toBe(0);
  });

  it('a role change ends the sessions of that user', async () => {
    const s = browser();
    const id = await s.actAs('Alice');
    const admin = browser(s.db);
    await admin.actAs('Admin');
    await admin.call(`/api/admin/users/${id}`, { role: 'admin' }, 'PATCH');
    expect((await s.call('/api/lines')).status).toBe(401);
  });

  it('two Admins removing each other at once leave one Admin', async () => {
    const first = browser();
    const firstId = await first.actAs('Admin');
    const other = await getUserByName(first.db, 'Carol');
    await first.call(`/api/admin/users/${other?.id ?? ''}`, { role: 'admin' }, 'PATCH');
    const second = browser(first.db);
    await second.actAs('Carol');
    const results = await Promise.all([
      first.call(`/api/admin/users/${other?.id ?? ''}`, { isActive: false }, 'PATCH'),
      second.call(`/api/admin/users/${firstId}`, { isActive: false }, 'PATCH'),
    ]);
    // One request wins; the other is refused (409) or arrives signed out (401). Never both 200.
    expect(results.filter((response) => response.status === 200)).toHaveLength(1);
    const { results: admins } = await first.db
      .prepare("SELECT id FROM users WHERE role = 'admin' AND is_active = 1 AND is_builtin = 0")
      .all<{ id: string }>();
    expect(admins.length).toBeGreaterThanOrEqual(1);
  });

  it('the last active Admin cannot be removed or demoted', async () => {
    const admin = browser();
    const id = await admin.actAs('Admin');
    const demote = await admin.call(`/api/admin/users/${id}`, { role: 'member' }, 'PATCH');
    expect(demote.status).toBe(409);
    expect(await code(demote)).toBe('LAST_ADMIN');
    expect((await admin.call(`/api/admin/users/${id}`, { isActive: false }, 'PATCH')).status).toBe(
      409,
    );
    const carol = await getUserByName(admin.db, 'Carol');
    await admin.call(`/api/admin/users/${carol?.id ?? ''}`, { role: 'admin' }, 'PATCH');
    expect((await admin.call(`/api/admin/users/${id}`, { role: 'member' }, 'PATCH')).status).toBe(
      200,
    );
  });
});

describe("changing one's password", () => {
  it('needs the current password and signs out other browsers of the same user', async () => {
    const phone = browser();
    await phone.actAs('Carol');
    const laptop = browser(phone.db);
    await laptop.call('/api/session/login', { name: 'Carol', password: TEST_PASSWORD });
    const wrong = await laptop.call('/api/session/password', {
      currentPassword: 'nope',
      newPassword: 'brand-new-pw',
    });
    expect(wrong.status).toBe(400);
    const ok = await laptop.call('/api/session/password', {
      currentPassword: TEST_PASSWORD,
      newPassword: 'brand-new-pw',
    });
    expect(ok.status).toBe(200);
    expect((await laptop.call('/api/lines')).status).toBe(200);
    expect((await phone.call('/api/lines')).status).toBe(401);
  });
});

describe('deleting a removed user for good (T-030)', () => {
  it('deletes a removed person who has no history, with their invite, and frees the name', async () => {
    const admin = browser();
    await admin.actAs('Admin');
    await invite(admin, 'Fresh');
    const fresh = await getUserByName(admin.db, 'Fresh');
    const id = fresh?.id ?? '';
    const active = await admin.call(`/api/admin/users/${id}`, {}, 'DELETE');
    expect(active.status).toBe(400);
    await admin.call(`/api/admin/users/${id}`, { isActive: false }, 'PATCH');
    const done = await admin.call(`/api/admin/users/${id}`, {}, 'DELETE');
    expect(done.status).toBe(200);
    expect(await getUserByName(admin.db, 'Fresh')).toBeNull();
    expect(
      await admin.db
        .prepare('SELECT COUNT(*) AS n FROM invites WHERE user_id = ?')
        .bind(id)
        .first(),
    ).toEqual({ n: 0 });
    // The same name can be invited again as a new person.
    expect(
      (await admin.call('/api/admin/users', { name: 'Fresh', initialPassword: 'first-pass' }))
        .status,
    ).toBe(201);
  });

  it('keeps a person who appears in History, and never deletes built-ins, yourself or an active user', async () => {
    const admin = browser();
    const adminId = await admin.actAs('Admin');
    const carol = await getUserByName(admin.db, 'Carol');
    const id = carol?.id ?? '';
    const other = browser(admin.db);
    await other.actAs('Carol');
    expect((await other.call('/api/messages', { body: 'hello' })).status).toBe(201);
    await admin.call(`/api/admin/users/${id}`, { isActive: false }, 'PATCH');
    const kept = await admin.call(`/api/admin/users/${id}`, {}, 'DELETE');
    expect(kept.status).toBe(409);
    expect(await code(kept)).toBe('USER_HAS_HISTORY');
    expect(await getUserByName(admin.db, 'Carol')).not.toBeNull();
    const guest = await getUserByName(admin.db, 'Guest');
    expect((await admin.call(`/api/admin/users/${guest?.id ?? ''}`, {}, 'DELETE')).status).toBe(
      409,
    );
    expect((await admin.call(`/api/admin/users/${adminId}`, {}, 'DELETE')).status).toBe(400);
    expect((await admin.call('/api/admin/users/nope', {}, 'DELETE')).status).toBe(404);
    const member = browser(admin.db);
    await member.actAs('Dan');
    expect((await member.call(`/api/admin/users/${id}`, {}, 'DELETE')).status).toBe(403);
  });

  it('can delete a seeded member nobody ever used (Erin has no rows of her own)', async () => {
    const admin = browser();
    await admin.actAs('Admin');
    const erin = await getUserByName(admin.db, 'Erin');
    expect((await admin.call(`/api/admin/users/${erin?.id ?? ''}`, {}, 'DELETE')).status).toBe(200);
  });
});

describe('the Guest URL', () => {
  it('signs in as Guest without a password: reads, but no data change and no chat', async () => {
    const s = browser();
    await s.actAs('Guest');
    expect(await sessionUser(s)).toMatchObject({ name: 'Guest', role: 'guest' });
    expect((await s.call('/api/lines')).status).toBe(200);
    const write = await s.call('/api/lines', { name: 'guest-line' });
    expect(write.status).toBe(403);
    const chat = await s.call('/api/messages', { body: 'hello' });
    expect(chat.status).toBe(403);
    expect((await s.call('/api/guest-link')).status).toBe(403);
    expect(
      (await s.call('/api/session/password', { currentPassword: 'x', newPassword: 'whatever-pw' }))
        .status,
    ).toBe(403);
  });

  it('refuses a wrong token; any member can copy the link; rotating ends Guest sessions', async () => {
    const s = browser();
    expect((await s.call('/api/guest/not-the-token', {})).status).toBe(404);
    const member = browser(s.db);
    await member.actAs('Carol');
    const { token } = await (await member.call('/api/guest-link')).json<{ token: string }>();
    expect(token).toBe(await getSetting(s.db, 'guest_link_token'));
    await s.call(`/api/guest/${token}`, {});
    expect((await s.call('/api/lines')).status).toBe(200);
    const admin = browser(s.db);
    await admin.actAs('Admin');
    expect((await admin.call('/api/admin/guest-link/rotate', {})).status).toBe(200);
    expect((await s.call('/api/lines')).status).toBe(401);
    expect((await s.call(`/api/guest/${token}`, {})).status).toBe(404);
    expect((await member.call('/api/admin/guest-link/rotate', {})).status).toBe(403);
  });
});

describe('authorship (BR-5, ADR-0005)', () => {
  it('the signed-in person is the author, Admins included; an old chosenUserId is ignored', async () => {
    const admin = browser();
    await admin.actAs('Admin');
    const carol = await getUserByName(admin.db, 'Carol');
    const check = await admin.call('/api/attribution/check', {
      action: 'data',
      chosenUserId: carol?.id,
    });
    expect(await check.json()).toMatchObject({ authorName: TEST_ADMIN, viaAdmin: false });
  });
});

describe('secrets stay out of client answers and the Dropbox copy', () => {
  it('neither /api/users nor the export contains password hashes or sign-in counters', async () => {
    const s = browser();
    await s.actAs('Carol');
    const users = await (await s.call('/api/users')).json<Record<string, unknown>[]>();
    expect(users.length).toBeGreaterThan(0);
    for (const user of users) expect(Object.keys(user)).not.toContain('password_hash');
    const files = await buildExportFiles(s.db, new Date(), () => Promise.resolve(''));
    const text = JSON.stringify(files.json.users) + (files.csvs['users.csv'] ?? '');
    expect(text).not.toMatch(/password_hash|pbkdf2|session_epoch|failed_logins/);
  });
});

describe('migration 0010', () => {
  it('retires the built-in Admin, creates a Guest URL token and drops the old Admin password and passphrase', async () => {
    const db = createMigratedDb();
    expect((await getUserByName(db, 'Admin'))?.is_active).toBe(0);
    expect(await getSetting(db, 'guest_link_token')).toMatch(/^[0-9a-f]{48}$/);
    expect(await getSetting(db, 'admin_password_hash')).toBeNull();
    expect(await getSetting(db, 'lab_passphrase_hash')).toBeNull();
  });
});
