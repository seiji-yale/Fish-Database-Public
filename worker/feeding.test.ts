import { describe, expect, it } from 'vitest';
import { getSetting, setSetting } from './db/queries/settings';
import { listAllAssignments } from './db/queries/feedingAssignments';
import { listAllEvents } from './db/queries/scheduleEvents';
import { browser, type ErrorBody } from './testBrowser';

interface Assignment {
  id: string;
  userId: string;
  userName: string;
  note: string | null;
  createdByName: string;
}
interface Day {
  date: string;
  weekday: string;
  assignment: Assignment | null;
  events: { id: string; seriesId: string | null; title: string; followingCount: number }[];
}
interface History {
  userName: string;
  note: string | null;
  createdByName: string;
  replacedAt: string | null;
  replacedByName: string | null;
}
interface Month {
  month: string;
  days: Day[];
  assignable: { id: string; name: string; role: string }[];
  totals: {
    byUser: { name: string; weekdays: number; weekend: number; total: number }[];
    unassigned: number;
  };
  notes: string;
}

async function setup(actor = 'Bob') {
  const b = browser();
  const admin = browser(b.db);
  await admin.actAs('Admin');
  await admin.call('/api/admin/users', {
    name: 'Feeder One',
    role: 'feeder',
    initialPassword: 'first-pass',
  });
  await b.actAs(actor);
  const ids = {
    alice: await b.idOf('Alice'),
    bob: await b.idOf('Bob'),
    carol: await b.idOf('Carol'),
    feeder: await b.idOf('Feeder One'),
    guest: await b.idOf('Guest'),
    erin: await b.idOf('Erin'),
  };
  const month = async (m = '2026-10') =>
    await (await b.call(`/api/feeding?month=${m}`)).json<Month>();
  const put = (date: string, body: unknown) => b.call(`/api/feeding/days/${date}`, body, 'PUT');
  return { ...b, ids, month, put };
}

const code = async (response: Response) => (await response.json<ErrorBody>()).error.code;

describe('GET /api/feeding', () => {
  it('returns the month with every day, the assignable people, totals and notes', async () => {
    const t = await setup();
    await setSetting(t.db, 'feeding_schedule_notes', 'Rota: https://example.test/rota');
    for (const [date, who] of [
      ['2026-10-01', t.ids.alice],
      ['2026-10-02', t.ids.alice],
      ['2026-10-03', t.ids.bob],
      ['2026-10-04', t.ids.alice],
    ] as const)
      expect((await t.put(date, { userId: who, expectedAssignmentId: null })).status).toBe(200);
    const month = await t.month();
    expect(month.days).toHaveLength(31);
    expect(month.days[0]).toMatchObject({ date: '2026-10-01', weekday: 'Thursday' });
    expect(month.days[30]).toMatchObject({ date: '2026-10-31', weekday: 'Saturday' });
    expect(month.days[0]?.assignment).toMatchObject({
      userName: 'Alice',
      createdByName: 'Bob',
      note: null,
    });
    expect(month.totals).toEqual({
      byUser: [
        { userId: t.ids.alice, name: 'Alice', weekdays: 2, weekend: 1, total: 3 },
        { userId: t.ids.bob, name: 'Bob', weekdays: 0, weekend: 1, total: 1 },
      ],
      unassigned: 27,
    });
    expect(month.notes).toBe('Rota: https://example.test/rota');
    const names = month.assignable.map((person) => person.name);
    expect(names).toEqual(
      ['Alice', 'Bob', 'Carol', 'Dan', 'Feeder One', 'Lab Admin'].filter((n) => names.includes(n)),
    );
    expect(names).not.toContain('Guest');
    expect(names).not.toContain('Erin');
    expect(month.assignable.every((person) => person.role !== 'guest')).toBe(true);
  });

  it('defaults to the current month and refuses a bad month', async () => {
    const t = await setup();
    const current = await (await t.call('/api/feeding')).json<Month>();
    expect(current.month).toMatch(/^\d{4}-\d{2}$/);
    expect(current.days.length).toBeGreaterThanOrEqual(28);
    const bad = await t.call('/api/feeding?month=2026-13');
    expect(bad.status).toBe(400);
    expect(await code(bad)).toBe('INVALID_INPUT');
  });

  it('is empty and quiet for a month with nothing in it', async () => {
    const t = await setup();
    const month = await t.month('2026-02');
    expect(month.days).toHaveLength(28);
    expect(month.totals).toEqual({ byUser: [], unassigned: 28 });
    expect(month.notes).toBe('');
  });
});

