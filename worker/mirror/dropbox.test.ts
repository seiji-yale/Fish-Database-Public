import { describe, expect, it } from 'vitest';
import { DropboxTarget, dropboxContentHash, type Fetch } from './dropbox';

const APP_KEY = 'app-key-123';
const REFRESH = 'refresh-secret-456';
const ACCESS = 'access-secret-789';

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** The parts of the requests the fake reads. */
interface ApiArg {
  path?: string;
  cursor?: { session_id: string; offset: number };
  commit?: { path: string };
}
interface JsonRequest {
  path?: string;
  recursive?: boolean;
  cursor?: string;
}

/** A small Dropbox: files by lower-case path, the endpoints the client uses, pages of two entries. */
function fakeDropbox() {
  const files = new Map<string, Uint8Array>();
  const sessions = new Map<string, { path?: string; parts: Uint8Array[] }>();
  const calls: string[] = [];
  let failUpload: { status: number; summary: string } | null = null;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const pages = new Map<string, unknown[]>();
  const page = (entries: unknown[]) => {
    const cursor = `c${String(pages.size)}`;
    pages.set(cursor, entries.slice(2));
    return json({ entries: entries.slice(0, 2), cursor, has_more: entries.length > 2 });
  };
  const entriesUnder = async (folder: string, recursive: boolean) => {
    const prefix = `${folder.toLowerCase()}/`;
    const out: unknown[] = [];
    const folders = new Set<string>();
    for (const [path, bytes] of files) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (recursive || !rest.includes('/'))
        out.push({
          '.tag': 'file',
          path_lower: path,
          name: rest.split('/').pop(),
          content_hash: await dropboxContentHash(bytes),
        });
      else folders.add(rest.split('/')[0] ?? '');
    }
    for (const name of folders)
      out.push({ '.tag': 'folder', path_lower: `${prefix}${name}`, name });
    return out;
  };
  const fetcher: Fetch = async (url, init) => {
    const endpoint = url.replace(/^https:\/\/[^/]+/, '');
    calls.push(endpoint);
    const headers = init.headers as Record<string, string>;
    if (endpoint === '/oauth2/token') {
      const form = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
      return form.get('refresh_token') === REFRESH && form.get('client_id') === APP_KEY
        ? json({ access_token: ACCESS, expires_in: 14400 })
        : json({ error: 'invalid_grant', error_description: 'refresh token is malformed' }, 400);
    }
    if (headers.Authorization !== `Bearer ${ACCESS}`)
      return json({ error_summary: 'invalid_access_token/' }, 401);
    const arg: ApiArg =
      headers['Dropbox-API-Arg'] === undefined
        ? {}
        : (JSON.parse(headers['Dropbox-API-Arg']) as ApiArg);
    const body = init.body instanceof Uint8Array ? init.body : undefined;
    const request: JsonRequest =
      typeof init.body === 'string' ? (JSON.parse(init.body) as JsonRequest) : {};
    switch (endpoint) {
      case '/2/files/list_folder': {
        const entries = await entriesUnder(request.path ?? '', request.recursive === true);
        if (entries.length === 0) return json({ error_summary: 'path/not_found/..' }, 409);
        return page(entries);
      }
      case '/2/files/list_folder/continue': {
        const rest = pages.get(request.cursor ?? '') ?? [];
        return page(rest);
      }
      case '/2/files/upload':
        if (failUpload !== null)
          return json({ error_summary: failUpload.summary }, failUpload.status);
        files.set((arg.path ?? '').toLowerCase(), body ?? new Uint8Array());
        return json({ name: 'x' });
      case '/2/files/upload_session/start': {
        const id = `s${String(sessions.size)}`;
        sessions.set(id, { parts: [body ?? new Uint8Array()] });
        return json({ session_id: id });
      }
      case '/2/files/upload_session/append_v2':
        sessions.get(arg.cursor?.session_id ?? '')?.parts.push(body ?? new Uint8Array());
        return json(null);
      case '/2/files/upload_session/finish': {
        const session = sessions.get(arg.cursor?.session_id ?? '');
        const parts = [...(session?.parts ?? []), body ?? new Uint8Array()];
        const total = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
        let offset = 0;
        for (const part of parts) {
          total.set(part, offset);
          offset += part.length;
        }
        expect(offset - (body?.length ?? 0)).toBe(arg.cursor?.offset);
        files.set((arg.commit?.path ?? '').toLowerCase(), total);
        return json({ name: 'x' });
      }
      case '/2/files/delete_v2': {
        const target = (request.path ?? '').toLowerCase();
        let found = false;
        for (const path of [...files.keys()])
          if (path === target || path.startsWith(`${target}/`)) {
            files.delete(path);
            found = true;
          }
        return found ? json({}) : json({ error_summary: 'path_lookup/not_found/' }, 409);
      }
      default:
        return json({ error_summary: 'unknown endpoint' }, 400);
    }
  };
  return {
    files,
    calls,
    fetcher,
    failNextUploads(status: number, summary: string) {
      failUpload = { status, summary };
    },
  };
}

