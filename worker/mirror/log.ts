/**
 * `logs/mirror.log` in the Dropbox copy (docs/06-operations.md §1.2): one line per run, oldest first, so
 * someone without the app can see whether the copy is alive. It is rebuilt from `mirror_runs` (the last
 * 500 runs) and written whole, so Dropbox's content hash skips it when nothing changed.
 */
import type { Db } from '../db/db';

const LOG_LINES = 500;

interface RunRow {
  kind: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  files_written: number;
  error: string | null;
}

/** `2026-10-05 15:30:00Z on_change ok 16 files` / `… failed <one-line error>`. */
export function mirrorLogLine(run: RunRow): string {
  const at = run.started_at.slice(0, 19).replace('T', ' ');
  const result =
    run.status === 'ok'
      ? `ok ${String(run.files_written)} file${run.files_written === 1 ? '' : 's'}`
      : `failed ${(run.error ?? 'unknown error').replace(/\s+/g, ' ')}`;
  return `${at}Z ${run.kind} ${result}`;
}

export async function mirrorLogText(db: Db): Promise<string> {
  const rows = await db
    .prepare(
      `SELECT kind, status, started_at, finished_at, files_written, error FROM mirror_runs
       ORDER BY started_at DESC, rowid DESC LIMIT ?`,
    )
    .bind(LOG_LINES)
    .all<RunRow>();
  return `${rows.results.map(mirrorLogLine).reverse().join('\n')}\n`;
}
