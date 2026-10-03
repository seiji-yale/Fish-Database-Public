import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { listActivitiesByLine } from './db/queries/activities';
import { listGenotypingRecordsByLine } from './db/queries/genotypingRecords';
import { getLineByName } from './db/queries/lines';
import { listLineVersionsByLine } from './db/queries/lineVersions';
import { browser, type ErrorBody } from './testBrowser';

interface ActivityBody {
  id: string;
  version: number;
  summary: string;
}

/** The per-field messages of a 400 INVALID_INPUT answer. */
async function fieldErrors(response: Response): Promise<Record<string, string>> {
  const body = await response.json<ErrorBody>();
  return (body.error.details?.['fields'] ?? {}) as Record<string, string>;
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
  return { ...b, line, base, reload };
}

const CROSS = '2026-06-01';

describe('POST /api/lines/:id/start-breeding (BR-1, FR-ACT-02)', () => {
  it('moves Current to Breeding, records the cross date, one version and one activity', async () => {
    const { db, call, base, line, reload, idOf } = await setup();
    const response = await call(`${base}/start-breeding`, {
      expectedVersion: 1,
      crossDate: CROSS,
      note: 'Crossed with AB',
    });
    expect(response.status).toBe(200);
    expect(await response.json<ActivityBody>()).toMatchObject({
      version: 2,
      summary: 'Breeding started.',
    });
    expect(await reload()).toMatchObject({
      status: 'Breeding',
      breeding_started_at: CROSS,
      version: 2,
    });
    const [latest] = await listLineVersionsByLine(db, line.id);
    expect(latest).toMatchObject({
      change_type: 'breeding_started',
      note: 'Crossed with AB',
      created_by: await idOf('Bob'),
    });
    expect((await listActivitiesByLine(db, line.id, 1))[0]?.type).toBe('breeding_started');
  });

  it('can start again from Closed, clearing the closed fields', async () => {
    const { call, base, reload } = await setup('DEMO_E5');
    const response = await call(`${base}/start-breeding`, { expectedVersion: 1, crossDate: CROSS });
    expect(response.status).toBe(200);
    expect(await reload()).toMatchObject({ status: 'Breeding', closed_at: null });
  });

  it('refuses a line that is already Breeding with 409 INVALID_TRANSITION', async () => {
    const { call, base, reload } = await setup();
    await call(`${base}/start-breeding`, { expectedVersion: 1, crossDate: CROSS });
    const again = await call(`${base}/start-breeding`, { expectedVersion: 2, crossDate: CROSS });
    expect(again.status).toBe(409);
    expect((await again.json<ErrorBody>()).error.code).toBe('INVALID_TRANSITION');
    expect((await reload()).version).toBe(2);
  });

  it('refuses a future or malformed cross date with the field named', async () => {
    const { call, base } = await setup();
    const future = await call(`${base}/start-breeding`, {
      expectedVersion: 1,
      crossDate: '2999-01-01',
    });
    expect(future.status).toBe(400);
    expect((await fieldErrors(future))['crossDate']).toMatch(/future/);
    const bad = await call(`${base}/start-breeding`, { expectedVersion: 1, crossDate: 'soon' });
    expect(bad.status).toBe(400);
  });

  it('refuses a Guest, and asks an Admin who is making the change', async () => {
    const guest = await setup('demo_c3', 'Guest');
    const denied = await guest.call(`${guest.base}/start-breeding`, {
      expectedVersion: 1,
      crossDate: CROSS,
    });
    expect(denied.status).toBe(403);

    const admin = await setup('demo_c3', 'Admin');
    const ask = await admin.call(`${admin.base}/start-breeding`, {
      expectedVersion: 1,
      crossDate: CROSS,
    });
    // An Admin authors their own change (ADR-0005).
    expect(ask.status).toBe(200);
    const [latest] = await listLineVersionsByLine(admin.db, admin.line.id);
    expect(latest).toMatchObject({ via_admin: 0, created_by: await admin.idOf('Lab Admin') });
  });

  it('rejects a stale version with 409 VERSION_CONFLICT', async () => {
    const { call, base } = await setup();
    await call(`${base}/start-breeding`, { expectedVersion: 1, crossDate: CROSS });
    const stale = await call(`${base}/close`, { expectedVersion: 1 });
    expect(stale.status).toBe(409);
    expect((await stale.json<ErrorBody>()).error.code).toBe('VERSION_CONFLICT');
  });

  it('answers 404 for an unknown line and 400 for a body that is not an object', async () => {
    const { call } = await setup();
    const missing = await call('/api/lines/nope/start-breeding', {
      expectedVersion: 1,
      crossDate: CROSS,
    });
    expect(missing.status).toBe(404);
    const junk = await call('/api/lines/nope/start-breeding', [1, 2]);
    expect(junk.status).toBe(400);
  });
});

