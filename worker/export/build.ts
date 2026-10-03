/**
 * The export (T-018 Step 2, FR-ADM-04, docs/03-data-model.md section 6): `fish-database.json` with
 * full line documents, the Line List "All" view as `lines.csv`, and one CSV per entity. Every table
 * is read once (no per-line queries: the free plan allows few subrequests) and grouped in memory.
 * Deleted rows are included with their `deleted_at` so nothing hidden is lost from a backup. Columns
 * come from the tables themselves, in table order, so the files are deterministic.
 */
import pkg from '../../package.json';
import type { Db } from '../db/db';
import { listEnumerations } from '../db/queries/enumerations';
import { getSetting } from '../db/queries/settings';
import { listUsers, withoutSecrets } from '../db/queries/users';
import { buildLineListCsv } from '../lib/lineList';
import { csvFile } from './csv';
import { exportSchema, type ExportDocument } from './schema';
import { createZip } from './zip';

type Row = Record<string, unknown>;

async function table(db: Db, name: string, orderBy: string): Promise<Row[]> {
  // `name` and `orderBy` are literals from this file, never user input.
  return (await db.prepare(`SELECT * FROM ${name} ORDER BY ${orderBy}`).all<Row>()).results;
}

function group(rows: readonly Row[], key: string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const row of rows) {
    const id = String(row[key]);
    map.set(id, [...(map.get(id) ?? []), row]);
  }
  return map;
}

function headersOf(rows: readonly Row[], fallback: readonly string[]): string[] {
  return rows[0] === undefined ? [...fallback] : Object.keys(rows[0]);
}

export interface ExportFiles {
  json: ExportDocument;
  csvs: Record<string, string>;
}

