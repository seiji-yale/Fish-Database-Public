import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMigratedDb } from '../db/testing/testDb';
import { getSetting, setSetting } from '../db/queries/settings';
import { getUserByName } from '../db/queries/users';
import { loadFixture } from '../db/fixtures';
import fixture from '../../tests/fixtures/lines.small.json';
import { browser, fakeBucket, type ErrorBody } from '../testBrowser';
import { mirrorDirtyMarker } from './dirty';
import { mirrorLogLine } from './log';
import { mirrorTick, runMirror, scheduledMirror } from './run';
import { acquireMirrorLock, markMirrorDirty, releaseMirrorLock } from './state';
import type { MirrorTarget } from './target';
import type { Bindings } from '../middleware/session';

/** A folder in memory that can be told to fail. */
class FakeTarget implements MirrorTarget {
  files = new Map<string, string | Uint8Array>();
  removed: string[] = [];
  failures = 0;
  puts = 0;
  put(path: string, body: string | Uint8Array): Promise<boolean> {
    this.puts += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      return Promise.reject(new Error('Dropbox is down'));
    }
    const same = String(this.files.get(path)) === String(body);
    this.files.set(path, body);
    return Promise.resolve(!same);
  }
  has(path: string): Promise<boolean> {
    return Promise.resolve(this.files.has(path));
  }
  requests(): number {
    return this.puts;
  }
  list(folder: string): Promise<string[]> {
    const names = new Set<string>();
    for (const path of this.files.keys())
      if (path.startsWith(`${folder}/`))
        names.add(path.slice(folder.length + 1).split('/')[0] ?? '');
    return Promise.resolve([...names]);
  }
  remove(path: string): Promise<void> {
    this.removed.push(path);
    for (const key of [...this.files.keys()])
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    return Promise.resolve();
  }
}

const noSleep = () => Promise.resolve();
const clock = () => new Date('2026-10-05T15:30:00Z');
const at = (iso: string) => new Date(iso);

async function database() {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  return db;
}

/** Records that today's nightly run already happened (2026-10-05), so only on-change runs are due. */
async function nightlyDone(db: Awaited<ReturnType<typeof database>>) {
  await db
    .prepare(
      "INSERT INTO mirror_runs (id, kind, status, started_at, finished_at) VALUES ('n1', 'nightly', 'ok', '2026-10-05T07:00:00.000Z', '2026-10-05T07:01:00.000Z')",
    )
    .run();
}

const runs = async (db: Awaited<ReturnType<typeof database>>) =>
  (
    await db
      .prepare('SELECT kind, status, files_written, error FROM mirror_runs ORDER BY rowid')
      .all()
  ).results;

