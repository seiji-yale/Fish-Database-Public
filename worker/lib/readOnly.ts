/**
 * Read-only mode (T-021, FR-SYNC-04): while the Admin restores the database `settings.read_only` is `1`
 * and every write under `/api` is refused with 503, so nothing is lost between the restore point and the
 * end of the restore. Reads, signing in (session, invite and Guest URLs), chat read marks, the switch itself and
 * "Export now" stay open: the runbook needs an export *before* the restore.
 */
import type { MiddlewareHandler } from 'hono';
import { getSetting } from '../db/queries/settings';
import type { Bindings } from '../middleware/session';
import { ApiError } from './errors';
import { messages } from './messages';

const ALLOWED =
  /^\/api\/(session(\/|$)|join\/|guest\/|admin\/(read-only|mirror\/run)$|messages\/(read-all|[^/]+\/read)$)/;

export const isReadOnly = async (db: Bindings['DB']): Promise<boolean> =>
  (await getSetting(db, 'read_only')) === '1';

export function readOnlyGuard(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
    if (ALLOWED.test(new URL(c.req.url).pathname)) return next();
    if (await isReadOnly(c.env.DB))
      throw new ApiError(503, 'READ_ONLY', messages.readOnly, messages.readOnlyHint);
    return next();
  };
}
