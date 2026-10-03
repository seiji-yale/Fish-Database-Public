import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { getUserById } from '../db/queries/users';
import type { UserRow } from '../db/types';
import type { Db } from '../db/db';
import { ApiError } from '../lib/errors';
import { messages } from '../lib/messages';

/**
 * The signed cookie `fish_session` (ADR-0005): who is signed in, and the user's `session_epoch` at
 * sign-in. Raising the epoch in the database ends every session of that user at once.
 */
export interface Session {
  userId: string;
  epoch: number;
  exp: number;
}
export interface Bindings {
  DB: Db;
  SESSION_SIGNING_KEY: string;
  /** Public-facing title for the Worker-generated offline copy. */
  APP_NAME?: string;
  /** R2 bucket for uploaded files (preview/production only; absent in plain local dev). */
  FILES?: R2Bucket;
  /** Dropbox mirror credentials (T-020): Worker secrets, absent until the mirror is set up. */
  DROPBOX_APP_KEY?: string;
  DROPBOX_REFRESH_TOKEN?: string;
  /** Mirror folder inside the Dropbox app folder (wrangler.toml `vars`). */
  MIRROR_FOLDER?: string;
}
const encoder = new TextEncoder();
const dayMs = 24 * 60 * 60 * 1000;
function encode(value: Uint8Array): string {
  let text = '';
  for (const item of value) text += String.fromCharCode(item);
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value: string): Uint8Array {
  const padded =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}
async function sign(value: string, secret: string | undefined): Promise<string> {
  if (secret === undefined || secret === '')
    throw new Error(
      'SESSION_SIGNING_KEY is not set: add it to .dev.vars locally (see .dev.vars.example) or as a Worker secret.',
    );
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return encode(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}
const SESSION_DAYS = 90;
/** A session is renewed on use once fewer than this many days are left (so it lasts while used). */
const RENEW_BELOW_DAYS = 80;

export async function readSession(c: Context<{ Bindings: Bindings }>): Promise<Session | null> {
  const raw = getCookie(c, 'fish_session');
  if (raw === undefined) return null;
  const [payload, signature] = raw.split('.');
  if (
    payload === undefined ||
    signature === undefined ||
    signature !== (await sign(payload, c.env.SESSION_SIGNING_KEY))
  )
    return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(decode(payload))) as Partial<Session>;
    // Cookies from before ADR-0005 have no userId/epoch: they count as signed out.
    if (
      typeof session.userId !== 'string' ||
      typeof session.epoch !== 'number' ||
      typeof session.exp !== 'number'
    )
      return null;
    return session.exp > Date.now() ? (session as Session) : null;
  } catch {
    return null;
  }
}
async function saveSession(c: Context<{ Bindings: Bindings }>, session: Session): Promise<void> {
  const payload = encode(encoder.encode(JSON.stringify(session)));
  setCookie(c, 'fish_session', `${payload}.${await sign(payload, c.env.SESSION_SIGNING_KEY)}`, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: Math.floor((session.exp - Date.now()) / 1000),
  });
}

/** Signs this browser in as `user` for 90 days. */
export async function startSession(
  c: Context<{ Bindings: Bindings }>,
  user: Pick<UserRow, 'id' | 'session_epoch'>,
): Promise<void> {
  signedIn.delete(c.req.raw);
  await saveSession(c, {
    userId: user.id,
    epoch: user.session_epoch,
    exp: Date.now() + dayMs * SESSION_DAYS,
  });
}

export function endSession(c: Context<{ Bindings: Bindings }>): void {
  signedIn.delete(c.req.raw);
  setCookie(c, 'fish_session', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  });
}

/** One database read per request: the gate and the routes share the answer. */
const signedIn = new WeakMap<Request, { user: UserRow; session: Session } | null>();

/**
 * The user this browser is signed in as, or null. A session only counts while the user is active,
 * the epoch still matches, and the user is not the retired built-in Admin identity.
 */
export async function signedInUser(c: Context<{ Bindings: Bindings }>): Promise<UserRow | null> {
  return (await signedInState(c))?.user ?? null;
}

async function signedInState(
  c: Context<{ Bindings: Bindings }>,
): Promise<{ user: UserRow; session: Session } | null> {
  const cached = signedIn.get(c.req.raw);
  if (cached !== undefined) return cached;
  const session = await readSession(c);
  const user = session === null ? null : await getUserById(c.env.DB, session.userId);
  const valid =
    session !== null &&
    user !== null &&
    user.is_active === 1 &&
    user.session_epoch === session.epoch &&
    !(user.is_builtin === 1 && user.role === 'admin');
  const state = valid ? { user, session } : null;
  signedIn.set(c.req.raw, state);
  return state;
}

/** Routes that work without signing in: how a browser signs in in the first place. */
const OPEN = /^\/api\/(health|session|session\/(login|logout)|join\/[^/]+|guest\/[^/]+)$/;
/** Routes a user who must change the initial password may still call. */
const WHILE_CHANGING_PASSWORD = /^\/api\/session(\/.*)?$/;

export function sessionGate(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    c.header('X-Robots-Tag', 'noindex');
    const path = new URL(c.req.url).pathname;
    if (OPEN.test(path)) return next();
    const state = await signedInState(c);
    if (state === null) throw new ApiError(401, 'LOGIN_REQUIRED', messages.loginRequired);
    if (state.user.must_change_password === 1 && !WHILE_CHANGING_PASSWORD.test(path))
      throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', messages.passwordChangeRequired);
    if (state.session.exp - Date.now() < dayMs * RENEW_BELOW_DAYS) {
      await startSession(c, state.user);
      signedIn.set(c.req.raw, state);
    }
    return next();
  };
}
