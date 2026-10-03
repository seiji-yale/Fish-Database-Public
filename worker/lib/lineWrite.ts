/**
 * `withLineWrite`: the one path every change to a line goes through (BR-12, NFR-09,
 * docs/02-architecture.md 3.4):
 *
 *   load line -> compare `version` -> one D1 batch { insert line_versions, mutation statements,
 *   update lines (version + 1), insert activities } -> return the new document.
 *
 * Concurrency: the new `line_versions` row is the first statement of the batch and
 * `UNIQUE (line_id, version_no)` makes it the lock — if another write committed version N + 1 first,
 * the whole batch fails and rolls back, and the caller gets 409 VERSION_CONFLICT. The early version
 * check only gives the same answer sooner.
 *
 * Handlers never write `line_versions`/`activities` themselves; they describe the change.
 * A handler that creates a protocol and points the line at it must follow the write order in
 * docs/03-data-model.md section 7 (hosted D1 ignores the deferred foreign key).
 */
import type { ResolvedAuthor } from '../../domain/types';
import {
  buildSnapshot,
  diffSnapshots,
  summarize,
  type ChangeType,
  type SummaryContext,
} from '../../domain/versioning';
import type { Db, DbStatement } from '../db/db';
import { insertActivityStatement } from '../db/queries/activities';
import { listCryoRecordsByLine } from '../db/queries/cryoRecords';
import { listIdProtocolsByLine } from '../db/queries/idProtocols';
import { listLineAttributesByLine } from '../db/queries/lineAttributes';
import { listLinePhenotypesByLine } from '../db/queries/linePhenotypes';
import { listLineReferencesByLine } from '../db/queries/lineReferences';
import { getLineById, LINES } from '../db/queries/lines';
import { insertLineVersionStatement } from '../db/queries/lineVersions';
import { getUserById } from '../db/queries/users';
import { newId, nowIso } from '../db/ids';
import type {
  CryoRecordRow,
  IdProtocolRow,
  LineAttributeRow,
  LinePhenotypeRow,
  LineReferenceRow,
  LineRow,
} from '../db/types';
import { ApiError } from './errors';
import { messages } from './messages';

/** A line with its live (not soft-deleted) child rows: what a `line_versions.snapshot` holds. */
export interface LineDocument {
  line: LineRow;
  phenotypes: LinePhenotypeRow[];
  attributes: LineAttributeRow[];
  protocols: IdProtocolRow[];
  cryoRecords: CryoRecordRow[];
  references: LineReferenceRow[];
}

type Children = Omit<LineDocument, 'line'>;

/** Columns a handler may change on `lines`; the wrapper owns id, version and the audit columns. */
export type LineChanges = Partial<
  Omit<LineRow, 'id' | 'version' | 'created_at' | 'created_by' | 'updated_at' | 'updated_by'>
>;

export interface LineWriteChange {
  /** New values for columns of the `lines` row (may be empty, e.g. a protocol-only change). */
  line: LineChanges;
  /** Child-table writes (protocols, records, ...), run inside the same batch. */
  statements?: DbStatement[];
  /** The child lists after the change, for the snapshot and diff; omitted lists are unchanged. */
  children?: Partial<Children>;
  /** Values `summarize` cannot infer from the diff (e.g. the positive count of a record). */
  summaryContext?: SummaryContext;
}

export interface LineWriteInput {
  lineId: string;
  /** The `version` the edit form was opened with (BR-12). */
  expectedVersion: number;
  author: ResolvedAuthor;
  changeType: Exclude<ChangeType, 'imported' | 'created'>;
  /** The user's optional "Reason / note" (FR-LINE-02). */
  note?: string | null;
  mutate: (before: LineDocument) => LineWriteChange | Promise<LineWriteChange>;
  /** Injectable clock for tests. */
  now?: string;
}

export interface LineWriteResult {
  document: LineDocument;
  versionNo: number;
  summary: string;
}

const EDITABLE_COLUMNS: ReadonlySet<string> = new Set(
  LINES.columns.filter(
    (column) =>
      !['id', 'version', 'created_at', 'created_by', 'updated_at', 'updated_by'].includes(column),
  ),
);

export async function loadLineDocument(db: Db, lineId: string): Promise<LineDocument | null> {
  const line = await getLineById(db, lineId);
  if (line === null) return null;
  const [phenotypes, attributes, protocols, cryoRecords, references] = await Promise.all([
    listLinePhenotypesByLine(db, lineId),
    listLineAttributesByLine(db, lineId),
    listIdProtocolsByLine(db, lineId),
    listCryoRecordsByLine(db, lineId),
    listLineReferencesByLine(db, lineId),
  ]);
  return { line, phenotypes, attributes, protocols, cryoRecords, references };
}