describe('PUT /api/feeding/days/:date (BR-13, BR-17)', () => {
  it('creates the day, refuses a stale save with 409 and keeps both rows in the history', async () => {
    const t = await setup();
    const first = await t.put('2026-10-09', {
      userId: t.ids.alice,
      note: ' cover ',
      expectedAssignmentId: null,
    });
    expect(first.status).toBe(200);
    const day = await first.json<Day>();
    expect(day.assignment).toMatchObject({ userName: 'Alice', note: 'cover' });
    const staleId = day.assignment?.id ?? '';

    const second = await t.put('2026-10-09', {
      userId: t.ids.carol,
      expectedAssignmentId: staleId,
    });
    expect(second.status).toBe(200);
    const stale = await t.put('2026-10-09', { userId: t.ids.bob, expectedAssignmentId: staleId });
    expect(stale.status).toBe(409);
    const body = await stale.json<ErrorBody>();
    expect(body.error.code).toBe('DAY_CHANGED');
    expect(body.error.message).toMatch(
      /^This day was changed by Bob at \d{4}-\d{2}-\d{2} \d{2}:\d{2}\. Reload to see the change, then try again\.$/,
    );

    const history = await (await t.call('/api/feeding/days/2026-10-09/history')).json<History[]>();
    expect(history.map((row) => row.userName)).toEqual(['Alice', 'Carol']);
    expect(history[0]).toMatchObject({
      note: 'cover',
      createdByName: 'Bob',
      replacedByName: 'Bob',
    });
    expect(history[0]?.replacedAt).not.toBeNull();
    expect(history[1]).toMatchObject({ replacedAt: null, replacedByName: null });
    expect(await listAllAssignments(t.db)).toHaveLength(2);
  });

  it('lets exactly one of two saves with the same expected id win', async () => {
    const t = await setup();
    const results = await Promise.all([
      t.put('2026-10-10', { userId: t.ids.alice, expectedAssignmentId: null }),
      t.put('2026-10-10', { userId: t.ids.carol, expectedAssignmentId: null }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await listAllAssignments(t.db)).filter((row) => row.replaced_at === null)).toHaveLength(
      1,
    );
  });

  it('clears a day, refuses a stale clear, and treats saving the same value as no change', async () => {
    const t = await setup();
    const set = await (
      await t.put('2026-10-12', { userId: t.ids.alice, note: 'n', expectedAssignmentId: null })
    ).json<Day>();
    const id = set.assignment?.id ?? '';
    const same = await t.put('2026-10-12', {
      userId: t.ids.alice,
      note: 'n',
      expectedAssignmentId: id,
    });
    expect((await same.json<Day>()).assignment?.id).toBe(id);
    expect(await listAllAssignments(t.db)).toHaveLength(1);

    const cleared = await t.put('2026-10-12', {
      userId: null,
      note: 'ignored',
      expectedAssignmentId: id,
    });
    expect((await cleared.json<Day>()).assignment).toBeNull();
    const rows = await listAllAssignments(t.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ replaced_by: t.ids.bob });

    const again = await t.put('2026-10-12', { userId: null, expectedAssignmentId: null });
    expect(again.status).toBe(200);
    const stale = await t.put('2026-10-12', { userId: null, expectedAssignmentId: id });
    expect(stale.status).toBe(409);
    expect((await stale.json<ErrorBody>()).error.message).toContain('changed by Bob');
    const staleSet = await t.put('2026-10-12', { userId: t.ids.carol, expectedAssignmentId: id });
    expect(staleSet.status).toBe(409);
    expect(await listAllAssignments(t.db)).toHaveLength(1);
  });

  it('says "someone" when the history names nobody who can be found', async () => {
    const t = await setup();
    const set = await (
      await t.put('2026-10-13', { userId: t.ids.alice, expectedAssignmentId: null })
    ).json<Day>();
    const id = set.assignment?.id ?? '';
    await t.db
      .prepare('UPDATE feeding_assignments SET replaced_at = NULL WHERE id = ?')
      .bind(id)
      .run();
    await t.db.prepare('DELETE FROM feeding_assignments WHERE id = ?').bind(id).run();
    const stale = await t.put('2026-10-13', { userId: t.ids.carol, expectedAssignmentId: id });
    expect(stale.status).toBe(409);
    expect((await stale.json<ErrorBody>()).error.message).toContain('changed by someone');
  });

  it('refuses a person who cannot be assigned (BR-14) and bad input', async () => {
    const t = await setup();
    for (const userId of [t.ids.guest, t.ids.erin, 'no-such-user']) {
      const response = await t.put('2026-10-14', { userId, expectedAssignmentId: null });
      expect(response.status).toBe(400);
      expect(
        ((await response.json<ErrorBody>()).error.details?.['fields'] as Record<string, string>)[
          'userId'
        ],
      ).toMatch(/active Admin, Member or Feeder/);
    }
    expect(
      (await t.put('2026-10-14', { userId: t.ids.feeder, expectedAssignmentId: null })).status,
    ).toBe(200);
    expect(
      (await t.put('2026-02-30', { userId: t.ids.alice, expectedAssignmentId: null })).status,
    ).toBe(400);
    expect((await t.put('2026-10-15', { expectedAssignmentId: null })).status).toBe(400);
    expect(
      (
        await t.put('2026-10-15', {
          userId: t.ids.alice,
          note: 'x'.repeat(201),
          expectedAssignmentId: null,
        })
      ).status,
    ).toBe(400);
    expect((await t.call('/api/feeding/days/2026-10-15', 'not json{', 'PUT')).status).toBe(400);
    expect((await t.call('/api/feeding/days/x/history')).status).toBe(400);
  });

  it('marks the Dropbox copy out of date (FR-FEED-29)', async () => {
    const t = await setup();
    await setSetting(t.db, 'mirror_dirty_at', null);
    expect(await getSetting(t.db, 'mirror_dirty_at')).toBeNull();
    await t.put('2026-10-16', { userId: t.ids.alice, expectedAssignmentId: null });
    expect(await getSetting(t.db, 'mirror_dirty_at')).not.toBeNull();
  });
});

