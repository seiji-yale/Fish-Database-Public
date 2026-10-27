/**
 * Route coverage (T-032, BR-15, ADR-0006): every route the Worker registers is classified, and each
 * class is called as Guest, Feeder, Member and Admin with the expected outcome. A new route without a
 * row fails the first test, so a capability check cannot be forgotten.
 *
 * - `open`      signed-in or sign-in routes with no capability (not called: they need real bodies/tokens)
 * - `overview`  readable by every role (restricted roles get the overview shape)
 * - `full`      full readers only (Member, Admin): Guests and Feeders get 403
 * - `write`     needs `lines.write` or `chat.write`: Guests and Feeders get 403
 * - `roster`    needs `users.list`: Guests get 403
 * - `feeding`   Feeding Schedule routes (`feeding.read` / `feeding.write`): Guests get 403
 * - `admin`     Admin only: everyone else gets 403
 */
import { describe, expect, it } from 'vitest';
import app from './index';
import { browser } from './testBrowser';

type RouteClass = 'open' | 'overview' | 'full' | 'write' | 'roster' | 'feeding' | 'admin';

const ROUTES: Record<string, RouteClass> = {
  'GET /api/health': 'open',
  'GET /api/session': 'open',
  'POST /api/session/login': 'open',
  'POST /api/session/logout': 'open',
  'POST /api/session/password': 'open',
  'GET /api/join/:token': 'open',
  'POST /api/join/:token': 'open',
  'POST /api/guest/:token': 'open',
  'GET /api/settings/public': 'open',
  'GET /api/guest-link': 'full',
  'GET /api/users': 'roster',
  'POST /api/attribution/check': 'write',
  'GET /api/lines': 'overview',
  'GET /api/lines.csv': 'full',
  'GET /api/lines/check-name': 'write',
  'POST /api/lines': 'write',
  'GET /api/enumerations': 'full',
  'GET /api/dashboard': 'overview',
  'GET /api/activities': 'full',
  'GET /api/lines/:id': 'overview',
  'PATCH /api/lines/:id': 'write',
  'GET /api/lines/:id/restore/:versionNo/preview': 'full',
  'POST /api/lines/:id/restore/:versionNo': 'admin',
  'POST /api/lines/:id/start-breeding': 'write',
  'POST /api/lines/:id/cancel-breeding': 'write',
  'POST /api/lines/:id/genotyping': 'write',
  'POST /api/lines/:id/close': 'write',
  'POST /api/lines/:id/reopen': 'write',
  'POST /api/lines/:id/protocols/reorder': 'write',
  'POST /api/lines/:id/protocols': 'write',
  'PATCH /api/lines/:id/protocols/:pid': 'write',
  'DELETE /api/lines/:id/protocols/:pid': 'write',
  'POST /api/lines/:id/protocols/:pid/set-current': 'write',
  'POST /api/lines/:id/protocols/:pid/restore': 'admin',
  'GET /api/cryo/next-id': 'write',
  'POST /api/lines/:id/cryo': 'write',
  'POST /api/lines/:id/cryo/use': 'write',
  'POST /api/lines/:id/cryo/uses/:useId/undo': 'write',
  'PATCH /api/lines/:id/cryo/:cid': 'write',
  'DELETE /api/lines/:id/cryo/:cid': 'write',
  'POST /api/lines/:id/attachments': 'write',
  'DELETE /api/lines/:id/attachments/:aid': 'write',
  'PATCH /api/lines/:id/attachments/:aid': 'write',
  'POST /api/lines/:id/references': 'write',
  'PATCH /api/lines/:id/references/:rid': 'write',
  'DELETE /api/lines/:id/references/:rid': 'write',
  'GET /api/admin/overview': 'admin',
  'POST /api/admin/mirror/run': 'admin',
  'POST /api/admin/users': 'admin',
  'POST /api/admin/users/:id/invite': 'admin',
  'PATCH /api/admin/users/:id': 'admin',
  'DELETE /api/admin/users/:id': 'admin',
  'POST /api/admin/guest-link/rotate': 'admin',
  'POST /api/admin/enumerations': 'admin',
  'PATCH /api/admin/enumerations/:id': 'admin',
  'PATCH /api/admin/settings': 'admin',
  'PUT /api/admin/read-only': 'admin',
  'GET /api/admin/deleted': 'admin',
  'POST /api/admin/deleted/:type/:id/restore': 'admin',
  'GET /api/admin/snapshot.html': 'admin',
  'GET /api/admin/export.zip': 'admin',
  // The file route checks the attachment itself: restricted roles may open reference files only.
  'GET /api/attachments/:id/file': 'full',
  'GET /api/lines/:id/messages': 'full',
  'GET /api/messages': 'full',
  'POST /api/lines/:id/messages': 'write',
  'POST /api/messages': 'write',
  'PATCH /api/messages/:mid': 'write',
  'DELETE /api/messages/:mid': 'write',
  'PATCH /api/messages/:mid/request': 'write',
  'POST /api/messages/:mid/read': 'full',
  'DELETE /api/messages/:mid/read': 'full',
  'GET /api/messages/unread-count': 'full',
  'POST /api/messages/read-all': 'full',
  'GET /api/feeding': 'feeding',
  'GET /api/feeding/days/:date/history': 'feeding',
  'PUT /api/feeding/days/:date': 'feeding',
  'POST /api/feeding/repeat-week': 'feeding',
  'POST /api/feeding/events': 'feeding',
  'PATCH /api/feeding/events/:id': 'feeding',
  'DELETE /api/feeding/events/:id': 'feeding',
};

const registered = (): string[] =>
  app.routes
    .filter((route) => route.method !== 'ALL')
    .map((route) => `${route.method} ${route.path}`);

describe('route classification', () => {
  it('lists every registered route, and only those', () => {
    expect(registered().sort()).toEqual(Object.keys(ROUTES).sort());
  });
});

/** Routes that read their body before checking who is asking. */
const BODIES: Record<string, unknown> = {
  'POST /api/attribution/check': { action: 'data' },
};

type Who = 'Guest' | 'Feeder One' | 'Bob' | 'Admin';
const ALLOWED: Record<Exclude<RouteClass, 'open'>, Who[]> = {
  overview: ['Guest', 'Feeder One', 'Bob', 'Admin'],
  roster: ['Feeder One', 'Bob', 'Admin'],
  feeding: ['Feeder One', 'Bob', 'Admin'],
  full: ['Bob', 'Admin'],
  write: ['Bob', 'Admin'],
  admin: ['Admin'],
};

describe.each<Who>(['Guest', 'Feeder One', 'Bob', 'Admin'])('as %s', (who) => {
  it('is refused exactly where the classification says', async () => {
    const admin = browser();
    await admin.actAs('Admin');
    await admin.call('/api/admin/users', {
      name: 'Feeder One',
      role: 'feeder',
      initialPassword: 'first-pass',
    });
    const s = browser(admin.db);
    await s.actAs(who);
    const wrong: string[] = [];
    for (const [key, routeClass] of Object.entries(ROUTES)) {
      if (routeClass === 'open') continue;
      const [method = '', template = ''] = key.split(' ');
      const path = template.replace(/:[A-Za-z]+/g, 'x');
      const response =
        method === 'GET' ? await s.call(path) : await s.call(path, BODIES[key] ?? {}, method);
      const allowed = ALLOWED[routeClass].includes(who);
      const ok = allowed
        ? response.status !== 403 && response.status !== 401
        : response.status === 403;
      if (!ok) wrong.push(`${key} (${routeClass}) -> ${String(response.status)}`);
    }
    expect(wrong).toEqual([]);
  });
});
