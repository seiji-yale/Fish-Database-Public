/**
 * When the Dropbox mirror runs (T-020, FR-SYNC-01, docs/06-operations.md §1.3). Pure rules; the Worker
 * reads the clock and the settings and asks these functions what to do.
 *
 * - A write sets a "dirty" time; the minute cron exports once the flag is old enough (debounce), so a
 *   burst of edits makes one run.
 * - A failed run is not retried for a few minutes, so a broken Dropbox is not hammered every minute.
 * - Once a lab day (after 03:00 New York time, docs/06-operations.md §1.3) the whole export is also archived, and archives older
 *   than 90 days are pruned.
 * - The Admin is warned when the last run failed or no run succeeded for 24 hours.
 */
import { labToday } from './dates';

export const MIRROR_DEBOUNCE_MS = 2 * 60 * 1000;
export const MIRROR_RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
export const MIRROR_STALE_MS = 24 * 60 * 60 * 1000;
export const ARCHIVE_KEEP_DAYS = 90;
const NIGHTLY_FROM_HOUR = 3;

export type MirrorKind = 'on_change' | 'nightly' | 'manual';

function labHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(now),
  );
}

export interface MirrorState {
  now: Date;
  /** `settings.mirror_dirty_at`: the first write since the last export (ISO), or null. */
  dirtyAt: string | null;
  /** When the latest failed run finished, if that is the newest run. */
  lastFailedAt: string | null;
  /** Lab day (`YYYY-MM-DD`) of the newest successful nightly run. */
  lastNightlyDay: string | null;
}

/** What the minute cron should do now: a nightly run, an on-change run, or nothing. */
export function nextMirrorRun(state: MirrorState): MirrorKind | null {
  const { now } = state;
  if (
    state.lastFailedAt !== null &&
    now.getTime() - new Date(state.lastFailedAt).getTime() < MIRROR_RETRY_AFTER_FAILURE_MS
  )
    return null;
  if (labHour(now) >= NIGHTLY_FROM_HOUR && state.lastNightlyDay !== labToday(now)) return 'nightly';
  if (
    state.dirtyAt !== null &&
    now.getTime() - new Date(state.dirtyAt).getTime() >= MIRROR_DEBOUNCE_MS
  )
    return 'on_change';
  return null;
}

/** Archive folder names (`YYYY-MM-DD`) to remove: older than the keep window. Other names are never touched. */
export function archivesToPrune(
  names: readonly string[],
  now: Date,
  keepDays: number = ARCHIVE_KEEP_DAYS,
): string[] {
  const cutoff = new Date(`${labToday(now)}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);
  const limit = cutoff.toISOString().slice(0, 10);
  return names.filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name) && name < limit);
}

/** True when the Admin should be warned: the last run failed, or nothing succeeded for 24 hours. */
export function isMirrorStale(
  lastOkAt: string | null,
  lastError: string | null,
  now: Date,
): boolean {
  if (lastOkAt === null && lastError === null) return false; // never set up: nothing to warn about
  if (lastError !== null) return true;
  return now.getTime() - new Date(lastOkAt as string).getTime() > MIRROR_STALE_MS;
}
