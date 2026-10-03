/**
 * The small slice of the D1 API the query layer uses. `D1Database` satisfies it (checked at compile
 * time in worker/dbCompat.ts), and so does the in-memory SQLite stand-in used by the tests
 * (worker/db/testing/sqliteD1.ts). Query helpers depend on this interface, never on `D1Database`.
 */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  // The row type parameters mirror the D1 API (the caller states what the SQL returns).
  first<T>(): Promise<T | null>;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface Db {
  prepare(sql: string): DbStatement;
  /** All statements run in one transaction; a failure rolls every one back. */
  batch(statements: DbStatement[]): Promise<unknown[]>;
}
