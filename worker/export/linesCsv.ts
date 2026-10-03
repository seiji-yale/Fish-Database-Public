import type { Db } from '../db/db';
import { listUsers } from '../db/queries/users';
import { buildLineListCsv } from '../lib/lineList';
import { filterAndSort, loadLineListItems, parseQuery } from '../routes/lines';

/** The Line List "All" view as CSV, exactly as `GET /api/lines.csv?view=all` would download it. */
export async function exportLinesCsv(db: Db): Promise<string> {
  const [items, users] = await Promise.all([loadLineListItems(db, 'all'), listUsers(db)]);
  const rows = filterAndSort(items, parseQuery({ view: 'all' }));
  return buildLineListCsv(rows, Object.fromEntries(users.map((user) => [user.id, user.name])));
}
