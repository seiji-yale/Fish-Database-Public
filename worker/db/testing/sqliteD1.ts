/**
 * A minimal in-memory stand-in for the D1 binding, built on Node's `node:sqlite`.
 * Tests only: it lets the query layer run against real SQLite (foreign keys on, like D1)
 * without starting workerd. It implements the parts of the D1 API the query helpers use:
 * prepare().bind().first()/all()/run(), and batch() as one transaction.
 * The migrations are additionally applied to a real local D1 with `npm run db:migrate:local`.
 */
import type { DatabaseSync } from 'node:sqlite';
import type { Db, DbStatement } from '../db';

type Param = string | number | null;

class SqliteStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: Param[] = [],
  ) {}

  bind(...values: unknown[]): SqliteStatement {
    for (const value of values) {
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
        throw new TypeError(`Unsupported bind value: ${typeof value}`);
      }
    }
    return new SqliteStatement(this.sqlite, this.sql, values as Param[]);
  }

  // D1 reports SQL errors as rejected promises, so every method defers its work into a promise.
  first<T>(): Promise<T | null> {
    return Promise.resolve().then(() => {
      const row = this.sqlite.prepare(this.sql).get(...this.params);
      return (row as T | undefined) ?? null;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors the D1 API
  all<T>(): Promise<{ results: T[]; success: true }> {
    return Promise.resolve().then(() => {
      const rows = this.sqlite.prepare(this.sql).all(...this.params);
      return { results: rows as T[], success: true as const };
    });
  }

  run(): Promise<{ success: true; meta: { changes: number; last_row_id: number } }> {
    return Promise.resolve().then(() => {
      const info = this.sqlite.prepare(this.sql).run(...this.params);
      return {
        success: true as const,
        meta: { changes: Number(info.changes), last_row_id: Number(info.lastInsertRowid) },
      };
    });
  }
}

export class SqliteD1 implements Db {
  constructor(readonly sqlite: DatabaseSync) {}

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.sqlite, sql);
  }

  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Like D1: all statements run in one transaction; any failure rolls everything back. Batches
   * from concurrent callers run one after another, as they do on D1 (one SQLite connection
   * cannot hold two transactions at once).
   */
  batch(statements: DbStatement[]): Promise<unknown[]> {
    const run = this.queue.then(() => this.runBatch(statements));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runBatch(statements: DbStatement[]): Promise<unknown[]> {
    this.sqlite.exec('BEGIN');
    try {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }
}