describe('POST /api/lines/:id/genotyping (BR-2, FR-ACT-03…05)', () => {
  it('+6 then +4 in the same generation gives IDed number 10 and two records', async () => {
    const { db, call, base, line, reload } = await setup();
    const before = await reload();
    const first = await call(`${base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-06-10',
      positiveCount: 6,
      isNewGeneration: false,
    });
    expect(first.status).toBe(200);
    expect((await first.json<ActivityBody>()).summary).toBe(
      `Genotyping: +6 positive (total ${String(before.ided_number + 6)}), same generation.`,
    );
    const second = await call(`${base}/genotyping`, {
      expectedVersion: 2,
      recordDate: '2026-06-20',
      positiveCount: '4',
      screenedCount: 12,
      isNewGeneration: false,
      note: 'second batch',
    });
    expect(second.status).toBe(200);
    expect(await reload()).toMatchObject({
      ided_number: before.ided_number + 10,
      last_id_date: '2026-06-20',
      generation_no: before.generation_no,
      version: 3,
    });
    const records = await listGenotypingRecordsByLine(db, line.id);
    const added = records.filter((row) => row.created_at > line.created_at).slice(-2);
    expect(added.map((row) => row.positive_count)).toEqual([6, 4]);
    expect(added.every((row) => row.generation_no === before.generation_no)).toBe(true);
    expect(added[1]).toMatchObject({ screened_count: 12, notes: 'second batch' });
  });

  it('a new generation resets the IDed number, moves the DOB, clears breeding and goes to Current', async () => {
    const { db, call, base, line, reload } = await setup();
    await call(`${base}/start-breeding`, { expectedVersion: 1, crossDate: '2026-05-01' });
    const before = await reload();
    const response = await call(`${base}/genotyping`, {
      expectedVersion: 2,
      recordDate: '2026-07-01',
      positiveCount: 8,
      isNewGeneration: true,
      newDob: '2026-05-20',
    });
    expect(response.status).toBe(200);
    expect(await reload()).toMatchObject({
      status: 'Current',
      dob: '2026-05-20',
      generation_no: before.generation_no + 1,
      ided_number: 8,
      last_id_date: '2026-07-01',
      breeding_started_at: null,
    });
    const records = await listGenotypingRecordsByLine(db, line.id);
    expect(records.at(-1)).toMatchObject({
      generation_no: before.generation_no + 1,
      is_new_generation: 1,
      new_dob: '2026-05-20',
      positive_count: 8,
    });
  });

  it('allows a new generation from Current (OQ-31) but not from Closed', async () => {
    const current = await setup();
    const ok = await current.call(`${current.base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-07-01',
      positiveCount: 3,
      isNewGeneration: true,
      newDob: '2026-06-01',
    });
    expect(ok.status).toBe(200);
    const closed = await setup('DEMO_E5');
    const refused = await closed.call(`${closed.base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-07-01',
      positiveCount: 3,
      isNewGeneration: true,
      newDob: '2026-06-01',
    });
    expect(refused.status).toBe(409);
    expect((await refused.json<ErrorBody>()).error.code).toBe('INVALID_TRANSITION');
  });

  it('shows the two OQ-31 date errors on the right field and writes nothing', async () => {
    const { call, base, reload } = await setup();
    const early = await call(`${base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-07-01',
      positiveCount: 3,
      isNewGeneration: true,
      newDob: '2025-09-15',
    });
    expect(early.status).toBe(400);
    const earlyFields = await fieldErrors(early);
    expect(Object.keys(earlyFields)).toEqual(['newDob']);
    expect(earlyFields['newDob']).toMatch(/later than the current generation/);
    const before = await call(`${base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-05-01',
      positiveCount: 3,
      isNewGeneration: true,
      newDob: '2026-06-01',
    });
    const lateFields = await fieldErrors(before);
    expect(Object.keys(lateFields)).toEqual(['recordDate']);
    expect(lateFields['recordDate']).toMatch(/before the new DOB/);
    expect((await reload()).version).toBe(1);
  });

  it('validates counts, the new DOB and the generation choice together', async () => {
    const { call, base } = await setup();
    const response = await call(`${base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-07-01',
      positiveCount: 5,
      screenedCount: 3,
      isNewGeneration: true,
    });
    expect(response.status).toBe(400);
    const fields = await fieldErrors(response);
    expect(Object.keys(fields).sort()).toEqual(['newDob', 'screenedCount']);
    expect(fields['screenedCount']).toMatch(/cannot be smaller/);
    expect(fields['newDob']).toMatch(/Enter the new DOB/);
    const noChoice = await call(`${base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-07-01',
      positiveCount: -1,
    });
    expect(noChoice.status).toBe(400);
  });

  it('accepts a protocol of this line and refuses one of another line', async () => {
    const { db, call, base, line } = await setup();
    const own = (await loadProtocolIds(db, line.id))[0];
    const good = await call(`${base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-07-01',
      protocolId: own,
      positiveCount: 1,
      isNewGeneration: false,
    });
    expect(good.status).toBe(200);
    const bad = await call(`${base}/genotyping`, {
      expectedVersion: 2,
      recordDate: '2026-07-01',
      protocolId: 'not-mine',
      positiveCount: 1,
      isNewGeneration: false,
    });
    expect(bad.status).toBe(400);
    expect((await fieldErrors(bad))['protocolId']).toMatch(/belongs to this line/);
  });
});

