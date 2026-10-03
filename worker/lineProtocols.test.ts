import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { listActivitiesByLine } from './db/queries/activities';
import { listIdProtocolsByLine } from './db/queries/idProtocols';
import { getLineByName } from './db/queries/lines';
import { listLineVersionsByLine } from './db/queries/lineVersions';
import { browser, type ErrorBody } from './testBrowser';

interface WriteBody {
  id: string;
  version: number;
  summary: string;
  warnings?: Record<string, string>;
  methodCleared?: boolean;
}

async function setup(lineName = 'demo_c3', actor = 'Bob') {
  const b = browser();
  await loadFixture(b.db, fixture);
  await b.actAs(actor);
  const line = await getLineByName(b.db, lineName);
  if (line === null) throw new Error('fixture line missing');
  const base = `/api/lines/${line.id}`;
  const reload = async () => {
    const row = await getLineByName(b.db, lineName);
    if (row === null) throw new Error('line vanished');
    return row;
  };
  const live = () => listIdProtocolsByLine(b.db, line.id);
  return { ...b, line, base, reload, live };
}

async function fieldErrors(response: Response): Promise<Record<string, string>> {
  const body = await response.json<ErrorBody>();
  return (body.error.details?.['fields'] ?? {}) as Record<string, string>;
}

const PCR = {
  type: 'pcr',
  label: 'PCR – wt allele',
  fields: { primer_f_name: 'F1', primer_f_seq: 'ACGT', annealing_c: 58 },
  notes: null,
};

describe('POST /api/lines/:id/protocols (FR-ID-01, FR-ID-02)', () => {
  it('adds a second PCR: label kept, defaults filled, not current, readable summary', async () => {
    const { call, base, line, live, reload } = await setup();
    const before = await live();
    const response = await call(`${base}/protocols`, { expectedVersion: 1, ...PCR });
    expect(response.status).toBe(200);
    expect(await response.json<WriteBody>()).toMatchObject({
      version: 2,
      summary: 'Added ID method: PCR – wt allele.',
    });
    const rows = await live();
    expect(rows).toHaveLength(before.length + 1);
    const added = rows.at(-1);
    expect(added).toMatchObject({
      label: 'PCR – wt allele',
      protocol_type: 'pcr',
      sort_order: before.length,
    });
    expect(JSON.parse(added?.fields ?? '{}')).toMatchObject({ annealing_c: 58, cycles: 35 });
    expect((await reload()).current_protocol_id).toBe(line.current_protocol_id);
  });

  it('a protocol added with setCurrent joins the current methods; the first one stays primary', async () => {
    const { call, base, live, reload, line } = await setup();
    await call(`${base}/protocols`, { expectedVersion: 1, ...PCR, setCurrent: true });
    const rows = await live();
    expect(rows.map((row) => row.is_current)).toEqual([1, 1]);
    expect((await reload()).current_protocol_id).toBe(line.current_protocol_id);
  });

  it('the first protocol of a line with no current method becomes current and primary', async () => {
    const none = await setup();
    for (const row of await none.live())
      await none.call(
        `${none.base}/protocols/${row.id}`,
        { expectedVersion: (await none.reload()).version },
        'DELETE',
      );
    expect((await none.reload()).current_protocol_id).toBeNull();
    await none.call(`${none.base}/protocols`, {
      expectedVersion: (await none.reload()).version,
      type: 'tails',
      label: 'Tails',
    });
    const first = (await none.live())[0];
    expect(first?.is_current).toBe(1);
    expect((await none.reload()).current_protocol_id).toBe(first?.id);
  });

  it('returns a warning for a repeated label and for invalid sequence characters, and still saves', async () => {
    const { call, base, live } = await setup();
    const existing = (await live())[0]?.label ?? '';
    const response = await call(`${base}/protocols`, {
      expectedVersion: 1,
      type: 'pcr',
      label: existing,
      fields: { primer_f_seq: 'ACGT!' },
    });
    expect(response.status).toBe(200);
    const body = await response.json<WriteBody>();
    expect(Object.keys(body.warnings ?? {}).sort()).toEqual(['fields.primer_f_seq', 'label']);
  });

  it.each([
    ['pcr', { annealing_c: 'hot' }, 'fields.annealing_c'],
    ['fluorescence', { screening_day: '9' }, 'fields.screening_day'],
    ['custom', { items: [{ key: '', value: 'x' }] }, 'fields.items.0.key'],
    ['tails', { primer_f_name: 'x' }, 'fields.primer_f_name'],
  ])('rejects invalid %s fields on %j', async (type, fields, key) => {
    const { call, base, reload } = await setup();
    const response = await call(`${base}/protocols`, {
      expectedVersion: 1,
      type,
      label: 'x',
      fields,
    });
    expect(response.status).toBe(400);
    expect(Object.keys(await fieldErrors(response))).toContain(key);
    expect((await reload()).version).toBe(1);
  });

  it('accepts every template: tails, none, pcr_sequence, fluorescence, custom', async () => {
    const { call, base } = await setup();
    const bodies = [
      { type: 'tails' },
      { type: 'none' },
      {
        type: 'pcr_sequence',
        fields: { seq_primer: 'F1', seq_result_urls: ['https://x.example/a'] },
      },
      { type: 'fluorescence', fields: { fluorophore: 'GFP', screening_day: '1-2' } },
      {
        type: 'custom',
        fields: {
          items: [
            { key: 'Assay', value: 'HRM' },
            { key: 'Temp', value: '60' },
          ],
        },
      },
    ];
    let version = 1;
    for (const body of bodies) {
      const response = await call(`${base}/protocols`, { expectedVersion: version, ...body });
      expect(response.status).toBe(200);
      version += 1;
    }
  });

  it('refuses a missing type or a Guest; an Admin adds as themselves', async () => {
    const { call, base } = await setup();
    expect((await call(`${base}/protocols`, { expectedVersion: 1, type: 'nope' })).status).toBe(
      400,
    );
    expect((await call(`${base}/protocols`, { expectedVersion: 'x', type: 'pcr' })).status).toBe(
      400,
    );
    const guest = await setup('demo_c3', 'Guest');
    expect(
      (await guest.call(`${guest.base}/protocols`, { expectedVersion: 1, ...PCR })).status,
    ).toBe(403);
    const admin = await setup('demo_c3', 'Admin');
    const ask = await admin.call(`${admin.base}/protocols`, { expectedVersion: 1, ...PCR });
    expect(ask.status).toBe(200);
  });

  it('answers 404 for an unknown line', async () => {
    const { call } = await setup();
    expect((await call('/api/lines/nope/protocols', { expectedVersion: 1, ...PCR })).status).toBe(
      404,
    );
  });
});

