/**
 * Loads a fixture file (tests/fixtures/lines.small.json) into a database through the query helpers.
 * Used by tests and by `npm run db:seed:local`; never by the application.
 *
 * Each fixture line becomes: the line + its phenotypes, attributes, protocols, genotyping records,
 * cryo records and references, plus what an import would leave behind: version 1 (`imported`) and
 * one `imported` activity. The first protocol is the line's current protocol. Everything for one
 * line is written in a single batch (one transaction). Child ids are derived from the line id.
 *
 * Write order is the one every write path must use (docs/03-data-model.md section 7): the line with
 * `current_protocol_id = NULL`, then its protocols, then an UPDATE pointing the line at the first
 * one. Hosted D1 does not honour the column's DEFERRABLE declaration, so the shortcut of inserting
 * the line with the protocol id already set works locally but fails on a real D1 database.
 */
import { z } from 'zod';
import type { Db } from './db';
import { insertActivityStatement } from './queries/activities';
import { insertCryoRecordStatement } from './queries/cryoRecords';
import { insertGenotypingRecordStatement } from './queries/genotypingRecords';
import { insertIdProtocolStatement } from './queries/idProtocols';
import { insertLineAttributeStatement } from './queries/lineAttributes';
import { insertLinePhenotypeStatement } from './queries/linePhenotypes';
import { insertLineReferenceStatement } from './queries/lineReferences';
import { insertLineStatement } from './queries/lines';
import { insertLineVersionStatement } from './queries/lineVersions';

const nullableText = z.string().nullable();

const fixtureLine = z.strictObject({
  id: z.string(),
  name: z.string(),
  gene: nullableText,
  status: z.enum(['Current', 'Breeding', 'Closed']),
  dob: nullableText,
  ided_number: z.number().int(),
  last_id_date: nullableText,
  notes: nullableText,
  legacy_no: z.number().int().nullable(),
  legacy_check: z.number().int().nullable(),
  updated_at: z.string(),
  phenotypes: z.array(z.string()),
  attributes: z.array(z.strictObject({ key: z.string(), value: nullableText })),
  protocols: z.array(
    z.strictObject({
      protocol_type: z.enum(['none', 'tails', 'pcr', 'pcr_sequence', 'fluorescence', 'custom']),
      label: z.string(),
      fields: z.record(z.string(), z.unknown()),
      notes: nullableText,
    }),
  ),
  genotyping_records: z.array(
    z.strictObject({
      record_date: z.string(),
      positive_count: z.number().int(),
      notes: nullableText,
    }),
  ),
  cryo_records: z.array(
    z.strictObject({
      cryo_date: nullableText,
      place: nullableText,
      box_name: nullableText,
      cryo_id_start: nullableText,
      cryo_id_end: nullableText,
      count: z.number().int().nullable(),
      details_unknown: z.number().int(),
      notes: nullableText,
    }),
  ),
  references: z.array(z.strictObject({ title: z.string() })),
});

const fixtureFile = z.strictObject({ description: z.string(), lines: z.array(fixtureLine) });

export type FixtureLine = z.infer<typeof fixtureLine>;

/** Validates parsed JSON; throws a readable error when the fixture does not match. */
export function parseFixture(json: unknown): FixtureLine[] {
  return fixtureFile.parse(json).lines;
}

/** Inserts every fixture line, attributed to the first active test account. */
export async function loadFixture(db: Db, json: unknown): Promise<number> {
  const lines = parseFixture(json);
  const actor = await db
    .prepare(
      `SELECT id FROM users WHERE is_active = 1 AND is_builtin = 0
       AND role IN ('admin', 'member')
       ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at, id LIMIT 1`,
    )
    .first<{ id: string }>();
  if (actor === null)
    throw new Error('No active test account found: seed users before loading fixtures.');
  for (const line of lines) await insertFixtureLine(db, line, actor.id);
  return lines.length;
}

