/**
 * Shared building blocks for the query helpers. Rules for everything in worker/db/queries:
 * - Values are always bound parameters (`?`), never concatenated into SQL.
 * - Table and column names come only from the compile-time constants defined next to each helper
 *   (`TableSpec`), never from request data.
 * - No business logic: no status rules, no version checks, no history rows. Those belong to the
 *   domain layer and the write handlers.
 * - Reads exclude soft-deleted rows unless the caller passes `includeDeleted: true` (Admin views).
 * - There is no hard-delete helper for domain tables (BR-7).
 */
import type { Db, DbStatement } from '../db';
import { AdminAuthorError } from '../errors';

export interface TableSpec<Row> {
  readonly table: string;
  readonly columns: readonly (keyof Row & string)[];
  /** True when the table has a `deleted_at` column. */
  readonly softDelete: boolean;
}

export interface ListOptions {
  /** Admin "deleted items" views only. Defaults to false. */
  includeDeleted?: boolean;
}

/**
 * Lists the columns of a row type. The parameter type makes TypeScript reject a missing or an
 * unknown column, so the list can never drift from the row type. Order = declaration order.
 */
export function columnsOf<Row>(all: Record<keyof Row, true>): (keyof Row & string)[] {
  return Object.keys(all) as (keyof Row & string)[];
}

export function define<Row>(
  table: string,
  all: Record<keyof Row, true>,
  softDelete = false,
): TableSpec<Row> {
  return { table, columns: columnsOf<Row>(all), softDelete };
}

/** Adds `AND deleted_at IS NULL` style filters; `where` must be a literal, not user input. */
function liveFilter(spec: { softDelete: boolean }, options: ListOptions | undefined): string {
  return spec.softDelete && options?.includeDeleted !== true ? 'deleted_at IS NULL' : '1 = 1';
}

/** An INSERT statement for `db.batch([...])` (one transaction) or for `insertRow`. */
export function insertStatement<Row>(db: Db, spec: TableSpec<Row>, row: Row): DbStatement {
  const columns = spec.columns.join(', ');
  const placeholders = spec.columns.map(() => '?').join(', ');
  return db
    .prepare(`INSERT INTO ${spec.table} (${columns}) VALUES (${placeholders})`)
    .bind(...spec.columns.map((column) => row[column]));
}

export function insertRow<Row>(db: Db, spec: TableSpec<Row>, row: Row): Promise<unknown> {
  return insertStatement(db, spec, row).run();
}

/** Returns the row even if soft-deleted: an id lookup is explicit, and history needs it. */
export function getRowById<Row>(db: Db, spec: TableSpec<Row>, id: string): Promise<Row | null> {
  return db.prepare(`SELECT * FROM ${spec.table} WHERE id = ?`).bind(id).first<Row>();
}

/** Rows where `column = value`, ordered by the literal `orderBy`, soft-deleted rows excluded by default. */
export async function listRowsBy<Row>(
  db: Db,
  spec: TableSpec<Row>,
  column: keyof Row & string,
  value: string,
  orderBy: string,
  options?: ListOptions,
): Promise<Row[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM ${spec.table} WHERE ${column} = ? AND ${liveFilter(spec, options)} ORDER BY ${orderBy}`,
    )
    .bind(value)
    .all<Row>();
  return results;
}

/** Hosted D1 allows at most 100 bound parameters in one statement: longer lists are run in chunks. */
export const MAX_IN_VALUES = 90;

export function chunk<T>(values: readonly T[], size = MAX_IN_VALUES): T[][] {
  const chunks: T[][] = [];
  for (let at = 0; at < values.length; at += size) chunks.push(values.slice(at, at + size));
  return chunks;
}

/**
 * Rows where `column IN (values)`, ordered by the literal `orderBy`, soft-deleted rows excluded by
 * default. `values` are bound parameters, run in chunks of `MAX_IN_VALUES` (a lab with a few hundred
 * lines would otherwise hit D1's 100-parameter limit); each chunk keeps its own order, which is all
 * callers need because they group the rows by the column they searched on. Empty `values` returns
 * `[]` without a query (list views batch-load children for the current page of lines this way).
 */
export async function listRowsByIn<Row>(
  db: Db,
  spec: TableSpec<Row>,
  column: keyof Row & string,
  values: readonly string[],
  orderBy: string,
  options?: ListOptions,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (const part of chunk(values)) {
    const placeholders = part.map(() => '?').join(', ');
    const { results } = await db
      .prepare(
        `SELECT * FROM ${spec.table} WHERE ${column} IN (${placeholders}) AND ${liveFilter(spec, options)} ORDER BY ${orderBy}`,
      )
      .bind(...part)
      .all<Row>();
    rows.push(...results);
  }
  return rows;
}

/**
 * Soft delete: sets `deleted_at` once. Returns true when a live row was hidden, false when the id
 * is unknown or already deleted. The row itself is never removed (BR-7).
 */
export async function softDeleteRow<Row>(
  db: Db,
  spec: TableSpec<Row>,
  id: string,
  now: string,
): Promise<boolean> {
  if (!spec.softDelete) throw new Error(`${spec.table} has no deleted_at column`);
  const result = await db
    .prepare(`UPDATE ${spec.table} SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
    .bind(now, id)
    .run();
  return result.meta.changes > 0;
}

/**
 * BR-5: chat messages and activities are never authored by the retired built-in Admin identity.
 * People with the admin role author their own changes (ADR-0005).
 */
export async function assertNotAdminAuthor(db: Db, userId: string, what: string): Promise<void> {
  const user = await db
    .prepare('SELECT role, is_builtin FROM users WHERE id = ?')
    .bind(userId)
    .first<{ role: string; is_builtin: number }>();
  if (user?.role === 'admin' && user.is_builtin === 1) throw new AdminAuthorError(what);
}