describe('who may use the schedule (BR-15)', () => {
  it('refuses a Guest everywhere and lets a Feeder read and write', async () => {
    const guest = await setup('Guest');
    for (const [path, method] of [
      ['/api/feeding', 'GET'],
      ['/api/feeding/days/2026-10-09/history', 'GET'],
      ['/api/feeding/days/2026-10-09', 'PUT'],
      ['/api/feeding/repeat-week', 'POST'],
      ['/api/feeding/events', 'POST'],
      ['/api/feeding/events/x', 'PATCH'],
      ['/api/feeding/events/x', 'DELETE'],
    ] as const) {
      const response = await guest.call(path, method === 'GET' ? undefined : {}, method);
      expect([path, response.status]).toEqual([path, 403]);
    }
    expect(await listAllAssignments(guest.db)).toHaveLength(0);

    const feeder = await setup('Feeder One');
    expect((await feeder.call('/api/feeding?month=2026-10')).status).toBe(200);
    const saved = await feeder.put('2026-10-09', {
      userId: feeder.ids.feeder,
      expectedAssignmentId: null,
    });
    expect(saved.status).toBe(200);
    expect((await saved.json<Day>()).assignment).toMatchObject({
      userName: 'Feeder One',
      createdByName: 'Feeder One',
    });
  });
});