describe('PATCH /api/lines/:id/protocols/:pid', () => {
  it('edits annealing to 58: same type, history shows the protocol change', async () => {
    const { db, call, base, line, live } = await setup();
    const target = (await live())[0];
    if (target === undefined) throw new Error('no protocol');
    const fields = { ...(JSON.parse(target.fields) as Record<string, unknown>), annealing_c: 58 };
    const response = await call(
      `${base}/protocols/${target.id}`,
      { expectedVersion: 1, type: 'tails', label: target.label, fields, notes: 'edited' },
      'PATCH',
    );
    expect(response.status).toBe(200);
    expect((await response.json<WriteBody>()).summary).toBe(`Updated ID method: ${target.label}.`);
    const after = (await live())[0];
    expect(after).toMatchObject({ protocol_type: target.protocol_type, notes: 'edited' });
    expect((JSON.parse(after?.fields ?? '{}') as { annealing_c: number }).annealing_c).toBe(58);
    const [latest] = await listLineVersionsByLine(db, line.id);
    expect(latest?.change_type).toBe('protocol_changed');
    expect(
      (JSON.parse(latest?.diff ?? '[]') as { path: string }[]).map((entry) => entry.path),
    ).toEqual(['protocols']);
  });

  it('refuses another line’s protocol and invalid fields', async () => {
    const { call, base, live } = await setup();
    const target = (await live())[0];
    const missing = await call(
      `${base}/protocols/nope`,
      { expectedVersion: 1, label: 'x' },
      'PATCH',
    );
    expect(missing.status).toBe(404);
    const bad = await call(
      `${base}/protocols/${target?.id ?? ''}`,
      { expectedVersion: 1, label: 'x', fields: { annealing_c: 'x' } },
      'PATCH',
    );
    expect(bad.status).toBe(400);
  });
});