/**
 * The JSON stored in `line_versions.snapshot`. The version number and the update stamps are left
 * out: they change on every write, are already columns of the version row, and would otherwise
 * appear in every diff.
 */
export function snapshotOf(document: LineDocument): Record<string, unknown> {
  const line: Partial<LineRow> = { ...document.line };
  delete line.version;
  delete line.updated_at;
  delete line.updated_by;
  return buildSnapshot({ ...document, line });
}

/** `YYYY-MM-DD HH:mm` in America/New_York, the display format for timestamps (AGENTS.md 4). */
export function displayTimestamp(iso: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((part) => [part.type, part.value]),
  );
  return `${String(parts.year)}-${String(parts.month)}-${String(parts.day)} ${String(parts.hour)}:${String(parts.minute)}`;
}

async function versionConflict(db: Db, line: LineRow): Promise<ApiError> {
  const user = await getUserById(db, line.updated_by);
  const changedBy = user?.name ?? 'someone';
  return new ApiError(
    409,
    'VERSION_CONFLICT',
    messages.versionConflict(changedBy, displayTimestamp(line.updated_at)),
    undefined,
    { changedBy, changedAt: line.updated_at, currentVersion: line.version },
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE/i.test(error.message);
}

export async function withLineWrite(db: Db, input: LineWriteInput): Promise<LineWriteResult> {
  const before = await loadLineDocument(db, input.lineId);
  if (before === null) throw new ApiError(404, 'LINE_NOT_FOUND', messages.lineNotFound);
  if (before.line.version !== input.expectedVersion) throw await versionConflict(db, before.line);

  const change = await input.mutate(before);
  for (const column of Object.keys(change.line)) {
    if (!EDITABLE_COLUMNS.has(column))
      throw new Error(`withLineWrite: "${column}" is not editable`);
  }

  const now = input.now ?? nowIso();
  const versionNo = before.line.version + 1;
  const afterLine: LineRow = {
    ...before.line,
    ...change.line,
    version: versionNo,
    updated_at: now,
    updated_by: input.author.authorId,
  };
  const after: LineDocument = { ...before, ...change.children, line: afterLine };
  const diff = diffSnapshots(snapshotOf(before), snapshotOf(after));
  // History wording names fields as people know them: `gene`, not `line.gene`.
  const readableDiff = diff.map((entry) => ({ ...entry, path: entry.path.replace(/^line\./, '') }));
  const summary = summarize(input.changeType, readableDiff, {
    lineName: afterLine.name,
    idedNumber: afterLine.ided_number,
    ...change.summaryContext,
  });

  const lineColumns = Object.keys(change.line);
  const assignments = [...lineColumns, 'version', 'updated_at', 'updated_by']
    .map((column) => `${column} = ?`)
    .join(', ');
  const lineValues = lineColumns.map((column) => change.line[column as keyof LineChanges] ?? null);

  const versionId = newId();
  const statements: DbStatement[] = [
    insertLineVersionStatement(db, {
      id: versionId,
      line_id: input.lineId,
      version_no: versionNo,
      snapshot: JSON.stringify(snapshotOf(after)),
      diff: JSON.stringify(diff),
      change_type: input.changeType,
      summary,
      note: input.note ?? null,
      created_at: now,
      created_by: input.author.authorId,
      via_admin: input.author.viaAdmin ? 1 : 0,
    }),
    ...(change.statements ?? []),
    db
      .prepare(`UPDATE lines SET ${assignments} WHERE id = ? AND version = ?`)
      .bind(
        ...lineValues,
        versionNo,
        now,
        input.author.authorId,
        input.lineId,
        before.line.version,
      ),
    await insertActivityStatement(db, {
      id: newId(),
      line_id: input.lineId,
      user_id: input.author.authorId,
      via_admin: input.author.viaAdmin ? 1 : 0,
      type: input.changeType,
      summary,
      ref_type: 'line_version',
      ref_id: versionId,
      created_at: now,
    }),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    // A UNIQUE failure is a version conflict only if the line really moved on; otherwise it came
    // from one of the handler's own statements and is reported as-is.
    if (!isUniqueViolation(error)) throw error;
    const current = await getLineById(db, input.lineId);
    if (current === null || current.version === before.line.version) throw error;
    throw await versionConflict(db, current);
  }
  return { document: after, versionNo, summary };
}
