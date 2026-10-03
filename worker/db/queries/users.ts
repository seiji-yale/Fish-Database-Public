import type { Db } from '../db';
import type { UserRow } from '../types';
import { define, getRowById, insertRow } from './shared';

export const USERS = define<UserRow>('users', {
  id: true,
  name: true,
  role: true,
  is_active: true,
  is_builtin: true,
  created_at: true,
  updated_at: true,
  password_hash: true,
  must_change_password: true,
  session_epoch: true,
  failed_logins: true,
  locked_until: true,
});

export function insertUser(db: Db, row: UserRow): Promise<unknown> {
  return insertRow(db, USERS, row);
}

/** Returns inactive users too: history keeps pointing at them. */
export function getUserById(db: Db, id: string): Promise<UserRow | null> {
  return getRowById(db, USERS, id);
}

export function getUserByName(db: Db, name: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE name = ?').bind(name).first<UserRow>();
}

/** Sign-in looks names up without regard to case ("bob" finds "Bob"). */
export function getUserBySignInName(db: Db, name: string): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE ORDER BY is_active DESC LIMIT 1')
    .bind(name.trim())
    .first<UserRow>();
}

/** A user row without the sign-in columns: what exports and the Dropbox copy hold (ADR-0005). */
export function withoutSecrets(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    is_active: row.is_active,
    is_builtin: row.is_builtin,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** What the client may see about a user: never the password hash or sign-in counters. */
export function publicUser(row: UserRow) {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    is_active: row.is_active,
    is_builtin: row.is_builtin,
  };
}

/** Users are never deleted; `includeInactive` adds deactivated users (Admin views, history). */
export async function listUsers(
  db: Db,
  options: { includeInactive?: boolean } = {},
): Promise<UserRow[]> {
  const filter = options.includeInactive === true ? '1 = 1' : 'is_active = 1';
  const { results } = await db
    .prepare(`SELECT * FROM users WHERE ${filter} ORDER BY created_at, id`)
    .all<UserRow>();
  return results;
}
