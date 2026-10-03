import { describe, expect, it } from 'vitest';
import { crc32 } from './export/zip';
import { exportSchema } from './export/schema';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { listActivitiesByLine } from './db/queries/activities';
import { getLineByName } from './db/queries/lines';
import { browser, TEST_ADMIN, type ErrorBody } from './testBrowser';

async function setup(actor = 'Admin') {
  const b = browser();
  await loadFixture(b.db, fixture);
  await b.actAs(actor);
  const bob = await b.idOf('Bob');
  const adminId = actor === 'Admin' ? await b.idOf(TEST_ADMIN) : null;
  const admin = (path: string, body?: unknown, method = 'POST') => b.call(path, body, method);
  const fields = async (response: Response) =>
    ((await response.json<ErrorBody>()).error.details?.['fields'] ?? {}) as Record<string, string>;
  const activities = async () =>
    (
      await b.db
        .prepare(
          'SELECT type, summary, user_id, via_admin FROM activities ORDER BY created_at DESC, id DESC',
        )
        .all<{ type: string; summary: string; user_id: string; via_admin: number }>()
    ).results;
  return { ...b, bob, adminId, admin, fields, activities };
}

describe('the Admin guard', () => {
  it('refuses members and Guests, and a browser that has signed out', async () => {
    for (const actor of ['Bob', 'Guest']) {
      const s = await setup(actor);
      const response = await s.call('/api/admin/overview');
      expect(response.status).toBe(403);
      expect((await response.json<ErrorBody>()).error.code).toBe('ADMIN_ONLY');
    }
    const s = await setup('Admin');
    await s.call('/api/session/logout', {});
    expect((await s.call('/api/admin/overview')).status).toBe(401);
  });

  it('records the signed-in Admin as the author (BR-5, ADR-0005)', async () => {
    const s = await setup();
    const done = await s.admin('/api/admin/users', {
      name: 'Test User',
      initialPassword: 'first-pass',
    });
    expect(done.status).toBe(201);
    const [latest] = await s.activities();
    expect(latest).toMatchObject({ type: 'user_added', user_id: s.adminId, via_admin: 0 });
  });
});

describe('overview', () => {
  it('lists users (inactive too), every list, the settings and the flags', async () => {
    const s = await setup();
    const overview = await (
      await s.call('/api/admin/overview')
    ).json<{
      users: { name: string; isBuiltin: boolean; canSignIn: boolean; invitePending: boolean }[];
      lists: { kind: string; editable: boolean; entries: { value: string }[] }[];
      settings: Record<string, unknown>;
    }>();
    expect(overview.users.map((user) => user.name)).toContain('Erin');
    expect(
      overview.users
        .filter((user) => user.isBuiltin)
        .map((user) => user.name)
        .sort(),
    ).toEqual(['Admin', 'Guest']);
    expect(overview.users.find((user) => user.name === TEST_ADMIN)).toMatchObject({
      canSignIn: true,
      invitePending: false,
    });
    expect(overview.lists.map((list) => list.kind)).toContain('cryo_place');
    expect(overview.lists.find((list) => list.kind === 'id_method_type')?.editable).toBe(false);
    expect(overview.settings).toMatchObject({
      upcomingBreedingMonths: 11,
      defaultAnnealingC: 60,
      defaultCycles: 35,
    });
    expect(typeof overview.settings['databaseName']).toBe('string');
    expect(overview.settings).not.toHaveProperty('passphraseEnabled');
  });
});

