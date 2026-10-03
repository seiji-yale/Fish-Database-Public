/**
 * Signing in (ADR-0005): `GET /session`, sign-in with name and password, sign-out, changing one's
 * password, invite URLs (`/join/:token`), the Guest URL (`/guest/:token`) and the Guest URL for
 * sharing (`/guest-link`). Sign-in, invite and Guest routes are open (see `sessionGate`).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { newPasswordProblem } from '../../domain/accounts';
import { isMirrorStale } from '../../domain/mirror';
import { getSetting } from '../db/queries/settings';
import { getUserByName, getUserBySignInName, listUsers, publicUser } from '../db/queries/users';
import type { UserRow } from '../db/types';
import { checkPassword, findInvite, guestLinkToken, sameToken } from '../lib/accounts';
import { actingUser } from '../lib/attribution';
import { ApiError } from '../lib/errors';
import { messages } from '../lib/messages';
import { hashPassword, verifyPassword } from '../lib/passwords';
import { appDisplayName } from '../lib/appName';
import { isReadOnly } from '../lib/readOnly';
import { endSession, signedInUser, startSession, type Bindings } from '../middleware/session';

const body = <T>(schema: z.ZodType<T>, request: Request): Promise<T> =>
  request
    .json()
    .then((value: unknown) => schema.parse(value))
    .catch(() => {
      throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
    });

function passwordError(next: string): ApiError | null {
  if (newPasswordProblem(next) === null) return null;
  const message = messages.passwordTooShort;
  return new ApiError(400, 'INVALID_INPUT', message, undefined, {
    fields: { newPassword: message },
  });
}

const signInFailed = () => new ApiError(401, 'SIGN_IN_FAILED', messages.signInFailed);
const locked = () => new ApiError(429, 'ACCOUNT_LOCKED', messages.accountLocked);

export const sessionRoutes = new Hono<{ Bindings: Bindings }>();

sessionRoutes.get('/session', async (c) => {
  const user = await signedInUser(c);
  const isAdmin = user?.role === 'admin';
  const configuredAppName = await getSetting(c.env.DB, 'app_name');
  return c.json({
    appName: appDisplayName(configuredAppName ?? c.env.APP_NAME),
    user: user === null ? null : { id: user.id, name: user.name, role: user.role },
    mustChangePassword: user?.must_change_password === 1,
    // Everyone sees the banner while an Admin restores the database (T-021).
    readOnly: await isReadOnly(c.env.DB),
    // Only Admins are told: the Dropbox copy failed or is more than a day old (FR-SYNC-03).
    mirrorStale:
      isAdmin &&
      isMirrorStale(
        await getSetting(c.env.DB, 'mirror_last_ok_at'),
        await getSetting(c.env.DB, 'mirror_last_error'),
        new Date(),
      ),
  });
});

sessionRoutes.post('/session/login', async (c) => {
  const input = await body(
    z.object({ name: z.string().min(1), password: z.string().min(1) }),
    c.req.raw,
  );
  const user = await getUserBySignInName(c.env.DB, input.name);
  const result = await checkPassword(c.env.DB, user, input.password, new Date());
  if (result === 'locked') throw locked();
  if (result === 'wrong' || user === null) throw signInFailed();
  // A user still on the initial password signs in only through the invite URL (ADR-0005).
  if (user.must_change_password === 1)
    throw new ApiError(409, 'INVITE_REQUIRED', messages.inviteRequired);
  await startSession(c, user);
  return c.json({ ok: true });
});

sessionRoutes.post('/session/logout', (c) => {
  endSession(c);
  return c.json({ ok: true });
});

/** Change one's own password; every other browser of this user is signed out. */
sessionRoutes.post('/session/password', async (c) => {
  const input = await body(
    z.object({ currentPassword: z.string().min(1), newPassword: z.string() }),
    c.req.raw,
  );
  const acting = await actingUser(c);
  const user = await signedInUser(c);
  if (user === null || acting.role === 'guest')
    throw new ApiError(403, 'FORBIDDEN', messages.guestCannotEdit);
  const problem = passwordError(input.newPassword);
  if (problem !== null) throw problem;
  if (!(await verifyPassword(input.currentPassword, user.password_hash)))
    throw new ApiError(400, 'INVALID_INPUT', messages.passwordWrong, undefined, {
      fields: { currentPassword: messages.passwordWrong },
    });
  const epoch = user.session_epoch + 1;
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, must_change_password = 0, session_epoch = ?, updated_at = ? WHERE id = ?',
  )
    .bind(await hashPassword(input.newPassword), epoch, new Date().toISOString(), user.id)
    .run();
  await startSession(c, { id: user.id, session_epoch: epoch });
  return c.json({ ok: true });
});

/** Who an invite URL is for (the page greets them by name). */
sessionRoutes.get('/join/:token', async (c) => {
  const found = await findInvite(c.env.DB, c.req.param('token'), new Date());
  if (found === null) throw new ApiError(404, 'INVITE_INVALID', messages.inviteInvalid);
  return c.json({ name: found.user.name, role: found.user.role });
});

/** First sign-in: the initial password Admin gave, and the user's own new password. */
sessionRoutes.post('/join/:token', async (c) => {
  const input = await body(
    z.object({ initialPassword: z.string().min(1), newPassword: z.string() }),
    c.req.raw,
  );
  const db = c.env.DB;
  const now = new Date();
  const found = await findInvite(db, c.req.param('token'), now);
  if (found === null) throw new ApiError(404, 'INVITE_INVALID', messages.inviteInvalid);
  const result = await checkPassword(db, found.user, input.initialPassword, now);
  if (result === 'locked') throw locked();
  if (result === 'wrong')
    throw new ApiError(400, 'INVALID_INPUT', messages.signInFailed, undefined, {
      fields: { initialPassword: messages.signInFailed },
    });
  const problem = passwordError(input.newPassword);
  if (problem !== null) throw problem;
  const epoch = found.user.session_epoch + 1;
  // Claim the invite first, atomically: two parallel requests with the same link cannot both win.
  const claimed = await db
    .prepare('UPDATE invites SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .bind(now.toISOString(), found.invite.id)
    .run();
  if (claimed.meta.changes === 0) throw new ApiError(404, 'INVITE_INVALID', messages.inviteInvalid);
  await db
    .prepare(
      'UPDATE users SET password_hash = ?, must_change_password = 0, session_epoch = ?, updated_at = ? WHERE id = ?',
    )
    .bind(await hashPassword(input.newPassword), epoch, now.toISOString(), found.user.id)
    .run();
  await startSession(c, { id: found.user.id, session_epoch: epoch });
  return c.json({ ok: true });
});

/** The Guest URL: no password, read only (ADR-0005). */
sessionRoutes.post('/guest/:token', async (c) => {
  const db = c.env.DB;
  const token = await guestLinkToken(db);
  const guest: UserRow | null = await getUserByName(db, 'Guest');
  if (token === null || guest === null || !sameToken(c.req.param('token'), token))
    throw new ApiError(404, 'GUEST_LINK_INVALID', messages.guestLinkInvalid);
  await startSession(c, guest);
  return c.json({ ok: true });
});

/** Any signed-in lab member may pass the Guest URL on (ADR-0005); Guests already have it. */
sessionRoutes.get('/guest-link', async (c) => {
  const acting = await actingUser(c);
  if (acting.role === 'guest') throw new ApiError(403, 'FORBIDDEN', messages.guestCannotEdit);
  return c.json({ token: await guestLinkToken(c.env.DB) });
});

sessionRoutes.get('/users', async (c) => c.json((await listUsers(c.env.DB)).map(publicUser)));
