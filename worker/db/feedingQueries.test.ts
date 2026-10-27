import { describe, expect, it } from 'vitest';
import {
  closeAssignmentStatement,
  getCurrentAssignment,
  insertAssignmentStatement,
  listAllAssignments,
  listAssignmentHistory,
  listCurrentAssignments,
} from './queries/feedingAssignments';
import {
  getLiveEvent,
  insertEventStatement,
  listAllEvents,
  listEventsInRange,
  listSeriesFrom,
  softDeleteEventStatement,
  updateEventStatement,
} from './queries/scheduleEvents';
import { makeFeedingAssignment, makeScheduleEvent, USER_ID } from './testing/builders';
import { createMigratedDb } from './testing/testDb';

const assign = (id: string, date: string, over = {}) =>
  makeFeedingAssignment({ id, date, ...over });

describe('feeding_assignments (migration 0014, BR-13)', () => {
  it('rejects a second current row for one date, but allows a replaced row plus a current one', async () => {
    const db = createMigratedDb();
    await insertAssignmentStatement(db, assign('a1', '2026-10-09')).run();
    await expect(insertAssignmentStatement(db, assign('a2', '2026-10-09')).run()).rejects.toThrow();
    await closeAssignmentStatement(db, 'a1', '2026-10-01T00:00:00Z', USER_ID.bob).run();
    await insertAssignmentStatement(
      db,
      assign('a2', '2026-10-09', { user_id: USER_ID.carol }),
    ).run();
    expect((await getCurrentAssignment(db, '2026-10-09'))?.id).toBe('a2');
    expect((await listAssignmentHistory(db, '2026-10-09')).map((row) => row.id)).toEqual([
      'a1',
      'a2',
    ]);
  });

  it('closes one row once and keeps the first closing', async () => {
    const db = createMigratedDb();
    await insertAssignmentStatement(db, assign('a1', '2026-10-09')).run();
    await closeAssignmentStatement(db, 'a1', '2026-10-02T00:00:00Z', USER_ID.bob).run();
    await closeAssignmentStatement(db, 'a1', '2026-10-03T00:00:00Z', USER_ID.carol).run();
    const [row] = await listAllAssignments(db);
    expect(row).toMatchObject({ replaced_at: '2026-10-02T00:00:00Z', replaced_by: USER_ID.bob });
    expect(await getCurrentAssignment(db, '2026-10-09')).toBeNull();
  });

  it('lists the current values of a date range in date order', async () => {
    const db = createMigratedDb();
    await insertAssignmentStatement(db, assign('a3', '2026-10-31')).run();
    await insertAssignmentStatement(db, assign('a1', '2026-10-01')).run();
    await insertAssignmentStatement(db, assign('a2', '2026-10-15')).run();
    await insertAssignmentStatement(db, assign('a4', '2026-11-01')).run();
    await closeAssignmentStatement(db, 'a2', '2026-10-02T00:00:00Z', USER_ID.bob).run();
    expect((await listCurrentAssignments(db, '2026-10-01', '2026-10-31')).map((r) => r.id)).toEqual(
      ['a1', 'a3'],
    );
  });

  it('refuses bad dates, long notes and unknown users', async () => {
    const db = createMigratedDb();
    for (const row of [
      assign('b1', '2026-02-30'),
      assign('b2', '1999-12-31'),
      assign('b3', '2101-01-01'),
      assign('b4', '2026-10-09', { note: 'x'.repeat(201) }),
      assign('b5', '2026-10-09', { user_id: 'nobody' }),
    ]) {
      await expect(insertAssignmentStatement(db, row).run()).rejects.toThrow();
    }
    await insertAssignmentStatement(
      db,
      assign('ok', '2026-10-09', { note: 'x'.repeat(200) }),
    ).run();
  });
});

describe('schedule_events (migration 0014, BR-19)', () => {
  it('lists live events of a range, in date order, and hides deleted ones', async () => {
    const db = createMigratedDb();
    await insertEventStatement(db, makeScheduleEvent({ id: 'e2', date: '2026-10-19' })).run();
    await insertEventStatement(db, makeScheduleEvent({ id: 'e1', date: '2026-10-12' })).run();
    await insertEventStatement(db, makeScheduleEvent({ id: 'e3', date: '2026-11-02' })).run();
    await softDeleteEventStatement(db, 'e2', '2026-10-05T00:00:00Z', USER_ID.carol).run();
    await softDeleteEventStatement(db, 'e2', '2026-10-06T00:00:00Z', USER_ID.bob).run();
    expect((await listEventsInRange(db, '2026-10-01', '2026-10-31')).map((r) => r.id)).toEqual([
      'e1',
    ]);
    expect(await getLiveEvent(db, 'e2')).toBeNull();
    expect((await getLiveEvent(db, 'e1'))?.id).toBe('e1');
    const all = await listAllEvents(db);
    expect(all.map((r) => r.id)).toEqual(['e1', 'e2', 'e3']);
    expect(all[1]).toMatchObject({ deleted_at: '2026-10-05T00:00:00Z', deleted_by: USER_ID.carol });
  });

  it('edits title and note in place and keeps series_id; a deleted row is not edited', async () => {
    const db = createMigratedDb();
    await insertEventStatement(db, makeScheduleEvent({ id: 'e1', series_id: 's1' })).run();
    await insertEventStatement(
      db,
      makeScheduleEvent({ id: 'e2', series_id: 's1', date: '2026-10-19' }),
    ).run();
    await updateEventStatement(db, 'e1', {
      title: 'Inspection',
      note: 'ask',
      updatedAt: '2026-10-05T00:00:00Z',
      updatedBy: USER_ID.carol,
    }).run();
    await softDeleteEventStatement(db, 'e2', '2026-10-05T00:00:00Z', USER_ID.bob).run();
    await updateEventStatement(db, 'e2', {
      title: 'Changed',
      note: null,
      updatedAt: '2026-10-06T00:00:00Z',
      updatedBy: USER_ID.bob,
    }).run();
    const [e1, e2] = await listAllEvents(db);
    expect(e1).toMatchObject({
      title: 'Inspection',
      note: 'ask',
      series_id: 's1',
      updated_by: USER_ID.carol,
    });
    expect(e2?.title).toBe('Test Water Quality');
  });

  it('lists the live rows of a series from a date on (this row included)', async () => {
    const db = createMigratedDb();
    for (const [id, date] of [
      ['e1', '2026-10-05'],
      ['e2', '2026-10-12'],
      ['e3', '2026-10-19'],
      ['e4', '2026-10-26'],
    ] as const) {
      await insertEventStatement(db, makeScheduleEvent({ id, date, series_id: 's1' })).run();
    }
    await insertEventStatement(
      db,
      makeScheduleEvent({ id: 'x', date: '2026-10-19', series_id: 's2' }),
    ).run();
    await softDeleteEventStatement(db, 'e4', '2026-10-05T00:00:00Z', USER_ID.bob).run();
    expect((await listSeriesFrom(db, 's1', '2026-10-12')).map((r) => r.id)).toEqual(['e2', 'e3']);
  });

  it('enforces the title and note limits', async () => {
    const db = createMigratedDb();
    for (const over of [
      { title: '   ' },
      { title: 'x'.repeat(61) },
      { note: 'x'.repeat(201) },
      { date: '2026-13-01' },
    ]) {
      await expect(insertEventStatement(db, makeScheduleEvent(over)).run()).rejects.toThrow();
    }
    await insertEventStatement(db, makeScheduleEvent({ title: 'x'.repeat(60) })).run();
  });
});