describe('DELETE, set-current, reorder, restore', () => {
  it('removing the current protocol is soft, clears the current method and says so', async () => {
    const { db, call, base, line, live, reload } = await setup();
    const current = line.current_protocol_id ?? '';
    const response = await call(`${base}/protocols/${current}`, { expectedVersion: 1 }, 'DELETE');
    expect(response.status).toBe(200);
    expect(await response.json<WriteBody>()).toMatchObject({ methodCleared: true });
    expect(await live()).toHaveLength(0);
    expect((await reload()).current_protocol_id).toBeNull();
    const hidden = await db
      .prepare('SELECT deleted_at FROM id_protocols WHERE id = ?')
      .bind(current)
      .first<{ deleted_at: string | null }>();
    expect(hidden?.deleted_at).not.toBeNull();
    expect((await listActivitiesByLine(db, line.id, 1))[0]?.type).toBe('protocol_changed');
  });

  it('removing another protocol keeps the current one', async () => {
    const { call, base, live, reload, line } = await setup();
    await call(`${base}/protocols`, { expectedVersion: 1, ...PCR });
    const added = (await live()).at(-1);
    const response = await call(
      `${base}/protocols/${added?.id ?? ''}`,
      { expectedVersion: 2 },
      'DELETE',
    );
    expect(await response.json<WriteBody>()).toMatchObject({ methodCleared: false });
    expect((await reload()).current_protocol_id).toBe(line.current_protocol_id);
    const again = await call(
      `${base}/protocols/${added?.id ?? ''}`,
      { expectedVersion: 3 },
      'DELETE',
    );
    expect(again.status).toBe(404);
  });

  it('set-current marks several methods as current; unmarking the primary hands it on', async () => {
    const { call, base, live, reload, line } = await setup();
    await call(`${base}/protocols`, { expectedVersion: 1, ...PCR });
    const added = (await live()).at(-1);
    const marked = await call(`${base}/protocols/${added?.id ?? ''}/set-current`, {
      expectedVersion: 2,
    });
    expect((await marked.json<WriteBody>()).summary).toBe(
      'Now a current ID method: PCR – wt allele.',
    );
    expect((await live()).map((row) => row.is_current)).toEqual([1, 1]);
    expect((await reload()).current_protocol_id).toBe(line.current_protocol_id);

    const unmarked = await call(`${base}/protocols/${line.current_protocol_id ?? ''}/set-current`, {
      expectedVersion: 3,
      current: false,
    });
    expect((await unmarked.json<WriteBody>()).summary).toMatch(/^No longer a current ID method/);
    expect((await reload()).current_protocol_id).toBe(added?.id);
    expect((await live()).map((row) => row.is_current)).toEqual([0, 1]);

    const last = await call(`${base}/protocols/${added?.id ?? ''}/set-current`, {
      expectedVersion: 4,
      current: false,
    });
    expect(last.status).toBe(200);
    expect((await reload()).current_protocol_id).toBeNull();
    const missing = await call(`${base}/protocols/nope/set-current`, { expectedVersion: 5 });
    expect(missing.status).toBe(404);
  });

  it('removing one of two current methods keeps the other as primary and does not clear the method', async () => {
    const { call, base, live, reload, line } = await setup();
    await call(`${base}/protocols`, { expectedVersion: 1, ...PCR, setCurrent: true });
    const response = await call(
      `${base}/protocols/${line.current_protocol_id ?? ''}`,
      { expectedVersion: 2 },
      'DELETE',
    );
    expect(await response.json<WriteBody>()).toMatchObject({ methodCleared: false });
    const rest = await live();
    expect(rest).toHaveLength(1);
    expect((await reload()).current_protocol_id).toBe(rest[0]?.id);
  });

  it('repairs the flag of an older line that has only the pointer', async () => {
    const { db, call, base, live } = await setup();
    await db.prepare('UPDATE id_protocols SET is_current = 0').run();
    await call(`${base}/protocols`, { expectedVersion: 1, ...PCR });
    expect((await live()).map((row) => row.is_current)).toEqual([1, 0]);
  });

  it('reorder persists the new order and rejects a wrong list', async () => {
    const { call, base, live } = await setup();
    await call(`${base}/protocols`, { expectedVersion: 1, ...PCR });
    const [first, second] = await live();
    const ok = await call(`${base}/protocols/reorder`, {
      expectedVersion: 2,
      order: [second?.id, first?.id],
    });
    expect(ok.status).toBe(200);
    expect((await ok.json<WriteBody>()).summary).toBe('ID methods reordered.');
    expect((await live()).map((row) => row.id)).toEqual([second?.id, first?.id]);
    for (const order of [[first?.id], [first?.id, first?.id], 'x']) {
      const bad = await call(`${base}/protocols/reorder`, { expectedVersion: 3, order });
      expect(bad.status).toBe(400);
    }
  });

  it('Admin restores a removed protocol at the end; others cannot', async () => {
    const member = await setup();
    const target = (await member.live())[0];
    await member.call(
      `${member.base}/protocols/${target?.id ?? ''}`,
      { expectedVersion: 1 },
      'DELETE',
    );
    const denied = await member.call(`${member.base}/protocols/${target?.id ?? ''}/restore`, {
      expectedVersion: 2,
    });
    expect(denied.status).toBe(403);
    expect((await denied.json<ErrorBody>()).error.code).toBe('ADMIN_ONLY');

    const admin = await setup();
    const removed = (await admin.live())[0];
    await admin.call(
      `${admin.base}/protocols/${removed?.id ?? ''}`,
      { expectedVersion: 1 },
      'DELETE',
    );
    await admin.actAs('Admin');
    const restored = await admin.call(`${admin.base}/protocols/${removed?.id ?? ''}/restore`, {
      expectedVersion: 2,
      chosenUserId: await admin.idOf('Bob'),
    });
    expect(restored.status).toBe(200);
    expect((await admin.live()).map((row) => row.id)).toEqual([removed?.id]);
    const notRemoved = await admin.call(`${admin.base}/protocols/${removed?.id ?? ''}/restore`, {
      expectedVersion: 3,
      chosenUserId: await admin.idOf('Bob'),
    });
    expect(notRemoved.status).toBe(404);
  });

  it('a stale version is 409 VERSION_CONFLICT', async () => {
    const { call, base } = await setup();
    await call(`${base}/protocols`, { expectedVersion: 1, ...PCR });
    const stale = await call(`${base}/protocols`, { expectedVersion: 1, ...PCR });
    expect(stale.status).toBe(409);
    expect((await stale.json<ErrorBody>()).error.code).toBe('VERSION_CONFLICT');
  });
});