async function loadProtocolIds(db: Awaited<ReturnType<typeof setup>>['db'], lineId: string) {
  const { listIdProtocolsByLine } = await import('./db/queries/idProtocols');
  return (await listIdProtocolsByLine(db, lineId)).map((row) => row.id);
}

describe('close and reopen (BR-1, FR-ACT-06/07)', () => {
  it('Close from Current or Breeding records the date and reason; Reopen goes back to Current', async () => {
    const { call, base, reload } = await setup();
    await call(`${base}/start-breeding`, { expectedVersion: 1, crossDate: CROSS });
    const closed = await call(`${base}/close`, { expectedVersion: 2, reason: 'Line lost' });
    expect(closed.status).toBe(200);
    expect((await closed.json<ActivityBody>()).summary).toBe('Line closed.');
    expect(await reload()).toMatchObject({
      status: 'Closed',
      closed_reason: 'Line lost',
      breeding_started_at: null,
    });
    expect((await reload()).closed_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const reopened = await call(`${base}/reopen`, { expectedVersion: 3 });
    expect(reopened.status).toBe(200);
    expect(await reload()).toMatchObject({ status: 'Current', closed_at: null, version: 4 });
  });

  it('refuses Close on a Closed line and Reopen on a line that is not Closed', async () => {
    const closed = await setup('DEMO_E5');
    const again = await closed.call(`${closed.base}/close`, { expectedVersion: 1 });
    expect(again.status).toBe(409);
    const active = await setup();
    const reopen = await active.call(`${active.base}/reopen`, { expectedVersion: 1 });
    expect(reopen.status).toBe(409);
    expect((await reopen.json<ErrorBody>()).error.code).toBe('INVALID_TRANSITION');
  });

  it('the whole cycle writes five versions with matching change types', async () => {
    const { db, call, base, line } = await setup();
    await call(`${base}/start-breeding`, { expectedVersion: 1, crossDate: CROSS });
    await call(`${base}/genotyping`, {
      expectedVersion: 2,
      recordDate: '2026-06-20',
      positiveCount: 4,
      isNewGeneration: false,
    });
    await call(`${base}/genotyping`, {
      expectedVersion: 3,
      recordDate: '2026-07-20',
      positiveCount: 5,
      isNewGeneration: true,
      newDob: '2026-06-25',
    });
    await call(`${base}/close`, { expectedVersion: 4 });
    await call(`${base}/reopen`, { expectedVersion: 5 });
    const versions = (await listLineVersionsByLine(db, line.id)).map((row) => row.change_type);
    expect(versions.slice(0, 5)).toEqual([
      'reopened',
      'closed',
      'genotyping_new_gen',
      'genotyping_same_gen',
      'breeding_started',
    ]);
  });
});
