import { describe, expect, it } from 'vitest';
import { setSetting } from './db/queries/settings';
import { exportSchema } from './export/schema';
import { buildExportFiles } from './export/build';
import { exportLinesCsv } from './export/linesCsv';
import { browser } from './testBrowser';

describe('the export carries the Feeding Schedule (FR-FEED-26, FR-FEED-27)', () => {
  it('writes both tables, every row, and the notes setting to the JSON and the CSVs', async () => {
    const b = browser();
    await b.actAs('Bob');
    const alice = await b.idOf('Alice');
    const carol = await b.idOf('Carol');
    await setSetting(b.db, 'feeding_schedule_notes', 'Rota, see "sheet"');
    const first = await b.call(
      '/api/feeding/days/2026-10-09',
      { userId: alice, note: 'a, b', expectedAssignmentId: null },
      'PUT',
    );
    const id = (await first.json<{ assignment: { id: string } }>()).assignment.id;
    await b.call(
      '/api/feeding/days/2026-10-09',
      { userId: carol, expectedAssignmentId: id },
      'PUT',
    );
    await b.call('/api/feeding/events', { date: '2026-10-12', title: 'Inspection', note: 'n' });
    await b.call('/api/feeding/events', {
      date: '2026-10-19',
      title: 'Water',
      repeatUntil: '2026-10-26',
    });
    const [water] = (
      await b.db
        .prepare("SELECT id FROM schedule_events WHERE title = 'Water' ORDER BY date")
        .all<{ id: string }>()
    ).results;
    await b.call(`/api/feeding/events/${water?.id ?? ''}`, undefined, 'DELETE');

    const { json, csvs } = await buildExportFiles(
      b.db,
      new Date('2026-10-20T12:00:00Z'),
      exportLinesCsv,
    );
    exportSchema.parse(json);
    expect(json.settings.feeding_schedule_notes).toBe('Rota, see "sheet"');
    expect(json.feedingAssignments).toHaveLength(2);
    expect(json.feedingAssignments.map((row) => row['replaced_at'] === null)).toEqual([
      false,
      true,
    ]);
    expect(json.scheduleEvents).toHaveLength(3);
    expect(json.scheduleEvents.filter((row) => row['deleted_at'] !== null)).toHaveLength(1);

    const assignments = (csvs['feeding_assignments.csv'] ?? '').split('\r\n');
    expect(assignments[0]?.replace('\ufeff', '')).toBe(
      'id,date,user_id,user_name,note,imported_from,created_at,created_by,created_by_name,replaced_at,replaced_by,replaced_by_name',
    );
    expect(assignments[1]).toContain(',Alice,"a, b",');
    expect(assignments[1]).toContain(',Bob,');
    expect(assignments[2]).toContain(',Carol,');
    const events = (csvs['schedule_events.csv'] ?? '').split('\r\n');
    expect(events[0]?.replace('\ufeff', '')).toBe(
      'id,date,series_id,title,note,created_at,created_by,created_by_name,updated_at,updated_by,updated_by_name,deleted_at,deleted_by,deleted_by_name',
    );
    expect(events).toHaveLength(5); // header, three rows, trailing newline
  });

  it('writes the headers alone when nothing is scheduled, and the old export still validates', async () => {
    const b = browser();
    const { json, csvs } = await buildExportFiles(
      b.db,
      new Date('2026-10-20T12:00:00Z'),
      exportLinesCsv,
    );
    expect(json.feedingAssignments).toEqual([]);
    expect(csvs['feeding_assignments.csv']?.replace('\ufeff', '')).toBe(
      'id,date,user_id,user_name,note,imported_from,created_at,created_by,created_by_name,replaced_at,replaced_by,replaced_by_name\r\n',
    );
    const old = { ...json } as Record<string, unknown>;
    delete old['feedingAssignments'];
    delete old['scheduleEvents'];
    const parsed = exportSchema.parse(old);
    expect(parsed.feedingAssignments).toEqual([]);
    expect(parsed.scheduleEvents).toEqual([]);
  });
});