describe('users (FR-ADM-01)', () => {
  it('adds a member who shows up in user lists immediately; a duplicate name (any case) is refused', async () => {
    const s = await setup();
    const added = await s.admin('/api/admin/users', {
      name: 'Test User',
      initialPassword: 'first-pass',
    });
    expect((await added.json<{ inviteToken: string }>()).inviteToken).toMatch(/^[\w-]{40,}$/);
    expect(
      (await (await s.call('/api/users')).json<{ name: string }[]>()).map((u) => u.name),
    ).toContain('Test User');
    const dup = await s.admin('/api/admin/users', {
      name: 'test user',
      initialPassword: 'first-pass',
    });
    expect((await s.fields(dup))['name']).toMatch(/already exists/);
    const bad = await s.admin('/api/admin/users', { name: '', role: 'guest' });
    expect(Object.keys(await s.fields(bad)).sort()).toEqual(['initialPassword', 'name', 'role']);
  });

  it('renames, changes the role, deactivates and reactivates; history keeps pointing at the user', async () => {
    const s = await setup();
    const created = await (
      await s.admin('/api/admin/users', { name: 'Temp', initialPassword: 'first-pass' })
    ).json<{ id: string }>();
    const patch = (body: object) => s.admin(`/api/admin/users/${created.id}`, body, 'PATCH');
    expect((await patch({ name: 'Temp Two', role: 'admin' })).status).toBe(200);
    expect((await patch({ isActive: false })).status).toBe(200);
    const active = await (await s.call('/api/users')).json<{ name: string }[]>();
    expect(active.map((u) => u.name)).not.toContain('Temp Two');
    const row = await s.db
      .prepare('SELECT name, role, is_active FROM users WHERE id = ?')
      .bind(created.id)
      .first();
    expect(row).toMatchObject({ name: 'Temp Two', role: 'admin', is_active: 0 });
    expect((await s.activities()).map((a) => a.type)).toContain('user_deactivated');
    expect((await patch({ isActive: true })).status).toBe(200);
    expect((await patch({})).status).toBe(400);
    expect((await patch({ name: 'Bob' })).status).toBe(400);
  });

  it('cannot change or deactivate the built-in Admin and Guest, and 404s for an unknown user', async () => {
    const s = await setup();
    for (const name of ['Admin', 'Guest']) {
      const response = await s.admin(
        `/api/admin/users/${await s.idOf(name)}`,
        { isActive: false },
        'PATCH',
      );
      expect(response.status).toBe(409);
      expect((await response.json<ErrorBody>()).error.code).toBe('BUILTIN_LOCKED');
    }
    expect((await s.admin('/api/admin/users/nope', { name: 'x' }, 'PATCH')).status).toBe(404);
  });
});

describe('lists (FR-ADM-02)', () => {
  it('adds a fluorophore; disabling hides it from pickers but an existing protocol still shows it', async () => {
    const s = await setup();
    const add = await s.admin('/api/admin/enumerations', { kind: 'fluorophore', value: 'YFP' });
    expect(add.status).toBe(201);
    const values = async () =>
      (await (await s.call('/api/enumerations?kind=fluorophore')).json<{ values: string[] }>())
        .values;
    expect(await values()).toContain('YFP');
    const gfp = (
      await s.db
        .prepare("SELECT id FROM enumerations WHERE kind='fluorophore' AND value='GFP'")
        .first<{ id: string }>()
    )?.id;
    expect(
      (await s.admin(`/api/admin/enumerations/${gfp ?? ''}`, { isActive: false }, 'PATCH')).status,
    ).toBe(200);
    expect(await values()).not.toContain('GFP');
    const line = await getLineByName(s.db, 'demo_b2');
    const detail = await (
      await s.call(`/api/lines/${line?.id ?? ''}`)
    ).json<{
      protocols: { fields: { fluorophore?: string } }[];
    }>();
    expect(detail.protocols[0]?.fields.fluorophore).toBe('GFP');
    expect(
      (await s.admin(`/api/admin/enumerations/${gfp ?? ''}`, { isActive: true }, 'PATCH')).status,
    ).toBe(200);
    expect(await values()).toContain('GFP');
  });

  it('renames an entry, refuses duplicates, the fixed template list and unknown entries', async () => {
    const s = await setup();
    const id = (
      await (
        await s.admin('/api/admin/enumerations', { kind: 'cryo_place', value: 'Freezer 1' })
      ).json<{
        id: string;
      }>()
    ).id;
    expect(
      (await s.admin(`/api/admin/enumerations/${id}`, { value: 'Freezer 2' }, 'PATCH')).status,
    ).toBe(200);
    const dup = await s.admin('/api/admin/enumerations', {
      kind: 'cryo_place',
      value: 'FREEZER 2',
    });
    expect((await s.fields(dup))['value']).toMatch(/already in this list/);
    const fixed = await s.admin('/api/admin/enumerations', {
      kind: 'id_method_type',
      value: 'New',
    });
    expect((await fixed.json<ErrorBody>()).error.code).toBe('LIST_READ_ONLY');
    const template = (
      await s.db
        .prepare("SELECT id FROM enumerations WHERE kind='id_method_type'")
        .first<{ id: string }>()
    )?.id;
    expect(
      (await s.admin(`/api/admin/enumerations/${template ?? ''}`, { isActive: false }, 'PATCH'))
        .status,
    ).toBe(409);
    expect((await s.admin('/api/admin/enumerations/nope', { value: 'x' }, 'PATCH')).status).toBe(
      404,
    );
    expect((await s.admin(`/api/admin/enumerations/${id}`, {}, 'PATCH')).status).toBe(400);
    expect((await s.admin('/api/admin/enumerations', { kind: 'x', value: '' })).status).toBe(400);
  });
});

