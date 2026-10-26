/** What Guests and Feeders receive from the read routes (T-032, FR-GUEST-05 … 10, BR-15). */
import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { insertAttachment } from './db/queries/attachments';
import { insertLineReference } from './db/queries/lineReferences';
import { makeAttachment, makeReference } from './db/testing/builders';
import { browser, fakeBucket } from './testBrowser';

const LIST_KEYS = [
  'ageMonths',
  'dob',
  'gene',
  'id',
  'idMethod',
  'idMethodTypes',
  'idedNumber',
  'lastIdDate',
  'missingDob',
  'name',
  'phenotypes',
  'references',
  'status',
];
const DETAIL_KEYS = [
  'ageMonths',
  'dob',
  'gene',
  'id',
  'idMethods',
  'idedNumber',
  'lastIdDate',
  'name',
  'phenotypes',
  'references',
  'restricted',
  'status',
];

async function setup(who: string) {
  const admin = browser();
  await admin.actAs('Admin');
  await admin.call('/api/admin/users', {
    name: 'Feeder One',
    role: 'feeder',
    initialPassword: 'first-pass',
  });
  await loadFixture(admin.db, fixture);
  await insertAttachment(
    admin.db,
    makeAttachment({
      id: 'att-ref',
      owner_type: 'line_reference',
      owner_id: 'ref-file',
      kind: 'reference_file',
      mime_type: 'application/pdf',
      r2_key: 'k-ref',
    }),
  );
  await insertAttachment(
    admin.db,
    makeAttachment({ id: 'att-gel', owner_id: 'proto-x', r2_key: 'k-gel' }),
  );
  await insertAttachment(
    admin.db,
    makeAttachment({
      id: 'att-seq',
      owner_id: 'proto-x',
      kind: 'sequence_result',
      file_name: 'trace.ab1',
      mime_type: 'application/x-abif',
      r2_key: 'k-seq',
    }),
  );
  await insertLineReference(
    admin.db,
    makeReference({ id: 'ref-file', line_id: 'fx-demo_c3', attachment_id: 'att-ref' }),
  );
  const objects = new Map([
    ['k-ref', new TextEncoder().encode('REF')],
    ['k-gel', new TextEncoder().encode('GEL')],
    ['k-seq', new TextEncoder().encode('ABIF')],
  ]);
  const s = browser(admin.db, { FILES: fakeBucket(objects) });
  await s.actAs(who);
  return s;
}

describe.each(['Guest', 'Feeder One'])('read routes for %s', (who) => {
  it('Line List returns the overview rows only', async () => {
    const s = await setup(who);
    const body = await (
      await s.call('/api/lines?view=all')
    ).json<{
      restricted: boolean;
      items: Record<string, unknown>[];
    }>();
    expect(body.restricted).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    for (const item of body.items) expect(Object.keys(item).sort()).toEqual(LIST_KEYS);
  });

  it('Line List ignores the Cryopreserved filter and does not search notes', async () => {
    const s = await setup(who);
    const all = await (await s.call('/api/lines?view=all')).json<{ total: number }>();
    const cryo = await (await s.call('/api/lines?view=all&cryo=yes')).json<{ total: number }>();
    expect(cryo.total).toBe(all.total);
  });

  it('Line Detail returns the overview document without an ETag', async () => {
    const s = await setup(who);
    const response = await s.call('/api/lines/fx-demo_c3');
    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBeNull();
    const body = await response.json<{ references: { hasAttachment: boolean }[] }>();
    expect(Object.keys(body).sort()).toEqual(DETAIL_KEYS);
    expect(body.references.some((reference) => reference.hasAttachment)).toBe(true);
  });

  it('Dashboard returns the three counters only', async () => {
    const s = await setup(who);
    const body = await (await s.call('/api/dashboard')).json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(['counters', 'restricted', 'today']);
    expect(Object.keys(body.counters as object).sort()).toEqual([
      'active',
      'closed',
      'cryopreserved',
    ]);
  });

  it('opens a reference file but not a gel image', async () => {
    const s = await setup(who);
    const reference = await s.call('/api/attachments/att-ref/file');
    expect(reference.status).toBe(200);
    expect(await reference.text()).toBe('REF');
    expect((await s.call('/api/attachments/att-gel/file')).status).toBe(403);
    expect((await s.call('/api/attachments/att-seq/file')).status).toBe(403);
    expect((await s.call('/api/attachments/missing/file')).status).toBe(403);
  });
});

describe('read routes for a Member', () => {
  it('still return the full Line List row and Line Detail document', async () => {
    const s = await setup('Bob');
    const list = await (
      await s.call('/api/lines?view=all')
    ).json<{
      items: Record<string, unknown>[];
    }>();
    expect(list.items[0]).toHaveProperty('notes');
    expect(list.items[0]).toHaveProperty('isCryopreserved');
    const detail = await s.call('/api/lines/fx-demo_c3');
    expect(detail.headers.get('etag')).not.toBeNull();
    expect(await detail.json()).toHaveProperty('protocols');
  });
});