describe('POST /api/feeding/repeat-week (FR-FEED-15)', () => {
  const WEEK = '2026-10-04';
  async function pattern(t: Awaited<ReturnType<typeof setup>>) {
    for (const [date, userId] of [
      ['2026-10-05', t.ids.alice],
      ['2026-10-06', t.ids.bob],
      ['2026-10-09', t.ids.carol],
    ] as const)
      await t.put(date, { userId, expectedAssignmentId: null });
  }

  it('counts on a dry run without writing, then fills the empty days after the week', async () => {
    const t = await setup();
    await pattern(t);
    const before = (await listAllAssignments(t.db)).length;
    const dry = await t.call('/api/feeding/repeat-week', {
      weekStart: WEEK,
      month: '2026-10',
      overwrite: false,
      dryRun: true,
    });
    expect(await dry.json()).toEqual({ filled: 9, kept: 0, replaced: 0 });
    expect(await listAllAssignments(t.db)).toHaveLength(before);

    const applied = await t.call('/api/feeding/repeat-week', {
      weekStart: WEEK,
      month: '2026-10',
      overwrite: false,
    });
    expect(await applied.json()).toEqual({ filled: 9, kept: 0, replaced: 0 });
    const month = await t.month();
    const byDate = new Map(month.days.map((d) => [d.date, d.assignment?.userName ?? null]));
    expect(byDate.get('2026-10-12')).toBe('Alice');
    expect(byDate.get('2026-10-20')).toBe('Bob');
    expect(byDate.get('2026-10-30')).toBe('Carol');
    expect(byDate.get('2026-10-13')).toBe('Bob');
    expect(byDate.get('2026-10-11')).toBeNull();
    expect(byDate.get('2026-10-07')).toBeNull();
    expect(await listAllAssignments(t.db)).toHaveLength(before + 9);
  });

  it('keeps assigned days unless overwrite is on, and records replacements as history', async () => {
    const t = await setup();
    await pattern(t);
    await t.put('2026-10-12', { userId: t.ids.carol, expectedAssignmentId: null });
    const keep = await t.call('/api/feeding/repeat-week', {
      weekStart: WEEK,
      month: '2026-10',
      overwrite: false,
    });
    expect(await keep.json()).toEqual({ filled: 8, kept: 1, replaced: 0 });
    expect((await t.month()).days[11]?.assignment?.userName).toBe('Carol');

    const over = await t.call('/api/feeding/repeat-week', {
      weekStart: WEEK,
      month: '2026-10',
      overwrite: true,
    });
    expect(await over.json()).toEqual({ filled: 0, kept: 8, replaced: 1 });
    expect((await t.month()).days[11]?.assignment?.userName).toBe('Alice');
    const history = await (await t.call('/api/feeding/days/2026-10-12/history')).json<History[]>();
    expect(history.map((row) => row.userName)).toEqual(['Carol', 'Alice']);
    const again = await t.call('/api/feeding/repeat-week', {
      weekStart: WEEK,
      month: '2026-10',
      overwrite: true,
    });
    expect(await again.json()).toEqual({ filled: 0, kept: 9, replaced: 0 });
  });

  it('ignores a source-week person who can no longer be assigned, and refuses bad input', async () => {
    const t = await setup();
    await pattern(t);
    await t.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').bind(t.ids.carol).run();
    const dry = await t.call('/api/feeding/repeat-week', {
      weekStart: WEEK,
      month: '2026-10',
      dryRun: true,
    });
    expect(await dry.json()).toEqual({ filled: 6, kept: 0, replaced: 0 });
    expect(
      (await t.call('/api/feeding/repeat-week', { weekStart: '2026-09-20', month: '2026-10' }))
        .status,
    ).toBe(400);
    expect((await t.call('/api/feeding/repeat-week', 'x{', 'POST')).status).toBe(400);
  });
});