describe('settings (FR-ADM-03)', () => {
  it('lets an Admin rename the database and uses the name in the app session and offline snapshot', async () => {
    const s = await setup();
    const renamed = await s.admin(
      '/api/admin/settings',
      { databaseName: '  Lab Fish DB  ' },
      'PATCH',
    );
    expect(renamed.status).toBe(200);
    expect((await s.activities())[0]?.summary).toContain('database name');

    const session = await (await s.call('/api/session')).json<{ appName: string }>();
    expect(session.appName).toBe('Lab Fish DB');
    const overview = await (
      await s.call('/api/admin/overview')
    ).json<{ settings: { databaseName: string } }>();
    expect(overview.settings.databaseName).toBe('Lab Fish DB');
    const snapshot = await s.call('/api/admin/snapshot.html');
    expect(await snapshot.text()).toContain('<h1 id="app-name">Lab Fish DB</h1>');

    expect(
      (await s.admin('/api/admin/settings', { databaseName: 'Lab Fish DB' }, 'PATCH')).status,
    ).toBe(400);
    const blank = await s.admin('/api/admin/settings', { databaseName: '  ' }, 'PATCH');
    expect((await s.fields(blank))['databaseName']).toBeTruthy();
  });

  it('changing the threshold changes the dashboard; out-of-range and unchanged values are refused', async () => {
    const s = await setup();
    const threshold = async () =>
      (await (await s.call('/api/dashboard')).json<{ thresholdMonths: number }>()).thresholdMonths;
    expect(await threshold()).toBe(11);
    const ok = await s.admin('/api/admin/settings', { upcomingBreedingMonths: '10' }, 'PATCH');
    expect(ok.status).toBe(200);
    expect(await threshold()).toBe(10);
    expect((await s.activities())[0]?.summary).toMatch(/upcoming breeding months 11 → 10/);
    expect(
      (await s.admin('/api/admin/settings', { upcomingBreedingMonths: 10 }, 'PATCH')).status,
    ).toBe(400);
    expect(
      (
        await s.fields(await s.admin('/api/admin/settings', { upcomingBreedingMonths: 0 }, 'PATCH'))
      )['upcomingBreedingMonths'],
    ).toBeTruthy();
    const defaults = await s.admin(
      '/api/admin/settings',
      { defaultAnnealingC: 58, defaultCycles: 30 },
      'PATCH',
    );
    expect(defaults.status).toBe(200);
    const overview = await (
      await s.call('/api/admin/overview')
    ).json<{ settings: { defaultAnnealingC: number; defaultCycles: number } }>();
    expect(overview.settings).toMatchObject({ defaultAnnealingC: 58, defaultCycles: 30 });
  });

  it('the PCR defaults set here are what a new protocol gets, on the server and for the forms', async () => {
    const s = await setup();
    await s.admin('/api/admin/settings', { defaultAnnealingC: 58, defaultCycles: 30 }, 'PATCH');
    expect(await (await s.call('/api/settings/public')).json()).toEqual({
      defaultAnnealingC: 58,
      defaultCycles: 30,
      upcomingBreedingMonths: 11,
    });
    const line = await getLineByName(s.db, 'demo_c3');
    const added = await s.admin(`/api/lines/${line?.id ?? ''}/protocols`, {
      expectedVersion: 1,
      type: 'pcr',
      label: 'PCR – defaults',
    });
    expect(added.status).toBe(200);
    const row = await s.db
      .prepare("SELECT fields FROM id_protocols WHERE label = 'PCR – defaults'")
      .first<{ fields: string }>();
    expect(JSON.parse(row?.fields ?? '{}')).toMatchObject({ annealing_c: 58, cycles: 30 });
    const created = await s.admin('/api/lines', {
      name: 'defaults-line',
      dob: '2026-01-05',
      protocols: [{ type: 'pcr', label: 'PCR', fields: {} }],
    });
    expect(created.status).toBe(201);
    const first = await s.db
      .prepare(
        "SELECT p.fields FROM id_protocols p JOIN lines l ON l.id = p.line_id WHERE l.name = 'defaults-line'",
      )
      .first<{ fields: string }>();
    expect(JSON.parse(first?.fields ?? '{}')).toMatchObject({ annealing_c: 58, cycles: 30 });
  });
});

