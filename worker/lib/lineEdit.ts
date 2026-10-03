/**
 * Applying descriptive content to a line (T-012): the mutation shared by `PATCH /api/lines/:id`
 * and the Admin restore. It returns a `LineWriteChange` for `withLineWrite`, which owns the
 * version, the diff and the activity. Nothing is ever deleted: removed phenotypes and attributes
 * get `deleted_at` (BR-7), and a restore brings back the same rows' text as new live rows.
 */
import type { DescriptiveContent } from '../../domain/lineEdit';
import type { Db, DbStatement } from '../db/db';
import { newId } from '../db/ids';
import { insertLineAttributeStatement } from '../db/queries/lineAttributes';
import { insertLinePhenotypeStatement } from '../db/queries/linePhenotypes';
import { getLineByName } from '../db/queries/lines';
import type { LineAttributeRow, LinePhenotypeRow } from '../db/types';
import { nameTakenError } from './lineCreate';
import type { LineChanges, LineDocument, LineWriteChange } from './lineWrite';

/** Thrown from a mutation when nothing would change, so no empty version is written. */
export class NoChangeError extends Error {
  constructor() {
    super('No changes.');
    this.name = 'NoChangeError';
  }
}

export function descriptiveOf(document: LineDocument): DescriptiveContent {
  return {
    name: document.line.name,
    gene: document.line.gene,
    notes: document.line.notes,
    dob: document.line.dob,
    phenotypes: document.phenotypes.map((row) => row.description),
    attributes: document.attributes.map((row) => ({ key: row.key, value: row.value })),
  };
}

function sameList<T>(left: readonly T[], right: readonly T[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** One differing field between the current content and a version's content (the restore preview). */
export interface DescriptiveChange {
  path: keyof DescriptiveContent;
  before: unknown;
  after: unknown;
}

/** What a restore would change, in the same `{ path, before, after }` shape as a history diff. */
export function previewDescriptive(
  current: DescriptiveContent,
  target: DescriptiveContent,
): DescriptiveChange[] {
  const paths = ['name', 'gene', 'notes', 'dob', 'phenotypes', 'attributes'] as const;
  return paths
    .filter((path) => !sameList([current[path]], [target[path]]))
    .map((path) => ({ path, before: current[path], after: target[path] }));
}

/** 409 NAME_TAKEN when another line already has this name (BR-8); the line itself may keep it. */
export async function assertNameFree(db: Db, lineId: string, name: string): Promise<void> {
  const existing = await getLineByName(db, name);
  if (existing !== null && existing.id !== lineId) throw nameTakenError(existing);
}

/**
 * Rows keep their identity when the text is unchanged (so history stays readable); the rest are
 * hidden or added. `sort_order` follows the new list.
 */
function planPhenotypes(
  db: Db,
  lineId: string,
  before: readonly LinePhenotypeRow[],
  target: readonly string[],
  now: string,
): { rows: LinePhenotypeRow[]; statements: DbStatement[] } {
  const statements: DbStatement[] = [];
  const unused = [...before];
  const rows: LinePhenotypeRow[] = target.map((description, index) => {
    const at = unused.findIndex((row) => row.description === description);
    const kept = at < 0 ? undefined : unused.splice(at, 1)[0];
    if (kept !== undefined) {
      if (kept.sort_order !== index)
        statements.push(
          db.prepare('UPDATE line_phenotypes SET sort_order = ? WHERE id = ?').bind(index, kept.id),
        );
      return { ...kept, sort_order: index };
    }
    const row: LinePhenotypeRow = {
      id: newId(),
      line_id: lineId,
      description,
      sort_order: index,
      deleted_at: null,
    };
    statements.push(insertLinePhenotypeStatement(db, row));
    return row;
  });
  // Hide first so a re-added text never meets its own hidden twin in a unique index.
  const hide = unused.map((row) =>
    db.prepare('UPDATE line_phenotypes SET deleted_at = ? WHERE id = ?').bind(now, row.id),
  );
  return { rows, statements: [...hide, ...statements] };
}

function planAttributes(
  db: Db,
  lineId: string,
  before: readonly LineAttributeRow[],
  target: readonly { key: string; value: string | null }[],
  now: string,
): { rows: LineAttributeRow[]; statements: DbStatement[] } {
  const statements: DbStatement[] = [];
  const unused = [...before];
  const rows: LineAttributeRow[] = target.map((attribute, index) => {
    const at = unused.findIndex((row) => row.key === attribute.key);
    const kept = at < 0 ? undefined : unused.splice(at, 1)[0];
    if (kept !== undefined) {
      if (kept.value !== attribute.value || kept.sort_order !== index)
        statements.push(
          db
            .prepare('UPDATE line_attributes SET value = ?, sort_order = ? WHERE id = ?')
            .bind(attribute.value, index, kept.id),
        );
      return { ...kept, value: attribute.value, sort_order: index };
    }
    const row: LineAttributeRow = {
      id: newId(),
      line_id: lineId,
      key: attribute.key,
      value: attribute.value,
      sort_order: index,
      deleted_at: null,
    };
    statements.push(insertLineAttributeStatement(db, row));
    return row;
  });
  const hide = unused.map((row) =>
    db.prepare('UPDATE line_attributes SET deleted_at = ? WHERE id = ?').bind(now, row.id),
  );
  return { rows, statements: [...hide, ...statements] };
}

/**
 * The change that makes `before` carry `target`'s descriptive content (only the keys present in
 * `target`). Throws `NoChangeError` when it already does.
 */
export async function applyDescriptive(
  db: Db,
  before: LineDocument,
  target: Partial<DescriptiveContent>,
  now: string,
): Promise<LineWriteChange> {
  const current = descriptiveOf(before);
  const line: LineChanges = {};
  if (target.name !== undefined && target.name !== current.name) {
    await assertNameFree(db, before.line.id, target.name);
    line.name = target.name;
  }
  if (target.gene !== undefined && target.gene !== current.gene) line.gene = target.gene;
  if (target.notes !== undefined && target.notes !== current.notes) line.notes = target.notes;
  if (target.dob !== undefined && target.dob !== current.dob) line.dob = target.dob;

  const statements: DbStatement[] = [];
  const children: LineWriteChange['children'] = {};
  if (target.phenotypes !== undefined && !sameList(target.phenotypes, current.phenotypes)) {
    const plan = planPhenotypes(db, before.line.id, before.phenotypes, target.phenotypes, now);
    statements.push(...plan.statements);
    children.phenotypes = plan.rows;
  }
  if (target.attributes !== undefined && !sameList(target.attributes, current.attributes)) {
    const plan = planAttributes(db, before.line.id, before.attributes, target.attributes, now);
    statements.push(...plan.statements);
    children.attributes = plan.rows;
  }
  if (Object.keys(line).length === 0 && statements.length === 0) throw new NoChangeError();
  return { line, statements, children };
}

/** A UNIQUE failure while a rename was in the batch means someone took the name in the meantime. */
export async function nameRaceError(
  db: Db,
  lineId: string,
  name: string,
  error: unknown,
): Promise<unknown> {
  if (error instanceof Error && /UNIQUE/i.test(error.message)) {
    const existing = await getLineByName(db, name);
    if (existing !== null && existing.id !== lineId) return nameTakenError(existing);
  }
  return error;
}