async function insertFixtureLine(db: Db, line: FixtureLine, actor: string): Promise<void> {
  const at = line.updated_at;
  const firstProtocolId = line.protocols.length > 0 ? `${line.id}-protocol-1` : null;
  const statements = [
    insertLineStatement(db, {
      id: line.id,
      name: line.name,
      gene: line.gene,
      status: line.status,
      dob: line.dob,
      generation_no: 1,
      ided_number: line.ided_number,
      last_id_date: line.last_id_date,
      breeding_started_at: null,
      closed_at: null,
      closed_reason: null,
      notes: line.notes,
      current_protocol_id: null,
      legacy_no: line.legacy_no,
      legacy_check: line.legacy_check,
      version: 1,
      created_at: at,
      created_by: actor,
      updated_at: at,
      updated_by: actor,
    }),
  ];
  line.phenotypes.forEach((description, index) => {
    statements.push(
      insertLinePhenotypeStatement(db, {
        id: `${line.id}-phenotype-${String(index + 1)}`,
        line_id: line.id,
        description,
        sort_order: index,
        deleted_at: null,
      }),
    );
  });
  line.attributes.forEach((attribute, index) => {
    statements.push(
      insertLineAttributeStatement(db, {
        id: `${line.id}-attribute-${String(index + 1)}`,
        line_id: line.id,
        key: attribute.key,
        value: attribute.value,
        sort_order: index,
        deleted_at: null,
      }),
    );
  });
  line.protocols.forEach((protocol, index) => {
    statements.push(
      insertIdProtocolStatement(db, {
        id: `${line.id}-protocol-${String(index + 1)}`,
        line_id: line.id,
        protocol_type: protocol.protocol_type,
        label: protocol.label,
        fields: JSON.stringify(protocol.fields),
        notes: protocol.notes,
        sort_order: index,
        is_current: index === 0 ? 1 : 0,
        deleted_at: null,
        created_at: at,
        updated_at: at,
      }),
    );
  });
  if (firstProtocolId !== null) {
    statements.push(
      db
        .prepare('UPDATE lines SET current_protocol_id = ? WHERE id = ?')
        .bind(firstProtocolId, line.id),
    );
  }
  line.genotyping_records.forEach((record, index) => {
    statements.push(
      insertGenotypingRecordStatement(db, {
        id: `${line.id}-genotyping-${String(index + 1)}`,
        line_id: line.id,
        generation_no: 1,
        record_date: record.record_date,
        protocol_id: firstProtocolId,
        positive_count: record.positive_count,
        screened_count: null,
        is_new_generation: 0,
        new_dob: null,
        notes: record.notes,
        created_at: at,
        created_by: actor,
      }),
    );
  });
  line.cryo_records.forEach((record, index) => {
    statements.push(
      insertCryoRecordStatement(db, {
        id: `${line.id}-cryo-${String(index + 1)}`,
        line_id: line.id,
        ...record,
        deleted_at: null,
        created_at: at,
        created_by: actor,
      }),
    );
  });
  line.references.forEach((reference, index) => {
    statements.push(
      insertLineReferenceStatement(db, {
        id: `${line.id}-reference-${String(index + 1)}`,
        line_id: line.id,
        title: reference.title,
        url: null,
        attachment_id: null,
        note: null,
        sort_order: index,
        deleted_at: null,
        created_at: at,
        created_by: actor,
      }),
    );
  });
  statements.push(
    insertLineVersionStatement(db, {
      id: `${line.id}-version-1`,
      line_id: line.id,
      version_no: 1,
      snapshot: JSON.stringify(line),
      diff: null,
      change_type: 'imported',
      summary: 'Imported from Mastersheet Ver. 1.1',
      note: null,
      created_at: at,
      created_by: actor,
      via_admin: 0,
    }),
    await insertActivityStatement(db, {
      id: `${line.id}-activity-1`,
      line_id: line.id,
      user_id: actor,
      via_admin: 0,
      type: 'imported',
      summary: 'Imported from Mastersheet Ver. 1.1',
      ref_type: null,
      ref_id: null,
      created_at: at,
    }),
  );
  await db.batch(statements);
}