describe('deleted items (FR-ADM-04)', () => {
  async function withMember() {
    const s = await setup();
    const member = browser(s.db);
    await member.actAs('Bob');
    return { ...s, member };
  }
  const list = async (s: Awaited<ReturnType<typeof setup>>) =>
    (
      await (
        await s.call('/api/admin/deleted')
      ).json<{
        items: {
          type: string;
          id: string;
          label: string;
          notRestorable: string | null;
          lineName: string | null;
        }[];
      }>()
    ).items;

  it('lists a removed protocol and restores it; unknown or already-restored items are 404', async () => {
    const s = await withMember();
    const line = await getLineByName(s.db, 'demo_c3');
    const protocolId = line?.current_protocol_id ?? '';
    await s.member.call(
      `/api/lines/${line?.id ?? ''}/protocols/${protocolId}`,
      { expectedVersion: 1 },
      'DELETE',
    );
    const item = (await list(s)).find((entry) => entry.type === 'protocol');
    expect(item).toMatchObject({ id: protocolId, lineName: 'demo_c3', notRestorable: null });
    const restored = await s.admin(`/api/admin/deleted/protocol/${protocolId}/restore`, {});
    expect(restored.status).toBe(200);
    expect((await list(s)).some((entry) => entry.type === 'protocol')).toBe(false);
    const again = await s.admin(`/api/admin/deleted/protocol/${protocolId}/restore`, {});
    expect(again.status).toBe(404);
    const unknown = await s.admin(`/api/admin/deleted/nonsense/${protocolId}/restore`, {});
    expect(unknown.status).toBe(404);
  });

  it('restores a removed cryo record (acceptance 3) but not one whose last vial was used', async () => {
    const s = await withMember();
    const line = await getLineByName(s.db, 'DEMO_E5');
    const base = `/api/lines/${line?.id ?? ''}`;
    const record =
      (
        await s.db
          .prepare('SELECT id FROM cryo_records WHERE line_id = ?')
          .bind(line?.id ?? '')
          .first<{ id: string }>()
      )?.id ?? '';
    await s.member.call(`${base}/cryo/${record}`, { expectedVersion: 1 }, 'DELETE');
    expect((await list(s)).find((entry) => entry.type === 'cryo')).toMatchObject({
      id: record,
      notRestorable: null,
    });
    expect((await s.admin(`/api/admin/deleted/cryo/${record}/restore`, {})).status).toBe(200);
    expect((await s.call(base)).status).toBe(200);
    const detail = await (await s.call(base)).json<{ isCryopreserved: boolean }>();
    expect(detail.isCryopreserved).toBe(true);

    // Use every vial: the record is emptied and removed, and cannot come back.
    await s.member.call(`${base}/cryo/use`, { expectedVersion: 3, vialIds: 'C0605-C0610' });
    const usedUp = (await list(s)).find((entry) => entry.type === 'cryo');
    expect(usedUp?.notRestorable).toMatch(/every vial/);
    const refused = await s.admin(`/api/admin/deleted/cryo/${usedUp?.id ?? ''}/restore`, {});
    expect(refused.status).toBe(409);
    expect((await refused.json<ErrorBody>()).error.code).toBe('NOT_RESTORABLE');
  });

  it('restores a removed reference and a removed image; a replaced reference file is listed as not restorable', async () => {
    const s = await withMember();
    const line = await getLineByName(s.db, 'demo_c3');
    const base = `/api/lines/${line?.id ?? ''}`;
    const ref = await (
      await s.member.call(`${base}/references`, {
        expectedVersion: 1,
        title: 'ZFIN',
        url: 'https://zfin.org',
      })
    ).json<{ version: number }>();
    const referenceId =
      (
        await s.db
          .prepare("SELECT id FROM line_references WHERE title = 'ZFIN'")
          .first<{ id: string }>()
      )?.id ?? '';
    await s.member.call(
      `${base}/references/${referenceId}`,
      { expectedVersion: ref.version },
      'DELETE',
    );
    expect((await list(s)).find((entry) => entry.type === 'reference')).toMatchObject({
      label: 'ZFIN',
    });
    expect((await s.admin(`/api/admin/deleted/reference/${referenceId}/restore`, {})).status).toBe(
      200,
    );
    const detail = await (await s.call(base)).json<{ references: { title: string }[] }>();
    expect(detail.references.map((r) => r.title)).toContain('ZFIN');

    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2]);
    const data = new FormData();
    data.set('file', new File([png], 'gel.png', { type: 'image/png' }));
    data.set('kind', 'gel_image');
    data.set('protocolId', line?.current_protocol_id ?? '');
    data.set(
      'expectedVersion',
      String((await (await s.call(base)).json<{ version: number }>()).version),
    );
    const up = await s.member.upload(`${base}/attachments`, data);
    const { attachmentId } = await up.json<{ attachmentId: string }>();
    const version = (await (await s.call(base)).json<{ version: number }>()).version;
    await s.member.call(
      `${base}/attachments/${attachmentId}`,
      { expectedVersion: version },
      'DELETE',
    );
    expect((await list(s)).find((entry) => entry.type === 'attachment')).toMatchObject({
      id: attachmentId,
      notRestorable: null,
    });
    expect(
      (await s.admin(`/api/admin/deleted/attachment/${attachmentId}/restore`, {})).status,
    ).toBe(200);
    expect((await list(s)).some((entry) => entry.type === 'attachment')).toBe(false);
  });

  it('restores a deleted chat message', async () => {
    const s = await withMember();
    const line = await getLineByName(s.db, 'demo_c3');
    const posted = await s.member.call(`/api/lines/${line?.id ?? ''}/messages`, { body: 'hello' });
    expect(posted.status).toBeLessThan(300);
    const id =
      (
        await s.db
          .prepare("SELECT id FROM chat_messages WHERE body = 'hello'")
          .first<{ id: string }>()
      )?.id ?? '';
    expect((await s.member.call(`/api/messages/${id}`, undefined, 'DELETE')).status).toBe(204);
    expect((await list(s)).find((entry) => entry.type === 'message')).toMatchObject({
      id,
      label: 'hello',
    });
    expect((await s.admin(`/api/admin/deleted/message/${id}/restore`, {})).status).toBe(200);
    expect((await list(s)).some((entry) => entry.type === 'message')).toBe(false);
    expect((await listActivitiesByLine(s.db, line?.id ?? '', 5)).map((a) => a.summary)).toContain(
      'A deleted chat message was restored.',
    );
  });
});