const target = (
  dropbox: ReturnType<typeof fakeDropbox>,
  extra: Partial<ConstructorParameters<typeof DropboxTarget>[0]> = {},
) =>
  new DropboxTarget({
    appKey: APP_KEY,
    refreshToken: REFRESH,
    root: '/preview',
    fetch: dropbox.fetcher,
    ...extra,
  });

/** The error a promise fails with (the test fails if it succeeds). */
const failure = (promise: Promise<unknown>): Promise<Error> =>
  promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (error: unknown) => error as Error,
  );

describe('dropboxContentHash', () => {
  it('is SHA-256 over the SHA-256 of each 4 MB block', async () => {
    const small = new TextEncoder().encode('hello');
    expect(await dropboxContentHash(small)).toBe(hex(await sha256(await sha256(small))));
    const big = new Uint8Array(4 * 1024 * 1024 + 3).fill(7);
    const blocks = new Uint8Array(64);
    blocks.set(await sha256(big.subarray(0, 4 * 1024 * 1024)), 0);
    blocks.set(await sha256(big.subarray(4 * 1024 * 1024)), 32);
    expect(await dropboxContentHash(big)).toBe(hex(await sha256(blocks)));
    expect(await dropboxContentHash(new Uint8Array())).toBe(hex(await sha256(new Uint8Array())));
  });
});