export async function buildExportFiles(
  db: Db,
  now: Date,
  linesCsv: (db: Db) => Promise<string>,
): Promise<ExportFiles> {
  const [
    lines,
    phenotypes,
    attributes,
    protocols,
    genotyping,
    cryo,
    cryoUses,
    references,
    attachments,
    messagesRows,
    versions,
    activityRows,
    users,
    enumerations,
    threshold,
    annealing,
    cycles,
  ] = await Promise.all([
    table(db, 'lines', 'name COLLATE NOCASE, id'),
    table(db, 'line_phenotypes', 'line_id, sort_order, id'),
    table(db, 'line_attributes', 'line_id, sort_order, id'),
    table(db, 'id_protocols', 'line_id, sort_order, created_at, id'),
    table(db, 'genotyping_records', 'line_id, generation_no, record_date, created_at, id'),
    table(db, 'cryo_records', 'line_id, created_at, id'),
    table(db, 'cryo_vial_uses', 'line_id, used_at, created_at, id'),
    table(db, 'line_references', 'line_id, sort_order, created_at, id'),
    table(db, 'attachments', 'owner_type, owner_id, created_at, id'),
    table(db, 'chat_messages', 'created_at, id'),
    table(db, 'line_versions', 'line_id, version_no'),
    table(db, 'activities', 'created_at, id'),
    listUsers(db, { includeInactive: true }).then((rows) => rows.map(withoutSecrets)),
    Promise.all(
      (
        ['id_method_type', 'fluorophore', 'cryo_place', 'request_type', 'attribute_key'] as const
      ).map((kind) => listEnumerations(db, kind, { includeInactive: true })),
    ),
    getSetting(db, 'upcoming_breeding_months'),
    getSetting(db, 'default_annealing_c'),
    getSetting(db, 'default_cycles'),
  ]);

  const byLine = {
    phenotypes: group(phenotypes, 'line_id'),
    attributes: group(attributes, 'line_id'),
    protocols: group(protocols, 'line_id'),
    genotyping: group(genotyping, 'line_id'),
    cryo: group(cryo, 'line_id'),
    cryoUses: group(cryoUses, 'line_id'),
    references: group(references, 'line_id'),
  };
  // Attachments belong to a protocol, a genotyping record, a reference or the line itself.
  const ownerLine = new Map<string, string>();
  for (const row of protocols) ownerLine.set(String(row['id']), String(row['line_id']));
  for (const row of genotyping) ownerLine.set(String(row['id']), String(row['line_id']));
  for (const row of references) ownerLine.set(String(row['id']), String(row['line_id']));
  const attachmentsByLine = new Map<string, Row[]>();
  for (const row of attachments) {
    const lineId = ownerLine.get(String(row['owner_id'])) ?? String(row['owner_id']);
    attachmentsByLine.set(lineId, [...(attachmentsByLine.get(lineId) ?? []), row]);
  }

  const json: ExportDocument = {
    exported_at: now.toISOString(),
    app_version: pkg.version,
    lines: lines.map((line) => {
      const id = String(line['id']);
      return {
        line,
        phenotypes: byLine.phenotypes.get(id) ?? [],
        attributes: byLine.attributes.get(id) ?? [],
        protocols: byLine.protocols.get(id) ?? [],
        genotypingRecords: byLine.genotyping.get(id) ?? [],
        cryoRecords: byLine.cryo.get(id) ?? [],
        cryoVialUses: byLine.cryoUses.get(id) ?? [],
        references: byLine.references.get(id) ?? [],
        attachments: attachmentsByLine.get(id) ?? [],
      };
    }),
    users: users,
    enumerations: enumerations.flat() as unknown as Row[],
    lineVersions: versions,
    activities: activityRows,
    chatMessages: messagesRows,
    settings: {
      upcoming_breeding_months: threshold,
      default_annealing_c: annealing,
      default_cycles: cycles,
    },
  };

  // id_protocols.csv: the JSON `fields` flattened to `field:<key>` columns (lists/items stay JSON text).
  const fieldKeys = [
    ...new Set(protocols.flatMap((row) => Object.keys(JSON.parse(String(row['fields'])) as Row))),
  ].sort();
  const protocolHeaders = headersOf(protocols, ['id']).filter((h) => h !== 'fields');
  const protocolsCsv = csvFile(
    [...protocolHeaders, ...fieldKeys.map((key) => `field:${key}`)],
    protocols.map((row) => {
      const fields = JSON.parse(String(row['fields'])) as Row;
      return [
        ...protocolHeaders.map((h) => row[h]),
        ...fieldKeys.map((key) => {
          const value = fields[key];
          return value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
        }),
      ];
    }),
  );
  const plain = (rows: readonly Row[], fallback: string[], drop: string[] = []) => {
    const headers = headersOf(rows, fallback).filter((h) => !drop.includes(h));
    return csvFile(
      headers,
      rows.map((row) => headers.map((h) => row[h])),
    );
  };

  return {
    json,
    csvs: {
      'lines.csv': await linesCsv(db),
      'id_protocols.csv': protocolsCsv,
      'genotyping_records.csv': plain(genotyping, ['id']),
      'cryo_records.csv': plain(cryo, ['id']),
      'cryo_vial_uses.csv': plain(cryoUses, ['id']),
      'line_references.csv': plain(references, ['id']),
      'attachments.csv': plain(attachments, ['id']),
      'chat_messages.csv': plain(messagesRows, ['id']),
      'line_versions.csv': plain(versions, ['id'], ['snapshot']),
      'users.csv': plain(users, ['id']),
    },
  };
}

/** Day in the lab's time zone, for the file name. */
function labDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

export async function buildExportZip(
  db: Db,
  now: Date,
  linesCsv: (db: Db) => Promise<string>,
): Promise<{ bytes: Uint8Array; fileName: string }> {
  const { json, csvs } = await buildExportFiles(db, now, linesCsv);
  exportSchema.parse(json); // a file we cannot read back is worse than no file
  const entries = [
    ...Object.entries(csvs).map(([name, data]) => ({ name, data })),
    { name: 'fish-database.json', data: `${JSON.stringify(json, null, 2)}\n` },
  ];
  return { bytes: createZip(entries, now), fileName: `fish-database-export_${labDay(now)}.zip` };
}

/** The Line List "All" view as CSV (same builder as `GET /api/lines.csv`). */
export { buildLineListCsv };
