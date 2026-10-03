import { describe, expect, it } from 'vitest';
import { getUserByName } from './db/queries/users';
import { createMigratedDb } from './db/testing/testDb';
import { setAdminSql } from './lib/setAdmin';
import { hashPassword, verifyPassword } from './lib/passwords';

async function run(db: ReturnType<typeof createMigratedDb>, sql: string) {
  for (const statement of sql.split('\n')) await db.prepare(statement).run();
}

describe('user:set-admin SQL', () => {
  it('makes an existing member an active Admin with the new password and ends their sessions', async () => {
    const db = createMigratedDb();
    const before = await getUserByName(db, 'Carol');
    await run(
      db,
      setAdminSql('carol', await hashPassword('new-admin-pw'), 'unused', '2026-10-02T00:00:00Z'),
    );
    const after = await getUserByName(db, 'Carol');
    expect(after?.role).toBe('admin');
    expect(after?.is_active).toBe(1);
    expect(after?.session_epoch).toBe((before?.session_epoch ?? 0) + 1);
    expect(await verifyPassword('new-admin-pw', after?.password_hash ?? null)).toBe(true);
  });

  it('creates the person when the database has nobody by that name (quotes are safe)', async () => {
    const db = createMigratedDb();
    await run(
      db,
      setAdminSql(
        "O'Brien",
        await hashPassword('first-admin'),
        '01TESTADMIN0000000000000000',
        '2026-10-02T00:00:00Z',
      ),
    );
    const created = await getUserByName(db, "O'Brien");
    expect(created).toMatchObject({
      id: '01TESTADMIN0000000000000000',
      role: 'admin',
      is_active: 1,
    });
  });

  it('never touches the built-in Guest', async () => {
    const db = createMigratedDb();
    await run(
      db,
      setAdminSql('Guest', await hashPassword('nope-nope'), 'x', '2026-10-02T00:00:00Z'),
    );
    expect((await getUserByName(db, 'Guest'))?.role).toBe('guest');
  });
});
