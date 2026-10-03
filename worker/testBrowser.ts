/** A tiny test browser: one database, one cookie jar (used by the API route tests). */
import { getSetting } from './db/queries/settings';
import { getUserByName } from './db/queries/users';
import { hashPassword } from './lib/passwords';
import { createMigratedDb, insertRaw } from './db/testing/testDb';
import app from './index';
import type { Bindings } from './middleware/session';

export type TestDb = ReturnType<typeof createMigratedDb>;

/** Every test account signs in with this password; the Admin person is "Lab Admin". */
export const TEST_PASSWORD = 'test-password';
export const TEST_ADMIN = 'Lab Admin';
export const TEST_ADMIN_ID = '01M3JMZC0ATESTADM1N000000';
let hashed: Promise<string> | undefined;
/** PBKDF2 is slow on purpose: hash the test password once per test file. */
export function testPasswordHash(): Promise<string> {
  hashed ??= hashPassword(TEST_PASSWORD);
  return hashed;
}

/** An in-memory R2 bucket: `put` and `get`, the two calls the app makes. */
export function fakeBucket(objects: Map<string, Uint8Array> = new Map()): R2Bucket {
  return {
    put: async (key: string, value: Blob | ArrayBuffer | Uint8Array) => {
      objects.set(
        key,
        value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new Uint8Array(value),
      );
      return {};
    },
    get: (key: string) => {
      const bytes = objects.get(key);
      return Promise.resolve(
        bytes === undefined
          ? null
          : ({ body: new Response(bytes).body } as unknown as R2ObjectBody),
      );
    },
  } as unknown as R2Bucket;
}

export function browser(db: TestDb = createMigratedDb(), extra: Partial<Bindings> = {}) {
  const files = new Map<string, Uint8Array>();
  const bindings = {
    DB: db,
    SESSION_SIGNING_KEY: 'test-signing-key',
    FILES: fakeBucket(files),
    ...extra,
  } satisfies Bindings;
  let cookie = '';
  async function call(path: string, body?: unknown, method?: string): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cookie !== '') headers.Cookie = cookie;
    const init: RequestInit =
      body === undefined && method === undefined
        ? { headers }
        : {
            method: method ?? 'POST',
            headers,
            body: body === undefined ? null : JSON.stringify(body),
          };
    const response = await app.request(path, init, bindings);
    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) cookie = setCookie.split(';')[0] ?? '';
    return response;
  }
  /**
   * Signs this browser in as `name` (ADR-0005): `Guest` through the Guest URL; `Admin` as the test
   * Admin person "Lab Admin" (created on first use); anyone else with the test password.
   */
  async function actAs(name: string): Promise<string> {
    if (name === 'Guest') {
      const token = await getSetting(db, 'guest_link_token');
      await call(`/api/guest/${token ?? ''}`, {});
      return idOf('Guest');
    }
    const personName = name === 'Admin' ? TEST_ADMIN : name;
    if (name === 'Admin' && (await getUserByName(db, TEST_ADMIN)) === null)
      await insertRaw(db, 'users', {
        id: TEST_ADMIN_ID,
        name: TEST_ADMIN,
        role: 'admin',
        is_active: 1,
        is_builtin: 0,
        created_at: '2026-09-28T00:00:00Z',
        updated_at: '2026-09-28T00:00:00Z',
      });
    const user = await getUserByName(db, personName);
    if (user === null) throw new Error(`seed user ${personName} missing`);
    await db
      .prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 0, failed_logins = 0, locked_until = NULL WHERE id = ?',
      )
      .bind(await testPasswordHash(), user.id)
      .run();
    const response = await call('/api/session/login', {
      name: personName,
      password: TEST_PASSWORD,
    });
    if (response.status !== 200)
      throw new Error(`sign-in as ${personName} failed: ${String(response.status)}`);
    return user.id;
  }
  async function idOf(name: string): Promise<string> {
    const user = await getUserByName(db, name);
    if (user === null) throw new Error(`seed user ${name} missing`);
    return user.id;
  }
  /** A multipart upload (the session cookie is sent like in `call`). */
  async function upload(path: string, form: FormData): Promise<Response> {
    const headers: Record<string, string> = {};
    if (cookie !== '') headers.Cookie = cookie;
    return app.request(path, { method: 'POST', headers, body: form }, bindings);
  }
  return { db, call, actAs, idOf, upload, files };
}

export interface ErrorBody {
  error: { code: string; message: string; hint?: string; details?: Record<string, unknown> };
}

/**
 * A read-only client signed in through the Guest URL (ADR-0005: every API read needs a session).
 * For tests that only read and build their own bindings.
 */
export async function guestFetch(
  bindings: Bindings,
): Promise<(path: string, init?: RequestInit) => Promise<Response>> {
  const token = await getSetting(bindings.DB, 'guest_link_token');
  const signIn = await app.request(`/api/guest/${token ?? ''}`, { method: 'POST' }, bindings);
  return withCookie(bindings, signIn);
}

/** Like `guestFetch`, signed in as a lab member (default Bob) for tests that send raw bodies. */
export async function signedInFetch(
  bindings: Bindings,
  name = 'Bob',
): Promise<(path: string, init?: RequestInit) => Promise<Response>> {
  await bindings.DB.prepare('UPDATE users SET password_hash = ? WHERE name = ?')
    .bind(await testPasswordHash(), name)
    .run();
  const signIn = await app.request(
    '/api/session/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, password: TEST_PASSWORD }),
    },
    bindings,
  );
  return withCookie(bindings, signIn);
}

function withCookie(
  bindings: Bindings,
  signIn: Response,
): (path: string, init?: RequestInit) => Promise<Response> {
  const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  return async (path, init) =>
    app.request(
      path,
      { ...init, headers: { ...(init?.headers as Record<string, string>), Cookie: cookie } },
      bindings,
    );
}
