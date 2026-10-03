/**
 * `createLine`: the one path that creates a line (T-011, FR-NEW-03, NFR-09). The counterpart of
 * `withLineWrite` for version 1: one D1 batch { line, phenotypes, attributes, protocols, point the
 * line at its first protocol, cryo record, references, `line_versions` v1, `activities` created }.
 *
 * Write order is the one docs/03-data-model.md section 7 requires: the line is inserted with
 * `current_protocol_id = NULL`, the protocols follow, and an UPDATE then sets the pointer — hosted
 * D1 ignores the column's deferred foreign key, so inserting the pointer up front works locally
 * and fails there.
 *
 * Uniqueness (BR-8) is checked first for a clear message (409 NAME_TAKEN with the existing line's
 * id) and enforced again by the unique index: two people saving the same name at once get the same
 * 409 instead of a 500.
 */
import { cryoRangeCount } from '../../domain/cryo';
import { newLineMessages, type NewLineInput } from '../../domain/newLine';
import type { ResolvedAuthor } from '../../domain/types';
import { summarize } from '../../domain/versioning';
import type { Db, DbStatement } from '../db/db';
import { insertActivityStatement } from '../db/queries/activities';
import { insertCryoRecordStatement } from '../db/queries/cryoRecords';
import { insertIdProtocolStatement } from '../db/queries/idProtocols';
import { insertLineAttributeStatement } from '../db/queries/lineAttributes';
import { insertLinePhenotypeStatement } from '../db/queries/linePhenotypes';
import { insertLineReferenceStatement } from '../db/queries/lineReferences';
import { getLineByName, insertLineStatement } from '../db/queries/lines';
import { insertLineVersionStatement } from '../db/queries/lineVersions';
import { newId, nowIso } from '../db/ids';
import type { IdProtocolRow } from '../db/types';
import { assertNoUsedIds, savePlaceStatements } from './cryoWrite';
import { listUsedCryoIds } from '../db/queries/cryoVialUses';
import { ApiError } from './errors';
import { snapshotOf, type LineDocument } from './lineWrite';

export interface CreateLineInput {
  input: NewLineInput;
  author: ResolvedAuthor;
  /** The lab's calendar date, for `breeding_started_at` when the line starts as Breeding. */
  today: string;
  /** Injectable clock for tests. */
  now?: string;
}

export interface CreateLineResult {
  document: LineDocument;
  summary: string;
}

/** 409 NAME_TAKEN naming the line that already has the name (BR-8). */
export function nameTakenError(existing: { id: string; name: string }): ApiError {
  return new ApiError(
    409,
    'NAME_TAKEN',
    newLineMessages.nameTaken(existing.name),
    'Open the existing line, or change this name.',
    { existingId: existing.id, existingName: existing.name },
  );
}