describe('dirty flag and debounce', () => {
  it('keeps the first write time, so three writes within a minute make one run', async () => {
    const db = await database();
    const target = new FakeTarget();
    await nightlyDone(db);
    await markMirrorDirty(db, at('2026-10-05T14:00:00Z'));
    await markMirrorDirty(db, at('2026-10-05T14:00:20Z'));
    await markMirrorDirty(db, at('2026-10-05T14:00:40Z'));
    expect(await getSetting(db, 'mirror_dirty_at')).toBe('2026-10-05T14:00:00.000Z');
    // Too early: nothing. Two minutes after the first write: exactly one run.
    expect(
      await mirrorTick(db, target, at('2026-10-05T14:01:00Z'), { sleep: noSleep, clock }),
    ).toBeNull();
    const first = await mirrorTick(db, target, at('2026-10-05T14:02:00Z'), {
      sleep: noSleep,
      clock,
    });
    expect(first).toMatchObject({ status: 'ok' });
    expect(
      await mirrorTick(db, target, at('2026-10-05T14:03:00Z'), { sleep: noSleep, clock }),
    ).toBeNull();
    const kinds = (await runs(db)).map((run) => (run as { kind: string }).kind);
    expect(kinds.filter((kind) => kind === 'on_change')).toHaveLength(1);
    expect(await getSetting(db, 'mirror_dirty_at')).toBeNull();
  });

  it('a write that arrives during a run keeps the flag for the next run', async () => {
    const db = await database();
    const target = new FakeTarget();
    await markMirrorDirty(db, at('2026-10-05T14:00:00Z'));
    const original = target.put.bind(target);
    target.put = async (path, body) => {
      const written = await original(path, body);
      // A new write while the export runs: the flag is replaced by a later time.
      await db
        .prepare(
          "UPDATE settings SET value = '2026-10-05T14:02:30.000Z' WHERE key = 'mirror_dirty_at'",
        )
        .run();
      return written;
    };
    await runMirror({
      db,
      target,
      kind: 'on_change',
      now: at('2026-10-05T14:02:00Z'),
      sleep: noSleep,
    });
    expect(await getSetting(db, 'mirror_dirty_at')).toBe('2026-10-05T14:02:30.000Z');
  });

  it('every successful write under /api marks the mirror dirty; reads, refusals and session calls do not', async () => {
    const db = await database();
    const s = browser(db);
    const dirty = () => getSetting(db, 'mirror_dirty_at');
    await s.call('/api/lines');
    await s.actAs('Bob'); // session calls change no exported data
    await s.call('/api/messages/read-all', {});
    expect(await dirty()).toBeNull();
    // A refused write (Guest cannot add users) is not a change either.
    expect((await s.call('/api/admin/users', {})).status).toBe(403);
    expect(await dirty()).toBeNull();
    // A real write marks the flag.
    expect((await s.call('/api/messages', { body: 'hello lab' })).status).toBe(201);
    expect(await dirty()).not.toBeNull();
  });

  it('a failure to mark never fails the request', async () => {
    const { Hono } = await import('hono');
    const broken = new Hono<{ Bindings: Bindings }>();
    broken.use('/api/*', mirrorDirtyMarker());
    broken.post('/api/x', (c) => c.json({ ok: true }));
    const db = await database();
    db.prepare = () => {
      throw new Error('database unavailable');
    };
    const response = await broken.request(
      '/api/x',
      { method: 'POST' },
      { DB: db, SESSION_SIGNING_KEY: 'k' },
    );
    expect(response.status).toBe(200);
  });
});

