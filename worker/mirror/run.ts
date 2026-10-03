/**
 * The mirror runner (T-020 Steps 1–2, FR-SYNC-01, docs/06-operations.md §1): a minute cron calls
 * `mirrorTick`, which decides with `domain/mirror.ts` whether to export, and `runMirror` writes the
 * export through a `MirrorTarget`. Failures never reach a user request: they are logged in
 * `mirror_runs`, shown to the Admin, and retried later. Nothing here uses Durable Objects or KV (NFR-08).
 */
import { labToday } from '../../domain/dates';
import {
  archivesToPrune,
  MIRROR_DEBOUNCE_MS,
  nextMirrorRun,
  type MirrorKind,
  type MirrorState,
} from '../../domain/mirror';
import type { Db } from '../db/db';
import { newId } from '../db/ids';
import { insertActivity } from '../db/queries/activities';
import { getSetting, setSetting } from '../db/queries/settings';
import { getUserById, listUsers } from '../db/queries/users';
import { buildExportFiles } from '../export/build';
import { exportLinesCsv } from '../export/linesCsv';
import { exportSchema } from '../export/schema';
import { buildSnapshotHtml } from '../export/snapshot';
import { mirrorLogText } from './log';
import { buildMirrorReadme } from './readme';
import { appDisplayName } from '../lib/appName';
import { mirrorImagePath } from '../export/imagePath';
import {
  acquireMirrorLock,
  clearMirrorDirty,
  getMirrorDirty,
  markMirrorDirty,
  releaseMirrorLock,
} from './state';
import { targetFromEnv, type MirrorEnv, type MirrorTarget } from './target';

const ATTEMPTS = 3;
/** The free plan allows 50 outgoing requests per invocation; images stop here and continue next minute. */
const REQUEST_BUDGET = 42;

export interface RunOptions {
  db: Db;
  target: MirrorTarget;
  kind: MirrorKind;
  now: Date;
  /** The person who pressed "Export now" (manual runs); automatic failures are credited to the maintainer. */
  triggeredBy?: string | null;
  /** Waits between upload attempts; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
  /** The time a run finishes at; tests pass the fake clock. */
  clock?: () => Date;
  /** The R2 bucket with the uploaded images (absent in plain local development). */
  files?: R2Bucket | undefined;
  appName?: string | undefined;
}

export type RunResult =
  | { status: 'ok'; filesWritten: number; moreImages: boolean }
  | { status: 'failed'; error: string }
  | { status: 'busy' };

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withRetries<T>(
  action: () => Promise<T>,
  sleep: (ms: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      await sleep(attempt * attempt * 1000);
    }
  }
}

/**
 * Who a failure is credited to. A person who pressed the button is credited as themselves; for an
 * automatic run it is the first active Admin (a real person since ADR-0005), else the first active member.
 * The retired built-in Admin entry and Guests are never credited (BR-5).
 */
async function failureAuthor(
  db: Db,
  triggeredBy: string | null | undefined,
): Promise<string | null> {
  if (triggeredBy) return (await getUserById(db, triggeredBy))?.id ?? null;
  const people = (await listUsers(db)).filter((user) => user.is_builtin === 0);
  return (
    (people.find((user) => user.role === 'admin') ?? people.find((user) => user.role === 'member'))
      ?.id ?? null
  );
}

