import type { MiddlewareHandler } from 'hono';
import type { Bindings } from '../middleware/session';
import { markMirrorDirty } from './state';

/** Writes that change no exported data: signing in, chat read marks, and "Export now" itself. */
const QUIET =
  /^\/api\/(session(\/|$)|join\/|guest\/|admin\/mirror\/run$|messages\/(read-all|[^/]+\/read)$)/;

/**
 * After any successful write under `/api`, remember that the Dropbox copy is out of date (FR-SYNC-01).
 * One place instead of a call in every route; a failure here never fails the user's request.
 */
export function mirrorDirtyMarker(): MiddlewareHandler<{ Bindings: Bindings }> {
  return async (c, next) => {
    await next();
    if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) || c.res.status >= 400) return;
    if (QUIET.test(new URL(c.req.url).pathname)) return;
    try {
      await markMirrorDirty(c.env.DB, new Date());
    } catch {
      /* the nightly run still catches the change */
    }
  };
}
