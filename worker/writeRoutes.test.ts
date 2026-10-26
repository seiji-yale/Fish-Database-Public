/** Every data-changing route refuses Guests and Feeders (T-027, T-031, BR-15). */
import { describe, expect, it } from 'vitest';
import { browser } from './testBrowser';

const WRITE_ROUTES: [string, string][] = [
  ['DELETE', '/api/admin/users/:id'],
  ['DELETE', '/api/lines/:id/attachments/:aid'],
  ['DELETE', '/api/lines/:id/cryo/:cid'],
  ['DELETE', '/api/lines/:id/protocols/:pid'],
  ['DELETE', '/api/lines/:id/references/:rid'],
  ['DELETE', '/api/messages/:mid'],
  ['PATCH', '/api/admin/enumerations/:id'],
  ['PATCH', '/api/admin/settings'],
  ['PATCH', '/api/admin/users/:id'],
  ['PATCH', '/api/lines/:id'],
  ['PATCH', '/api/lines/:id/attachments/:aid'],
  ['PATCH', '/api/lines/:id/cryo/:cid'],
  ['PATCH', '/api/lines/:id/protocols/:pid'],
  ['PATCH', '/api/lines/:id/references/:rid'],
  ['PATCH', '/api/messages/:mid'],
  ['PATCH', '/api/messages/:mid/request'],
  ['POST', '/api/admin/deleted/:type/:id/restore'],
  ['POST', '/api/admin/enumerations'],
  ['POST', '/api/admin/guest-link/rotate'],
  ['POST', '/api/admin/mirror/run'],
  ['POST', '/api/admin/users'],
  ['POST', '/api/admin/users/:id/invite'],
  ['POST', '/api/lines'],
  ['POST', '/api/lines/:id/attachments'],
  ['POST', '/api/lines/:id/close'],
  ['POST', '/api/lines/:id/cryo'],
  ['POST', '/api/lines/:id/cryo/use'],
  ['POST', '/api/lines/:id/cryo/uses/:useId/undo'],
  ['POST', '/api/lines/:id/genotyping'],
  ['POST', '/api/lines/:id/messages'],
  ['POST', '/api/lines/:id/protocols'],
  ['POST', '/api/lines/:id/protocols/:pid/restore'],
  ['POST', '/api/lines/:id/protocols/:pid/set-current'],
  ['POST', '/api/lines/:id/protocols/reorder'],
  ['POST', '/api/lines/:id/references'],
  ['POST', '/api/lines/:id/reopen'],
  ['POST', '/api/lines/:id/restore/:versionNo'],
  ['POST', '/api/lines/:id/start-breeding'],
  ['POST', '/api/messages'],
];

describe.each(['Guest', 'Feeder One'])('write routes for %s', (who) => {
  it('refuse the request with 403 before looking at it', async () => {
    const admin = browser();
    await admin.actAs('Admin');
    await admin.call('/api/admin/users', {
      name: 'Feeder One',
      role: 'feeder',
      initialPassword: 'first-pass',
    });
    const s = browser(admin.db);
    await s.actAs(who);
    const notRefused: string[] = [];
    for (const [method, template] of WRITE_ROUTES) {
      const path = template.replace(/:[A-Za-z]+/g, 'x');
      const response = await s.call(path, {}, method);
      if (response.status !== 403)
        notRefused.push(`${method} ${template} -> ${String(response.status)}`);
    }
    expect(notRefused).toEqual([]);
  });
});
