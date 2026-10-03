/**
 * Accounts (ADR-0005): checking a password with the lockout, invites, the Guest URL token.
 * Rules live in `domain/accounts.ts`; this file reads and writes the rows.
 */
import {
  inviteExpiry,
  inviteUsable,
  isLocked,
  LOCK_AFTER_FAILURES,
  LOCK_MINUTES,
} from '../../domain/accounts';
import type { Db, DbStatement } from '../db/db';
import { getSetting } from '../db/queries/settings';
import { getUserById } from '../db/queries/users';
import type { InviteRow, UserRow } from '../db/types';
import { newId } from '../db/ids';
import { verifyPassword } from './passwords';

/** A random, URL-safe token (32 bytes). */
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// A fixed hash to compare against when the name is unknown, so that case takes as long as a
// wrong password (the response does not reveal which names exist).
const NO_USER_HASH =
  'pbkdf2-sha256$100000$q0VPgQ1/kEzt33Q6uxzj/Q==$4pF+ho9aUwIuNieLjq3zNef4iNDCKykiu0USkK8nTsw=';

export type PasswordCheck = 'ok' | 'wrong' | 'locked';

/** Checks `password` for `user` and records the outcome (failure count, 15-minute lock). */
export async function checkPassword(
  db: Db,
  user: UserRow | null,
  password: string,
  now: Date,
): Promise<PasswordCheck> {
  if (user === null || user.is_active === 0) {
    await verifyPassword(password, NO_USER_HASH);
    return 'wrong';
  }
  // Always hash, even for a locked account, so a lock cannot be told apart by timing.
  const correct = await verifyPassword(password, user.password_hash);
  if (isLocked(user.locked_until, now)) return 'locked';
  if (correct) {
    if (user.failed_logins !== 0 || user.locked_until !== null)
      await db
        .prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?')
        .bind(user.id)
        .run();
    return 'ok';
  }
  // One atomic statement: parallel wrong guesses cannot slip past the counter (a read-modify-write
  // would let 30 parallel requests count as one). The limits come from `domain/accounts.ts`.
  const lockEnd = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  const row = await db
    .prepare(
      `UPDATE users SET
         failed_logins = CASE WHEN failed_logins + 1 >= ? THEN 0 ELSE failed_logins + 1 END,
         locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END
       WHERE id = ? RETURNING locked_until`,
    )
    .bind(LOCK_AFTER_FAILURES, LOCK_AFTER_FAILURES, lockEnd, user.id)
    .first<{ locked_until: string | null }>();
  return isLocked(row?.locked_until ?? null, now) ? 'locked' : 'wrong';
}

/**
 * Statements that give `userId` a new invite and retire the older ones; run them in one batch with
 * the password change. Returns the token for the URL (shown once, never stored).
 */
export async function newInvite(
  db: Db,
  userId: string,
  createdBy: string,
  now: Date,
): Promise<{ token: string; statements: DbStatement[] }> {
  const token = randomToken();
  return {
    token,
    statements: [
      db
        .prepare('UPDATE invites SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
        .bind(now.toISOString(), userId),
      db
        .prepare(
          'INSERT INTO invites (id, user_id, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .bind(
          newId(),
          userId,
          await sha256Hex(token),
          createdBy,
          now.toISOString(),
          inviteExpiry(now),
        ),
    ],
  };
}

/** The invite behind a URL token and its user, while it is usable; otherwise null. */
export async function findInvite(
  db: Db,
  token: string,
  now: Date,
): Promise<{ invite: InviteRow; user: UserRow } | null> {
  const invite = await db
    .prepare('SELECT * FROM invites WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first<InviteRow>();
  if (invite === null || !inviteUsable(invite, now)) return null;
  const user = await getUserById(db, invite.user_id);
  if (user === null || user.is_active === 0) return null;
  return { invite, user };
}

export async function guestLinkToken(db: Db): Promise<string | null> {
  return getSetting(db, 'guest_link_token');
}

/** Constant-time comparison for the Guest URL token. */
export function sameToken(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
