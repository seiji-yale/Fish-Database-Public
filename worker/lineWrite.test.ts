import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { listActivitiesByLine } from './db/queries/activities';
import { getLineByName } from './db/queries/lines';
import { listLineVersionsByLine } from './db/queries/lineVersions';
import { getUserByName } from './db/queries/users';
import { createMigratedDb } from './db/testing/testDb';
import { ApiError } from './lib/errors';
import { displayTimestamp, loadLineDocument, withLineWrite } from './lib/lineWrite';

async function setup() {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  const line = await getLineByName(db, 'demo_c3');
  const bob = await getUserByName(db, 'Bob');
  const carol = await getUserByName(db, 'Carol');
  if (line === null || bob === null || carol === null) throw new Error('fixture missing');
  return { db, line, bob, carol };
}

describe('withLineWrite (BR-12, NFR-09)', () => {
  it('writes the change, exactly one version and one activity, and bumps the version', async () => {
    const { db, line, carol } = await setup();
    const result = await withLineWrite(db, {
      lineId: line.id,
      expectedVersion: 1,
      author: { authorId: carol.id, viaAdmin: false },
      changeType: 'edited',
      note: 'Fixed the gene',
      now: '2026-09-28T15:00:00Z',
      mutate: () => ({ line: { gene: 'demo_c3-gene' } }),
    });

    expect(result.versionNo).toBe(2);
    expect(result.summary).toBe('Line details updated: gene.');
    const stored = await getLineByName(db, 'demo_c3');
    expect(stored).toMatchObject({
      gene: 'demo_c3-gene',
      version: 2,
      updated_at: '2026-09-28T15:00:00Z',
      updated_by: carol.id,
    });

    const versions = await listLineVersionsByLine(db, line.id);
    expect(versions.map((v) => v.version_no)).toEqual([2, 1]);
    expect(versions[0]).toMatchObject({
      change_type: 'edited',
      note: 'Fixed the gene',
      via_admin: 0,
    });
    expect(JSON.parse(versions[0]?.diff ?? '[]')).toEqual([
      { path: 'line.gene', before: null, after: 'demo_c3-gene' },
    ]);
    expect(JSON.parse(versions[0]?.snapshot ?? '{}')).toMatchObject({
      line: { gene: 'demo_c3-gene' },
    });

    const activities = await listActivitiesByLine(db, line.id, 10);
    expect(activities.map((a) => a.type)).toEqual(['edited', 'imported']);
    expect(activities[0]).toMatchObject({
      user_id: carol.id,
      ref_type: 'line_version',
      ref_id: versions[0]?.id,
    });
  });

  it('records via_admin when Admin attributed the change to someone else', async () => {
    const { db, line, bob } = await setup();
    await withLineWrite(db, {
      lineId: line.id,
      expectedVersion: 1,
      author: { authorId: bob.id, viaAdmin: true },
      changeType: 'edited',
      mutate: () => ({ line: { notes: 'via admin' } }),
    });
    const [latest] = await listLineVersionsByLine(db, line.id);
    expect(latest?.via_admin).toBe(1);
    const [activity] = await listActivitiesByLine(db, line.id, 1);
    expect(activity?.via_admin).toBe(1);
  });

  it('rejects a stale edit form with 409 and who changed the line when (BR-12)', async () => {
    const { db, line, bob, carol } = await setup();
    await withLineWrite(db, {
      lineId: line.id,
      expectedVersion: 1,
      author: { authorId: carol.id, viaAdmin: false },
      changeType: 'edited',
      now: '2026-09-28T15:00:00Z',
      mutate: () => ({ line: { gene: 'first' } }),
    });
    const second = withLineWrite(db, {
      lineId: line.id,
      expectedVersion: 1,
      author: { authorId: bob.id, viaAdmin: false },
      changeType: 'edited',
      mutate: () => ({ line: { gene: 'second' } }),
    });
    await expect(second).rejects.toMatchObject({
      status: 409,
      code: 'VERSION_CONFLICT',
      message: 'This line was changed by Carol at 2026-09-28 11:00 — reload to see the changes.',
      details: { changedBy: 'Carol', changedAt: '2026-09-28T15:00:00Z', currentVersion: 2 },
    });
    expect((await getLineByName(db, 'demo_c3'))?.gene).toBe('first');
  });

  it('turns two truly concurrent writes into one success and one 409, never two versions 2', async () => {
    const { db, line, bob, carol } = await setup();
    const write = (authorId: string, gene: string) =>
      withLineWrite(db, {
        lineId: line.id,
        expectedVersion: 1,
        author: { authorId, viaAdmin: false },
        changeType: 'edited',
        mutate: () => ({ line: { gene } }),
      });
    const results = await Promise.allSettled([write(carol.id, 'a'), write(bob.id, 'b')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect(rejected?.status === 'rejected' ? rejected.reason : null).toMatchObject({
      code: 'VERSION_CONFLICT',
    });
    expect((await listLineVersionsByLine(db, line.id)).map((v) => v.version_no)).toEqual([2, 1]);
    expect(await listActivitiesByLine(db, line.id, 10)).toHaveLength(2);
  });

  it('leaves nothing behind when a statement in the batch fails', async () => {
    const { db, line, carol } = await setup();
    const failing = withLineWrite(db, {
      lineId: line.id,
      expectedVersion: 1,
      author: { authorId: carol.id, viaAdmin: false },
      changeType: 'reference_changed',
      mutate: () => ({
        line: {},
        // A reference for a line that does not exist: the foreign key fails mid-batch.
        statements: [
          db
            .prepare(
              `INSERT INTO line_references (id, line_id, title, created_at, created_by)
               VALUES ('r-x', 'no-such-line', 'x', 't', ?)`,
            )
            .bind(carol.id),
        ],
      }),
    });
    await expect(failing).rejects.toThrow(/FOREIGN KEY/);
    expect((await getLineByName(db, 'demo_c3'))?.version).toBe(1);
    expect(await listLineVersionsByLine(db, line.id)).toHaveLength(1);
    expect(await listActivitiesByLine(db, line.id, 10)).toHaveLength(1);
  });

  it('includes child-list changes in the snapshot and diff', async () => {
    const { db, line, carol } = await setup();
    const before = await loadLineDocument(db, line.id);
    const result = await withLineWrite(db, {
      lineId: line.id,
      expectedVersion: 1,
      author: { authorId: carol.id, viaAdmin: false },
      changeType: 'edited',
      mutate: (doc) => ({
        line: {},
        children: {
          phenotypes: [
            ...doc.phenotypes,
            {
              id: 'p-new',
              line_id: line.id,
              description: 'Short Fins',
              sort_order: 0,
              deleted_at: null,
            },
          ],
        },
      }),
    });
    expect(before?.phenotypes).toEqual([]);
    expect(result.document.phenotypes.map((p) => p.description)).toEqual(['Short Fins']);
    const [latest] = await listLineVersionsByLine(db, line.id);
    const diff = JSON.parse(latest?.diff ?? '[]') as { path: string }[];
    expect(diff[0]).toMatchObject({ path: 'phenotypes' });
  });

  it('returns 404 for an unknown line and refuses to write audit columns directly', async () => {
    const { db, line, carol } = await setup();
    const author = { authorId: carol.id, viaAdmin: false };
    await expect(
      withLineWrite(db, {
        lineId: 'nope',
        expectedVersion: 1,
        author,
        changeType: 'edited',
        mutate: () => ({ line: {} }),
      }),
    ).rejects.toMatchObject({ status: 404, code: 'LINE_NOT_FOUND' });
    await expect(
      withLineWrite(db, {
        lineId: line.id,
        expectedVersion: 1,
        author,
        changeType: 'edited',
        mutate: () => ({ line: { version: 99 } as never }),
      }),
    ).rejects.toThrow(/not editable/);
  });

  it('formats timestamps for people in America/New_York', () => {
    expect(displayTimestamp('2026-09-28T15:00:00Z')).toBe('2026-09-28 11:00');
    expect(displayTimestamp('2026-01-15T15:00:00Z')).toBe('2026-01-15 10:00');
    expect(new ApiError(409, 'X', 'y').name).toBe('ApiError');
  });
});