describe('runs', () => {
  it('writes the export to latest/ and logs the run', async () => {
    const db = await database();
    const target = new FakeTarget();
    const result = await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:00:00Z'),
      sleep: noSleep,
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect([...target.files.keys()].sort()).toContain('latest/fish-database.json');
    expect([...target.files.keys()]).toContain('latest/lines.csv');
    expect([...target.files.keys()].some((path) => path.startsWith('archive/'))).toBe(false);
    expect(await runs(db)).toEqual([expect.objectContaining({ kind: 'manual', status: 'ok' })]);
    expect(await getSetting(db, 'mirror_last_ok_at')).not.toBeNull();
    expect(await getSetting(db, 'mirror_running_since')).toBeNull();
  });

  it('uses a saved database name for mirror readme and snapshot output', async () => {
    const db = await database();
    const target = new FakeTarget();
    await setSetting(db, 'app_name', 'Scheduled Demo DB');
    const result = await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:00:00Z'),
      sleep: noSleep,
      clock,
      appName: (await getSetting(db, 'app_name')) ?? undefined,
    });
    expect(result).toMatchObject({ status: 'ok' });
    expect(String(target.files.get('README.txt'))).toContain('Scheduled Demo DB - automatic copy');
    expect(String(target.files.get('latest/snapshot.html'))).toContain(
      '<h1 id="app-name">Scheduled Demo DB</h1>',
    );
  });

  it('the nightly run also archives under the lab day and prunes archives older than 90 days', async () => {
    const db = await database();
    const target = new FakeTarget();
    target.files.set('archive/2026-01-01/lines.csv', 'old');
    target.files.set('archive/2026-07-07/lines.csv', 'boundary');
    target.files.set('archive/readme.txt', 'not a date');
    const result = await mirrorTick(db, target, at('2026-10-05T07:00:00Z'), {
      sleep: noSleep,
      clock,
    }); // 03:00 New York
    expect(result).toMatchObject({ status: 'ok' });
    expect(target.files.has('archive/2026-10-05/fish-database.json')).toBe(true);
    // The viewer is in both folders (an archive's image links point into latest/: see snapshot.test.ts).
    expect(String(target.files.get('latest/snapshot.html'))).toContain('demo_c3');
    expect(String(target.files.get('archive/2026-10-05/snapshot.html'))).toContain('demo_c3');
    expect(target.files.has('latest/fish-database.json')).toBe(true);
    expect(target.removed).toEqual(['archive/2026-01-01']);
    expect(target.files.has('archive/2026-07-07/lines.csv')).toBe(true);
    expect(target.files.has('archive/readme.txt')).toBe(true);
    // Not again the same lab day.
    expect(
      await mirrorTick(db, target, at('2026-10-05T08:00:00Z'), { sleep: noSleep, clock }),
    ).toBeNull();
    expect((await runs(db))[0]).toMatchObject({ kind: 'nightly', status: 'ok' });
  });

  it('retries an upload, then gives up, records the failure and credits the maintainer', async () => {
    const db = await database();
    const target = new FakeTarget();
    target.failures = 2; // fails twice, succeeds on the third attempt
    const waits: number[] = [];
    const ok = await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:00:00Z'),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    expect(ok.status).toBe('ok');
    expect(waits).toEqual([1000, 4000]);

    target.failures = 99;
    const failed = await runMirror({
      db,
      target,
      kind: 'on_change',
      now: at('2026-10-05T15:10:00Z'),
      sleep: noSleep,
    });
    expect(failed).toEqual({ status: 'failed', error: 'Dropbox is down' });
    expect(await getSetting(db, 'mirror_last_error')).toContain('Dropbox is down');
    const activity = await db
      .prepare("SELECT user_id, summary FROM activities WHERE type = 'mirror_failed'")
      .first<{ user_id: string; summary: string }>();
    // No Admin person exists in the seeded database: the first active member is credited.
    expect(activity?.user_id).toBe((await getUserByName(db, 'Alice'))?.id);
    expect((await runs(db)).at(-1)).toMatchObject({ status: 'failed', error: 'Dropbox is down' });
    // The failure also clears the lock, and a later success clears the error.
    target.failures = 0;
    await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:20:00Z'),
      sleep: noSleep,
    });
    expect(await getSetting(db, 'mirror_last_error')).toBeNull();
  });

  it('a manual failure is credited to the person who pressed the button', async () => {
    const db = await database();
    const target = new FakeTarget();
    target.failures = 99;
    const alice = await getUserByName(db, 'Alice');
    await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:00:00Z'),
      sleep: noSleep,
      triggeredBy: alice?.id ?? null,
    });
    const activity = await db
      .prepare("SELECT user_id FROM activities WHERE type = 'mirror_failed'")
      .first<{ user_id: string }>();
    expect(activity?.user_id).toBe(alice?.id);
  });

  it('is not retried for five minutes after a failure, and does nothing without a target', async () => {
    const db = await database();
    await nightlyDone(db);
    const target = new FakeTarget();
    target.failures = 99;
    await markMirrorDirty(db, at('2026-10-05T14:00:00Z'));
    const failing = { sleep: noSleep, clock: () => at('2026-10-05T14:10:00Z') };
    expect((await mirrorTick(db, target, at('2026-10-05T14:10:00Z'), failing))?.status).toBe(
      'failed',
    );
    const puts = target.puts;
    expect(await mirrorTick(db, target, at('2026-10-05T14:13:00Z'), failing)).toBeNull();
    expect(target.puts).toBe(puts);
    target.failures = 0;
    expect((await mirrorTick(db, target, at('2026-10-05T14:16:00Z'), failing))?.status).toBe('ok');
    expect(await mirrorTick(db, null, at('2026-10-05T14:20:00Z'))).toBeNull();
  });

  it('only one run at a time; a dead lock is taken over after ten minutes', async () => {
    const db = await database();
    const target = new FakeTarget();
    expect(await acquireMirrorLock(db, at('2026-10-05T15:00:00Z'))).toBe(true);
    expect(
      await runMirror({
        db,
        target,
        kind: 'manual',
        now: at('2026-10-05T15:05:00Z'),
        sleep: noSleep,
      }),
    ).toEqual({ status: 'busy' });
    expect(target.puts).toBe(0);
    expect(await acquireMirrorLock(db, at('2026-10-05T15:11:00Z'))).toBe(true);
    await releaseMirrorLock(db);
    expect(await acquireMirrorLock(db, at('2026-10-05T15:12:00Z'))).toBe(true);
  });

  it('an automatic failure is credited to the first active Admin when there is one', async () => {
    const db = await database();
    const carol = await getUserByName(db, 'Carol');
    await db.prepare("UPDATE users SET role = 'admin' WHERE name = 'Carol'").run();
    const target = new FakeTarget();
    target.failures = 99;
    await runMirror({
      db,
      target,
      kind: 'nightly',
      now: at('2026-10-05T15:00:00Z'),
      sleep: noSleep,
    });
    const failed = await db
      .prepare("SELECT user_id FROM activities WHERE type = 'mirror_failed'")
      .first<{ user_id: string }>();
    expect(failed?.user_id).toBe(carol?.id);
  });

  it('with no member to credit, a failure is still logged', async () => {
    const db = await database();
    await db.prepare("UPDATE users SET role = 'guest' WHERE role = 'member'").run();
    const target = new FakeTarget();
    target.failures = 99;
    const result = await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:00:00Z'),
      sleep: noSleep,
    });
    expect(result.status).toBe('failed');
    expect(
      await db.prepare("SELECT count(*) AS n FROM activities WHERE type = 'mirror_failed'").first(),
    ).toEqual({ n: 0 });
  });
});