describe('events (FR-FEED-20 … 22, BR-19)', () => {
  const create = (t: Awaited<ReturnType<typeof setup>>, body: object) =>
    t.call('/api/feeding/events', body);

  it('creates a one-off event shown on its day', async () => {
    const t = await setup();
    const response = await create(t, {
      date: '2026-10-14',
      title: 'Inspection',
      note: 'Bring badge',
    });
    expect(await response.json()).toEqual({ count: 1, dates: ['2026-10-14'] });
    const day = (await t.month()).days[13];
    expect(day?.events).toHaveLength(1);
    expect(day?.events[0]).toMatchObject({
      title: 'Inspection',
      seriesId: null,
      followingCount: 1,
    });
    const [row] = await listAllEvents(t.db);
    expect(row).toMatchObject({ created_by: t.ids.bob, updated_by: t.ids.bob, series_id: null });
  });

  it('creates a weekly series, previews with a dry run, and counts the following occurrences', async () => {
    const t = await setup();
    const dry = await create(t, {
      date: '2026-10-05',
      title: 'Test Water Quality',
      repeatUntil: '2026-10-26',
      dryRun: true,
    });
    expect(await dry.json()).toEqual({
      count: 4,
      dates: ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'],
    });
    expect(await listAllEvents(t.db)).toHaveLength(0);
    const response = await create(t, {
      date: '2026-10-05',
      title: 'Test Water Quality',
      repeatUntil: '2026-10-26',
    });
    expect((await response.json<{ count: number }>()).count).toBe(4);
    const rows = await listAllEvents(t.db);
    expect(new Set(rows.map((row) => row.series_id)).size).toBe(1);
    expect(rows[0]?.series_id).not.toBeNull();
    const month = await t.month();
    expect(
      month.days
        .filter((d) => d.events.length > 0)
        .map((d) => [d.date, d.events[0]?.followingCount]),
    ).toEqual([
      ['2026-10-05', 4],
      ['2026-10-12', 3],
      ['2026-10-19', 2],
      ['2026-10-26', 1],
    ]);
    // November shows the series through the one occurrence it has there.
    const november = await t.month('2026-11');
    expect(november.days.every((d) => d.events.length === 0)).toBe(true);
  });

  it('counts a series across months', async () => {
    const t = await setup();
    await create(t, { date: '2026-10-26', title: 'Water', repeatUntil: '2026-11-16' });
    const october = await t.month('2026-10');
    expect(october.days[25]?.events[0]?.followingCount).toBe(4);
    const november = await t.month('2026-11');
    expect(november.days[1]?.events[0]?.followingCount).toBe(3);
  });

  it('refuses a bad repeat, a bad title and a bad date', async () => {
    const t = await setup();
    const fieldsOf = async (response: Response) =>
      (await response.json<ErrorBody>()).error.details?.['fields'] as Record<string, string>;
    const before = await create(t, { date: '2026-10-05', title: 'X', repeatUntil: '2026-10-01' });
    expect(before.status).toBe(400);
    expect(await fieldsOf(before)).toHaveProperty('repeatUntil');
    const many = await create(t, { date: '2026-10-05', title: 'X', repeatUntil: '2029-01-01' });
    expect((await fieldsOf(many))['repeatUntil']).toMatch(/at most 104/);
    expect((await create(t, { date: '2026-10-05', title: ' ' })).status).toBe(400);
    expect((await create(t, { date: 'x', title: 'X' })).status).toBe(400);
    expect(await listAllEvents(t.db)).toHaveLength(0);
  });

  async function series(t: Awaited<ReturnType<typeof setup>>) {
    await create(t, { date: '2026-10-05', title: 'Water', note: 'a', repeatUntil: '2026-10-26' });
    const rows = await listAllEvents(t.db);
    return rows.map((row) => row.id) as [string, string, string, string];
  }

  it('edits one event, or this and the following ones of a series', async () => {
    const t = await setup();
    const [first, second, third, fourth] = await series(t);
    const one = await t.call(`/api/feeding/events/${second}`, { title: 'Water (moved)' }, 'PATCH');
    expect(await one.json()).toEqual({ updated: 1 });
    let rows = await listAllEvents(t.db);
    expect(rows.map((row) => row.title)).toEqual(['Water', 'Water (moved)', 'Water', 'Water']);

    const following = await t.call(
      `/api/feeding/events/${third}`,
      { note: 'b', scope: 'following' },
      'PATCH',
    );
    expect(await following.json()).toEqual({ updated: 2 });
    rows = await listAllEvents(t.db);
    expect(rows.map((row) => row.note)).toEqual(['a', 'a', 'b', 'b']);
    expect(rows.every((row) => row.series_id === rows[0]?.series_id)).toBe(true);
    expect(rows[2]).toMatchObject({ updated_by: t.ids.bob });
    expect(rows[0]?.id).toBe(first);
    expect(fourth).toBeDefined();

    const clear = await t.call(`/api/feeding/events/${first}`, { note: '' }, 'PATCH');
    expect(clear.status).toBe(200);
    expect((await listAllEvents(t.db))[0]?.note).toBeNull();
  });

  it('deletes one event, or this and the following ones, softly', async () => {
    const t = await setup();
    const [first, second, third] = await series(t);
    const one = await t.call(`/api/feeding/events/${first}`, undefined, 'DELETE');
    expect(await one.json()).toEqual({ deleted: 1 });
    const following = await t.call(
      `/api/feeding/events/${third}?scope=following`,
      undefined,
      'DELETE',
    );
    expect(await following.json()).toEqual({ deleted: 2 });
    const rows = await listAllEvents(t.db);
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.deleted_at === null).map((row) => row.id)).toEqual([second]);
    expect(rows[2]).toMatchObject({ deleted_by: t.ids.bob });
    expect((await t.month()).days.flatMap((d) => d.events).map((e) => e.id)).toEqual([second]);
    const gone = await t.call(`/api/feeding/events/${first}`, undefined, 'DELETE');
    expect(gone.status).toBe(404);
    expect(await code(gone)).toBe('EVENT_NOT_FOUND');
  });

  it('refuses "following" on a one-off, an unknown scope, an empty edit and an unknown event', async () => {
    const t = await setup();
    await create(t, { date: '2026-10-14', title: 'Inspection' });
    const [event] = await listAllEvents(t.db);
    const id = event?.id ?? '';
    expect(
      (await t.call(`/api/feeding/events/${id}`, { title: 'X', scope: 'following' }, 'PATCH'))
        .status,
    ).toBe(400);
    expect(
      (await t.call(`/api/feeding/events/${id}?scope=following`, undefined, 'DELETE')).status,
    ).toBe(400);
    expect((await t.call(`/api/feeding/events/${id}?scope=all`, undefined, 'DELETE')).status).toBe(
      400,
    );
    expect((await t.call(`/api/feeding/events/${id}`, {}, 'PATCH')).status).toBe(400);
    expect((await t.call('/api/feeding/events/nope', { title: 'X' }, 'PATCH')).status).toBe(404);
    expect((await listAllEvents(t.db))[0]?.deleted_at).toBeNull();
  });
});