/** The rows a new line is made of, before anything is written (also the snapshot of version 1). */
function buildDocument(params: CreateLineInput, lineId: string, now: string): LineDocument {
  const { input, author, today } = params;
  const protocols: IdProtocolRow[] = input.protocols.map((protocol, index) => ({
    id: newId(),
    line_id: lineId,
    protocol_type: protocol.type,
    label: protocol.label,
    fields: JSON.stringify(protocol.fields),
    notes: protocol.notes,
    sort_order: index,
    // The first protocol is the line's current method (FR-NEW-01).
    is_current: index === 0 ? 1 : 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
  }));
  return {
    line: {
      id: lineId,
      name: input.name,
      gene: input.gene,
      status: input.status,
      dob: input.dob,
      generation_no: 1,
      ided_number: input.idedNumber,
      last_id_date: null,
      breeding_started_at: input.status === 'Breeding' ? today : null,
      closed_at: null,
      closed_reason: null,
      notes: input.notes,
      current_protocol_id: protocols[0]?.id ?? null,
      legacy_no: null,
      legacy_check: null,
      version: 1,
      created_at: now,
      created_by: author.authorId,
      updated_at: now,
      updated_by: author.authorId,
    },
    phenotypes: input.phenotypes.map((description, index) => ({
      id: newId(),
      line_id: lineId,
      description,
      sort_order: index,
      deleted_at: null,
    })),
    attributes: input.attributes.map((attribute, index) => ({
      id: newId(),
      line_id: lineId,
      key: attribute.key,
      value: attribute.value,
      sort_order: index,
      deleted_at: null,
    })),
    protocols,
    cryoRecords:
      input.cryo === null
        ? []
        : [
            {
              id: newId(),
              line_id: lineId,
              cryo_date: input.cryo.cryoDate,
              place: input.cryo.place,
              box_name: input.cryo.boxName,
              cryo_id_start: input.cryo.cryoIdStart,
              cryo_id_end: input.cryo.cryoIdEnd,
              count:
                input.cryo.count ?? cryoRangeCount(input.cryo.cryoIdStart, input.cryo.cryoIdEnd),
              details_unknown: input.cryo.detailsUnknown ? 1 : 0,
              notes: input.cryo.notes,
              deleted_at: null,
              created_at: now,
              created_by: author.authorId,
            },
          ],
    references: input.references.map((reference, index) => ({
      id: newId(),
      line_id: lineId,
      title: reference.title,
      url: reference.url,
      attachment_id: null,
      note: null,
      sort_order: index,
      deleted_at: null,
      created_at: now,
      created_by: author.authorId,
    })),
  };
}

export async function createLine(db: Db, params: CreateLineInput): Promise<CreateLineResult> {
  const existing = await getLineByName(db, params.input.name);
  if (existing !== null) throw nameTakenError(existing);

  if (params.input.cryo !== null)
    assertNoUsedIds(
      params.input.cryo.cryoIdStart,
      params.input.cryo.cryoIdEnd,
      await listUsedCryoIds(db),
      new Set(),
      'cryo.cryoIdStart',
    );
  const now = params.now ?? nowIso();
  const lineId = newId();
  const document = buildDocument(params, lineId, now);
  const { line } = document;
  const summary = summarize('created', [], { lineName: line.name });
  const versionId = newId();
  const viaAdmin = params.author.viaAdmin ? 1 : 0;

  const statements: DbStatement[] = [
    // Step 1 of the write order: no protocol pointer yet.
    insertLineStatement(db, { ...line, current_protocol_id: null }),
    ...document.phenotypes.map((row) => insertLinePhenotypeStatement(db, row)),
    ...document.attributes.map((row) => insertLineAttributeStatement(db, row)),
    ...document.protocols.map((row) => insertIdProtocolStatement(db, row)),
  ];
  if (line.current_protocol_id !== null)
    statements.push(
      db
        .prepare('UPDATE lines SET current_protocol_id = ? WHERE id = ?')
        .bind(line.current_protocol_id, lineId),
    );
  statements.push(
    // A place typed under "Other…" joins the place list for next time.
    ...(await savePlaceStatements(db, params.input.cryo?.place ?? null)),
    ...document.cryoRecords.map((row) => insertCryoRecordStatement(db, row)),
    ...document.references.map((row) => insertLineReferenceStatement(db, row)),
    insertLineVersionStatement(db, {
      id: versionId,
      line_id: lineId,
      version_no: 1,
      snapshot: JSON.stringify(snapshotOf(document)),
      diff: null,
      change_type: 'created',
      summary,
      note: null,
      created_at: now,
      created_by: params.author.authorId,
      via_admin: viaAdmin,
    }),
    await insertActivityStatement(db, {
      id: newId(),
      line_id: lineId,
      user_id: params.author.authorId,
      via_admin: viaAdmin,
      type: 'created',
      summary,
      ref_type: 'line_version',
      ref_id: versionId,
      created_at: now,
    }),
  );

  try {
    await db.batch(statements);
  } catch (error) {
    // Someone saved the same name between the check above and the batch: the unique index refused it.
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      const winner = await getLineByName(db, line.name);
      if (winner !== null) throw nameTakenError(winner);
    }
    throw error;
  }
  return { document, summary };
}