const BOM = new RegExp(`^${String.fromCharCode(0xfeff)}`);

/** A tiny reader for "stored" ZIP files: name → bytes (and checks each CRC). */
function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, Uint8Array>();
  let eocd = bytes.length - 22;
  while (view.getUint32(eocd, true) !== 0x06054b50) eocd -= 1;
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n += 1) {
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const dataAt =
      localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const data = bytes.subarray(dataAt, dataAt + size);
    expect(crc32(data)).toBe(crc);
    files.set(name, data);
    at += 46 + nameLength;
  }
  return files;
}

describe('Export now (acceptance 4)', () => {
  it('downloads a ZIP whose lines.csv is the Line List All view and whose JSON matches the export schema', async () => {
    const s = await setup();
    const response = await s.call('/api/admin/export.zip');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/zip');
    expect(response.headers.get('content-disposition')).toMatch(
      /fish-database-export_\d{4}-\d{2}-\d{2}\.zip/,
    );
    const files = readZip(new Uint8Array(await response.arrayBuffer()));
    expect([...files.keys()].sort()).toEqual([
      'attachments.csv',
      'chat_messages.csv',
      'cryo_records.csv',
      'cryo_vial_uses.csv',
      'fish-database.json',
      'genotyping_records.csv',
      'id_protocols.csv',
      'line_references.csv',
      'line_versions.csv',
      'lines.csv',
      'users.csv',
    ]);
    const text = (name: string) => new TextDecoder().decode(files.get(name));
    const listCsv = await (await s.call('/api/lines.csv?view=all')).text();
    // `Response#text()` drops the BOM on the download side; compare without it on both sides.
    const strip = (value: string) => value.replace(BOM, '');
    expect(strip(text('lines.csv'))).toBe(strip(listCsv));
    expect(text('lines.csv').split('\r\n')[0]).toContain('Line,Gene,Phenotypes,DOB');
    const json = exportSchema.parse(JSON.parse(text('fish-database.json')));
    expect(json.lines.map((entry) => entry.line['name'])).toContain('demo_c3');
    expect(json.settings).not.toHaveProperty('lab_passphrase_enabled');
    expect(text('line_versions.csv').split('\r\n')[0]).not.toContain('snapshot');
    expect(text('id_protocols.csv').split('\r\n')[0]).toMatch(/field:primer_f_name/);
    expect(text('users.csv')).toContain('Erin');
  });

  it('refuses everyone but the Admin', async () => {
    const s = await setup('Bob');
    expect((await s.call('/api/admin/export.zip')).status).toBe(403);
    expect((await s.call('/api/admin/snapshot.html')).status).toBe(403);
  });

  it('downloads the read-only viewer (snapshot.html) with the lines in it', async () => {
    const s = await setup();
    const response = await s.call('/api/admin/snapshot.html');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('demo_c3');
    expect(html).toContain('Read-only copy');
  });
});