describe('Admin warning', () => {
  it('GET /api/session tells a logged-in Admin when the Dropbox copy is stale', async () => {
    const db = await database();
    const s = browser(db);
    await s.actAs('Admin');
    const session = async (who: ReturnType<typeof browser>) =>
      (await who.call('/api/session')).json();
    expect(await session(s)).toMatchObject({ mirrorStale: false });
    await setSetting(db, 'mirror_last_error', '2026-10-05T15:00:00.000Z Dropbox is down');
    expect(await session(s)).toMatchObject({ mirrorStale: true });
    expect(await session(browser(db))).toMatchObject({ mirrorStale: false });
  });
});

describe('images', () => {
  async function withImages(count: number, lineName = 'demo_c3') {
    const db = await database();
    const line = await db
      .prepare("SELECT id FROM lines WHERE name = 'demo_c3'")
      .first<{ id: string }>();
    const lineId = line?.id ?? '';
    if (lineName !== 'demo_c3')
      await db.prepare('UPDATE lines SET name = ? WHERE id = ?').bind(lineName, lineId).run();
    const bob = await getUserByName(db, 'Bob');
    const objects = new Map<string, Uint8Array>();
    for (let index = 0; index < count; index += 1) {
      const id = `att${String(index).padStart(3, '0')}`;
      const key = `lines/${lineId}/${id}-gel.jpg`;
      objects.set(key, new Uint8Array([index]));
      await db
        .prepare(
          `INSERT INTO attachments (id, owner_type, owner_id, kind, file_name, r2_key, created_at, created_by)
           VALUES (?, 'line', ?, 'gel_image', 'gel.jpg', ?, ?, ?)`,
        )
        .bind(
          id,
          lineId,
          key,
          `2026-10-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
          bob?.id,
        )
        .run();
    }
    let gets = 0;
    const bucket = fakeBucket(objects);
    const files = {
      get: (key: string) => {
        gets += 1;
        return bucket.get(key);
      },
    } as unknown as R2Bucket;
    return { db, lineId, files, gets: () => gets };
  }

  it('copies active images once to latest/images/<line>/, never read again', async () => {
    const { db, files, gets } = await withImages(3);
    await db
      .prepare("UPDATE attachments SET deleted_at = '2026-10-02T00:00:00Z' WHERE id = 'att002'")
      .run();
    const target = new FakeTarget();
    const now = at('2026-10-05T15:00:00Z');
    expect(
      await runMirror({ db, target, kind: 'manual', now, sleep: noSleep, clock, files }),
    ).toMatchObject({ status: 'ok', moreImages: false });
    const images = [...target.files.keys()].filter((path) => path.includes('/images/')).sort();
    expect(images).toEqual([
      'latest/images/demo_c3/att000-gel.jpg',
      'latest/images/demo_c3/att001-gel.jpg',
    ]);
    expect(gets()).toBe(2);
    await runMirror({ db, target, kind: 'manual', now, sleep: noSleep, clock, files });
    expect(gets()).toBe(2); // already in Dropbox: not read from R2
    // The archive has no images (docs/06-operations.md §1.2).
    await runMirror({ db, target, kind: 'nightly', now, sleep: noSleep, clock, files });
    expect(
      [...target.files.keys()].some(
        (path) => path.startsWith('archive/') && path.includes('images'),
      ),
    ).toBe(false);
  });

  it('a "/" in a line name does not make a sub-folder; a missing R2 object is skipped', async () => {
    const { db, files } = await withImages(1, 'Tg(a/b)');
    await db
      .prepare(
        `INSERT INTO attachments (id, owner_type, owner_id, kind, r2_key, created_at, created_by)
         SELECT 'gone', 'line', owner_id, 'other', 'lines/' || owner_id || '/gone-x.png', created_at, created_by FROM attachments LIMIT 1`,
      )
      .run();
    const target = new FakeTarget();
    await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:00:00Z'),
      sleep: noSleep,
      clock,
      files,
    });
    const images = [...target.files.keys()].filter((path) => path.includes('/images/'));
    expect(images).toEqual(['latest/images/Tg-a-b/att000-gel.jpg']);
  });

  it('stops before the request limit and carries on in the next minute', async () => {
    const { db, files } = await withImages(60);
    await nightlyDone(db);
    const target = new FakeTarget();
    const first = await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:00:00Z'),
      sleep: noSleep,
      clock,
      files,
    });
    expect(first).toMatchObject({ status: 'ok', moreImages: true });
    const copied = () =>
      [...target.files.keys()].filter((path) => path.includes('/images/')).length;
    expect(copied()).toBeLessThan(60);
    // The flag is set so the next ticks continue (each tick is a new invocation with a fresh budget).
    for (let minute = 1; minute <= 3 && copied() < 60; minute += 1) {
      target.puts = 0;
      const next = await mirrorTick(db, target, at(`2026-10-05T15:0${String(minute)}:00Z`), {
        sleep: noSleep,
        clock,
        files,
      });
      expect(next).toMatchObject({ status: 'ok' });
    }
    expect(copied()).toBe(60);
    expect(await getSetting(db, 'mirror_dirty_at')).toBeNull();
  });
});

describe('scheduled entry', () => {
  it('notes the tick, does nothing without secrets, and keeps an unexpected error', async () => {
    const db = await database();
    expect(await scheduledMirror({ DB: db }, at('2026-10-05T15:00:00Z'))).toBeNull();
    expect(await getSetting(db, 'mirror_last_tick_at')).toBe('2026-10-05T15:00:00.000Z');
    const broken = await database();
    const prepare = broken.prepare.bind(broken);
    broken.prepare = (sql: string) => {
      if (sql.includes('mirror_runs')) throw new Error('no such table: mirror_runs');
      return prepare(sql);
    };
    const result = await scheduledMirror(
      { DB: broken, DROPBOX_APP_KEY: 'k', DROPBOX_REFRESH_TOKEN: 'r' },
      at('2026-10-05T15:00:00Z'),
    );
    expect(result).toEqual({ status: 'failed', error: 'no such table: mirror_runs' });
    expect(await getSetting(broken, 'mirror_last_error')).toContain('no such table');
  });
});

describe('log and README', () => {
  it('writes README.txt and logs/mirror.log, one line per run, oldest first', async () => {
    const db = await database();
    const target = new FakeTarget();
    await runMirror({
      db,
      target,
      kind: 'manual',
      now: at('2026-10-05T15:00:00Z'),
      sleep: noSleep,
      clock,
    });
    expect(String(target.files.get('README.txt'))).toContain('Do not edit anything here');
    target.failures = 99;
    await runMirror({
      db,
      target,
      kind: 'on_change',
      now: at('2026-10-05T15:10:00Z'),
      sleep: noSleep,
      clock,
    });
    target.failures = 0;
    await runMirror({
      db,
      target,
      kind: 'on_change',
      now: at('2026-10-05T15:20:00Z'),
      sleep: noSleep,
      clock,
    });
    const lines = String(target.files.get('logs/mirror.log')).trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^2026-10-05 15:00:00Z manual ok \d+ files$/);
    expect(lines[1]).toBe('2026-10-05 15:10:00Z on_change failed Dropbox is down');
    expect(lines[2]).toMatch(/^2026-10-05 15:20:00Z on_change ok /);
  });

  it('uses the singular for one file, and a log that cannot be written does not fail the run', async () => {
    expect(
      mirrorLogLine({
        kind: 'on_change',
        status: 'ok',
        started_at: '2026-10-05T15:00:00.000Z',
        finished_at: null,
        files_written: 1,
        error: null,
      }),
    ).toBe('2026-10-05 15:00:00Z on_change ok 1 file');
    expect(
      mirrorLogLine({
        kind: 'nightly',
        status: 'failed',
        started_at: '2026-10-05T15:00:00.000Z',
        finished_at: null,
        files_written: 0,
        error: null,
      }),
    ).toBe('2026-10-05 15:00:00Z nightly failed unknown error');
    const db = await database();
    const target = new FakeTarget();
    const put = target.put.bind(target);
    target.put = (path, body) =>
      path === 'logs/mirror.log' ? Promise.reject(new Error('log refused')) : put(path, body);
    expect(
      await runMirror({
        db,
        target,
        kind: 'manual',
        now: at('2026-10-05T15:00:00Z'),
        sleep: noSleep,
        clock,
      }),
    ).toMatchObject({ status: 'ok' });
  });
});

type Overview = {
  mirror: {
    connected: boolean;
    folder: string;
    lastOkAt: string | null;
    pending: boolean;
    runs: { kind: string; status: string }[];
  };
};
const body = <T>(response: Response): Promise<T> => response.json<T>();

describe('Export now (Admin) and the status overview', () => {
  const secrets = { DROPBOX_APP_KEY: 'k', DROPBOX_REFRESH_TOKEN: 'r', MIRROR_FOLDER: '/preview' };

  /** A Dropbox that accepts everything (and, when asked, refuses uploads). */
  function stubDropbox(refuse = false) {
    const uploads: string[] = [];
    const contents = new Map<string, string>();
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/oauth2/token'))
        return Promise.resolve(Response.json({ access_token: 'a', expires_in: 14400 }));
      if (url.endsWith('/2/files/list_folder'))
        return Promise.resolve(
          Response.json({ error_summary: 'path/not_found/' }, { status: 409 }),
        );
      if (url.endsWith('/2/files/upload')) {
        if (refuse)
          return Promise.resolve(
            Response.json({ error_summary: 'insufficient_space/' }, { status: 409 }),
          );
        const arg = (init?.headers as Record<string, string>)['Dropbox-API-Arg'] ?? '{}';
        const path = (JSON.parse(arg) as { path: string }).path;
        uploads.push(path);
        if (init?.body instanceof Uint8Array)
          contents.set(path, new TextDecoder().decode(init.body));
        return Promise.resolve(Response.json({ name: 'x' }));
      }
      return Promise.resolve(Response.json({}, { status: 400 }));
    });
    return Object.assign(uploads, { contents });
  }
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is for the Admin only', async () => {
    const s = browser(await database(), secrets);
    await s.actAs('Bob');
    expect((await s.call('/api/admin/mirror/run', {})).status).toBe(403);
  });

  it('says so when the server has no Dropbox connection', async () => {
    const s = browser(await database());
    await s.actAs('Admin');
    const response = await s.call('/api/admin/mirror/run', { chosenUserId: await s.idOf('Bob') });
    expect(response.status).toBe(409);
    expect((await body<ErrorBody>(response)).error.code).toBe('MIRROR_NOT_SET_UP');
    const overview = await body<Overview>(await s.call('/api/admin/overview'));
    expect(overview.mirror).toMatchObject({
      connected: false,
      folder: '/',
      runs: [],
      pending: false,
    });
  });

  it('runs the copy for the signed-in Admin and does not mark the data as changed', async () => {
    const uploads = stubDropbox();
    const db = await database();
    const s = browser(db, secrets);
    await s.actAs('Admin');
    const response = await s.call('/api/admin/mirror/run', {});
    expect(response.status).toBe(200);
    expect((await body<{ filesWritten: number }>(response)).filesWritten).toBeGreaterThan(10);
    expect(uploads).toContain('/preview/latest/snapshot.html');
    expect(uploads).toContain('/preview/README.txt');
    expect(uploads).toContain('/preview/latest/lines.csv');
    expect(await getSetting(db, 'mirror_dirty_at')).toBeNull();
    const overview = await body<Overview>(await s.call('/api/admin/overview'));
    expect(overview.mirror).toMatchObject({
      connected: true,
      folder: '/preview',
      runs: [{ kind: 'manual', status: 'ok' }],
    });
    expect(overview.mirror.lastOkAt).not.toBeNull();
  });

  it('uses the saved database name in automatic mirror exports', async () => {
    const uploads = stubDropbox();
    const db = await database();
    await setSetting(db, 'app_name', 'Automatic Demo DB');
    await nightlyDone(db);
    await setSetting(db, 'mirror_dirty_at', '2026-10-05T14:00:00.000Z');
    const result = await scheduledMirror({ DB: db, ...secrets }, at('2026-10-05T14:02:00.000Z'));
    expect(result).toMatchObject({ status: 'ok' });
    expect(uploads.contents.get('/preview/README.txt')).toContain(
      'Automatic Demo DB - automatic copy',
    );
    expect(uploads.contents.get('/preview/latest/snapshot.html')).toContain(
      '<h1 id="app-name">Automatic Demo DB</h1>',
    );
  });

  it('shows a failure to the Admin, credits the person who pressed the button, and turns the banner on', async () => {
    stubDropbox(true);
    const db = await database();
    const s = browser(db, secrets);
    const adminId = await s.actAs('Admin');
    const response = await s.call('/api/admin/mirror/run', {});
    expect(response.status).toBe(502);
    const failure = await body<ErrorBody>(response);
    expect(failure.error.code).toBe('MIRROR_FAILED');
    expect(failure.error.message).toContain('insufficient_space');
    const failed = await db
      .prepare("SELECT user_id FROM activities WHERE type = 'mirror_failed'")
      .first<{ user_id: string }>();
    expect(failed?.user_id).toBe(adminId);
    expect((await body<{ mirrorStale: boolean }>(await s.call('/api/session'))).mirrorStale).toBe(
      true,
    );
  }, 20000);

  it('refuses a second run while one is running', async () => {
    stubDropbox();
    const db = await database();
    await acquireMirrorLock(db, new Date());
    const s = browser(db, secrets);
    await s.actAs('Admin');
    const response = await s.call('/api/admin/mirror/run', { chosenUserId: await s.idOf('Bob') });
    expect(response.status).toBe(409);
    expect((await body<ErrorBody>(response)).error.code).toBe('MIRROR_BUSY');
  });
});