async function recordRun(
  db: Db,
  run: {
    kind: MirrorKind;
    startedAt: Date;
    finishedAt: Date;
    filesWritten: number;
    error: string | null;
  },
): Promise<void> {
  // The row is written when the run is over, so `status` is final (ok or failed only).
  await db
    .prepare(
      `INSERT INTO mirror_runs (id, kind, status, started_at, finished_at, files_written, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId(),
      run.kind,
      run.error === null ? 'ok' : 'failed',
      run.startedAt.toISOString(),
      run.finishedAt.toISOString(),
      run.filesWritten,
      run.error,
    )
    .run();
}

/**
 * Images go to `latest/images/<line name>/<attachment id>-<file name>` (docs/06-operations.md §1.2).
 * An image never changes once stored (its key holds its id), so one that is already in Dropbox is not
 * read from R2 again. Removed images are not copied. Returns whether some are left for the next run.
 */
async function mirrorImages(
  db: Db,
  files: R2Bucket | undefined,
  target: MirrorTarget,
  sleep: (ms: number) => Promise<void>,
): Promise<{ uploaded: number; more: boolean }> {
  if (files === undefined) return { uploaded: 0, more: false };
  const [attachments, lines] = await Promise.all([
    db
      .prepare(
        'SELECT id, r2_key FROM attachments WHERE deleted_at IS NULL ORDER BY created_at, id',
      )
      .all<{ id: string; r2_key: string }>(),
    db.prepare('SELECT id, name FROM lines').all<{ id: string; name: string }>(),
  ]);
  const lineNames = new Map(lines.results.map((line) => [line.id, line.name]));
  let uploaded = 0;
  for (const attachment of attachments.results) {
    const lineId = attachment.r2_key.split('/')[1] ?? '';
    const path = `latest/images/${mirrorImagePath(lineNames.get(lineId) ?? lineId, attachment.id, attachment.r2_key)}`;
    if (await withRetries(() => target.has(path), sleep)) continue;
    if (target.requests() >= REQUEST_BUDGET) return { uploaded, more: true };
    const object = await files.get(attachment.r2_key);
    if (object === null) continue; // a missing object is reported by the restore drill, not here
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    if (await withRetries(() => target.put(path, bytes), sleep)) uploaded += 1;
  }
  return { uploaded, more: false };
}

/** `logs/mirror.log`, best effort: a log that cannot be written never turns a good run into a failed one. */
async function writeLog(db: Db, target: MirrorTarget): Promise<void> {
  try {
    await target.put('logs/mirror.log', await mirrorLogText(db));
  } catch {
    // The run row and the Admin status already hold the result.
  }
}

/** Exports now. Returns `busy` when another run holds the lock. */
export async function runMirror(options: RunOptions): Promise<RunResult> {
  const { db, target, kind, now, sleep = wait, clock = () => new Date() } = options;
  const appName = appDisplayName(options.appName);
  if (!(await acquireMirrorLock(db, now))) return { status: 'busy' };
  let filesWritten = 0;
  try {
    const dirtyAtStart = await getMirrorDirty(db);
    const { json, csvs } = await buildExportFiles(db, now, exportLinesCsv);
    exportSchema.parse(json); // a file we cannot read back is worse than no file
    const common: Record<string, string> = {
      ...csvs,
      'fish-database.json': `${JSON.stringify(json, null, 2)}\n`,
    };
    const folders = kind === 'nightly' ? ['latest', `archive/${labToday(now)}`] : ['latest'];
    for (const folder of folders) {
      // An archive keeps no images of its own: its viewer links to the ones in `latest/`.
      const files = {
        ...common,
        'snapshot.html': buildSnapshotHtml(
          json,
          folder === 'latest' ? 'images/' : '../../latest/images/',
          appName,
        ),
      };
      for (const [name, body] of Object.entries(files)) {
        if (await withRetries(() => target.put(`${folder}/${name}`, body), sleep))
          filesWritten += 1;
      }
    }
    if (kind === 'nightly') {
      const names = await withRetries(() => target.list('archive'), sleep);
      for (const name of archivesToPrune(names, now)) {
        await withRetries(() => target.remove(`archive/${name}`), sleep);
      }
    }
    if (await withRetries(() => target.put('README.txt', buildMirrorReadme(appName)), sleep))
      filesWritten += 1;
    const images = await mirrorImages(db, options.files, target, sleep);
    filesWritten += images.uploaded;
    const finished = clock();
    await recordRun(db, { kind, startedAt: now, finishedAt: finished, filesWritten, error: null });
    await writeLog(db, target);
    await setSetting(db, 'mirror_last_ok_at', finished.toISOString());
    await setSetting(db, 'mirror_last_error', null);
    if (images.more) {
      // Not every image fitted into this run: leave the flag so the next minute carries on.
      await markMirrorDirty(db, new Date(now.getTime() - MIRROR_DEBOUNCE_MS));
    } else {
      await clearMirrorDirty(db, dirtyAtStart);
    }
    return { status: 'ok', filesWritten, moreImages: images.more };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const finished = clock();
    await recordRun(db, {
      kind,
      startedAt: now,
      finishedAt: finished,
      filesWritten,
      error: message,
    });
    await setSetting(db, 'mirror_last_error', `${finished.toISOString()} ${message}`);
    await writeLog(db, target);
    const userId = await failureAuthor(db, options.triggeredBy);
    if (userId !== null) {
      await insertActivity(db, {
        id: newId(),
        line_id: null,
        user_id: userId,
        via_admin: 0,
        type: 'mirror_failed',
        summary: `The Dropbox copy failed: ${message}`,
        ref_type: null,
        ref_id: null,
        created_at: finished.toISOString(),
      });
    }
    return { status: 'failed', error: message };
  } finally {
    await releaseMirrorLock(db);
  }
}

async function mirrorState(db: Db, now: Date): Promise<MirrorState> {
  const newest = await db
    .prepare(
      'SELECT status, finished_at FROM mirror_runs ORDER BY started_at DESC, rowid DESC LIMIT 1',
    )
    .first<{ status: string; finished_at: string | null }>();
  const nightly = await db
    .prepare(
      "SELECT started_at FROM mirror_runs WHERE kind = 'nightly' AND status = 'ok' ORDER BY started_at DESC LIMIT 1",
    )
    .first<{ started_at: string }>();
  return {
    now,
    dirtyAt: await getMirrorDirty(db),
    lastFailedAt: newest?.status === 'failed' ? newest.finished_at : null,
    lastNightlyDay: nightly === null ? null : labToday(new Date(nightly.started_at)),
  };
}

/** The cron entry: runs at most one export when one is due. `null` target = mirror not set up. */
export async function mirrorTick(
  db: Db,
  target: MirrorTarget | null,
  now: Date,
  extra: Pick<RunOptions, 'sleep' | 'clock' | 'files' | 'appName'> = {},
): Promise<RunResult | null> {
  if (target === null) return null;
  const kind = nextMirrorRun(await mirrorState(db, now));
  if (kind === null) return null;
  return runMirror({ db, target, kind, now, ...extra });
}

export async function mirrorStatus(
  db: Db,
): Promise<{ lastOkAt: string | null; lastError: string | null }> {
  const [lastOkAt, lastError] = await Promise.all([
    getSetting(db, 'mirror_last_ok_at'),
    getSetting(db, 'mirror_last_error'),
  ]);
  return { lastOkAt, lastError };
}

/**
 * What the minute cron runs. It notes when it last ran (`mirror_last_tick_at`, shown to the Admin) and
 * keeps an unexpected error in `mirror_last_error`, so a broken cron is visible instead of silent.
 */
export async function scheduledMirror(
  env: MirrorEnv & { DB: Db; FILES?: R2Bucket | undefined; APP_NAME?: string },
  now: Date,
): Promise<RunResult | null> {
  try {
    await setSetting(env.DB, 'mirror_last_tick_at', now.toISOString());
    const target = await targetFromEnv(env, env.DB);
    const configuredAppName = await getSetting(env.DB, 'app_name');
    return await mirrorTick(env.DB, target, now, {
      files: env.FILES,
      appName: configuredAppName ?? env.APP_NAME,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setSetting(env.DB, 'mirror_last_error', `${now.toISOString()} ${message}`);
    return { status: 'failed', error: message };
  }
}