describe('DropboxTarget', () => {
  it('signs in once, writes under its root, and skips files whose content is unchanged', async () => {
    const dropbox = fakeDropbox();
    const first = target(dropbox);
    expect(await first.put('latest/lines.csv', 'a,b\n')).toBe(true);
    expect(await first.put('latest/users.csv', 'u\n')).toBe(true);
    expect(dropbox.calls.filter((call) => call === '/oauth2/token')).toHaveLength(1);
    expect(new TextDecoder().decode(dropbox.files.get('/preview/latest/lines.csv'))).toBe('a,b\n');

    // A second run (new target) lists latest/ once and uploads only the changed file.
    const second = target(dropbox);
    dropbox.calls.length = 0;
    expect(await second.put('latest/lines.csv', 'a,b\n')).toBe(false);
    expect(await second.put('latest/users.csv', 'u2\n')).toBe(true);
    expect(dropbox.calls.filter((call) => call === '/2/files/upload')).toHaveLength(1);
    expect(dropbox.calls.filter((call) => call === '/2/files/list_folder')).toHaveLength(1);
    expect(second.requests()).toBe(dropbox.calls.length);
  });

  it('lists a top-level file (README.txt) without listing the folders below it', async () => {
    const dropbox = fakeDropbox();
    await target(dropbox).put('latest/images/demo_c3/a.jpg', 'a');
    expect(await target(dropbox).put('README.txt', 'hello')).toBe(true);
    const again = target(dropbox, { root: '/' });
    expect(await target(dropbox).put('README.txt', 'hello')).toBe(false);
    expect(await again.put('README.txt', 'x')).toBe(true);
    expect(dropbox.files.has('/readme.txt')).toBe(true);
  });

  it('follows list pages and knows which images are already there', async () => {
    const dropbox = fakeDropbox();
    const writer = target(dropbox);
    for (const name of ['a', 'b', 'c', 'd', 'e'])
      await writer.put(`latest/images/demo_c3/${name}.jpg`, name);
    const reader = target(dropbox);
    expect(await reader.has('latest/images/demo_c3/E.JPG')).toBe(true); // Dropbox paths ignore case
    expect(await reader.has('latest/images/demo_c3/f.jpg')).toBe(false);
    expect(dropbox.calls).toContain('/2/files/list_folder/continue');
  });

  it('lists the archive days and removes a whole day', async () => {
    const dropbox = fakeDropbox();
    const t = target(dropbox);
    expect(await t.list('archive')).toEqual([]);
    await t.put('archive/2026-01-01/lines.csv', 'x');
    await t.put('archive/2026-01-01/users.csv', 'x');
    await t.put('archive/2026-10-05/lines.csv', 'y');
    await t.put('archive/notes.txt', 'z');
    expect((await t.list('archive')).sort()).toEqual(['2026-01-01', '2026-10-05', 'notes.txt']);
    await t.remove('archive/2026-01-01');
    expect([...dropbox.files.keys()].some((path) => path.includes('2026-01-01'))).toBe(false);
    await t.remove('archive/2026-01-01'); // already gone: not an error
  });

  it('sends a large file through an upload session', async () => {
    const dropbox = fakeDropbox();
    const t = target(dropbox, { simpleUploadLimit: 10, sessionChunk: 4 });
    const bytes = new Uint8Array(15).map((_, index) => index);
    expect(await t.put('latest/fish-database.json', bytes)).toBe(true);
    expect(dropbox.files.get('/preview/latest/fish-database.json')).toEqual(bytes);
    expect(dropbox.calls.filter((call) => call.includes('upload_session/append_v2'))).toHaveLength(
      2,
    );
    // Exactly one chunk: no append.
    const one = target(fakeDropbox(), { simpleUploadLimit: 2, sessionChunk: 8 });
    expect(await one.put('latest/x.bin', new Uint8Array(5))).toBe(true);
  });

  it('writes non-ASCII names with an ASCII-only API argument', async () => {
    const dropbox = fakeDropbox();
    await target(dropbox).put('latest/images/Tg-µ/a.jpg', 'x');
    expect(dropbox.files.has('/preview/latest/images/tg-µ/a.jpg')).toBe(true);
  });

  it('reports failures without tokens in the message', async () => {
    const dropbox = fakeDropbox();
    dropbox.failNextUploads(507, 'insufficient_space/..');
    const error = await failure(target(dropbox).put('latest/lines.csv', 'x'));
    expect(error.message).toBe('Dropbox upload failed (HTTP 507): insufficient_space/..');
    for (const secret of [APP_KEY, REFRESH, ACCESS]) expect(error.message).not.toContain(secret);

    const bad = new DropboxTarget({
      appKey: APP_KEY,
      refreshToken: 'wrong',
      root: '/',
      fetch: dropbox.fetcher,
    });
    const signIn = await failure(bad.put('latest/a.csv', 'x'));
    expect(signIn.message).toBe(
      'Dropbox sign-in failed (HTTP 400): invalid_grant (refresh token is malformed).',
    );
    for (const secret of ['wrong', ACCESS]) expect(signIn.message).not.toContain(secret);

    const noToken = new DropboxTarget({
      appKey: APP_KEY,
      refreshToken: REFRESH,
      root: '/',
      fetch: () => Promise.resolve(new Response('{}', { status: 200 })),
    });
    expect((await failure(noToken.list('archive'))).message).toBe(
      'Dropbox sign-in returned no access token.',
    );
  });

  it('turns other Dropbox errors into short messages', async () => {
    let status = 500;
    let text = 'oops';
    const odd: Fetch = (url) =>
      Promise.resolve(
        url.endsWith('/oauth2/token')
          ? new Response(JSON.stringify({ access_token: ACCESS }), { status: 200 })
          : new Response(text, { status }),
      );
    const t = new DropboxTarget({ appKey: APP_KEY, refreshToken: REFRESH, root: '/', fetch: odd });
    await expect(t.list('archive')).rejects.toThrow('Dropbox list_folder failed (HTTP 500)');
    await expect(t.remove('archive/x')).rejects.toThrow('Dropbox delete_v2 failed (HTTP 500)');
    status = 409;
    text = '{"error_summary":"path/restricted_content/"}';
    await expect(t.has('latest/a.csv')).rejects.toThrow('restricted_content');
  });
});
