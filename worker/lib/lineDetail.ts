import { currentProtocols } from '../../domain/currentProtocols';
/**
 * Pure assembly for the Line Detail page (T-009, FR-LINE-01, FR-ID-01/02, FR-CRYO-01/02, FR-REF-01,
 * FR-HIST-01/04): turns the raw rows the route fetches (one batch of queries, see
 * `worker/routes/lineDetail.ts`) into one document. `ageInMonths` (BR-3), `isCryopreserved` (BR-6)
 * and `lastUpdate` (BR-4) are the domain functions this module must not re-derive by hand.
 */
import { ageInMonths } from '../../domain/breeding';
import { isCryopreserved } from '../../domain/cryo';
import { lastUpdate } from '../../domain/lastUpdate';
import type {
  AttachmentRow,
  ChatMessageRow,
  CryoRecordRow,
  CryoVialUseRow,
  GenotypingRecordRow,
  IdProtocolRow,
  LineAttributeRow,
  LinePhenotypeRow,
  LineReferenceRow,
  LineRow,
  LineStatus,
  LineVersionRow,
  ProtocolType,
} from '../db/types';

export interface LineDetailAttachment {
  id: string;
  kind: string;
  fileName: string | null;
  mimeType: string | null;
  caption: string | null;
  isLatest: boolean;
  createdAt: string;
}

export interface LineDetailProtocol {
  id: string;
  protocolType: ProtocolType;
  label: string;
  fields: Record<string, unknown>;
  notes: string | null;
  isCurrent: boolean;
  attachments: LineDetailAttachment[];
}

export interface LineDetailCryoRecord {
  id: string;
  cryoDate: string | null;
  place: string | null;
  boxName: string | null;
  cryoIdStart: string | null;
  cryoIdEnd: string | null;
  /** Vials left in this record (drops when vials are used). */
  count: number | null;
  /** Vials already taken out of this record. */
  usedCount: number;
  detailsUnknown: boolean;
  notes: string | null;
}

/** A vial (or several, for a record without IDs) that was used (owner request 2026-09-30). */
export interface LineDetailCryoUse {
  id: string;
  cryoId: string | null;
  quantity: number;
  usedAt: string;
  note: string | null;
  usedByName: string;
  /** Where it came from, e.g. `Demo freezer shelf`. */
  place: string | null;
}

export interface LineDetailReference {
  id: string;
  title: string;
  url: string | null;
  note: string | null;
  attachment: LineDetailAttachment | null;
}

export interface LineDetailGenotypingRecord {
  id: string;
  generationNo: number;
  recordDate: string;
  protocolId: string | null;
  protocolLabel: string | null;
  positiveCount: number;
  screenedCount: number | null;
  isNewGeneration: boolean;
  newDob: string | null;
  notes: string | null;
  attachments: LineDetailAttachment[];
}

export interface LineDetailGeneration {
  generationNo: number;
  /** The DOB that started this generation; null when it cannot be recovered (generation 1 of an
   * imported line — the transition predates any stored genotyping record). */
  dob: string | null;
  records: LineDetailGenotypingRecord[];
}

export interface LineDetailVersionDiff {
  path: string;
  before: unknown;
  after: unknown;
}

export interface LineDetailVersion {
  id: string;
  versionNo: number;
  changeType: string;
  summary: string;
  note: string | null;
  createdAt: string;
  createdByName: string;
  viaAdmin: boolean;
  diff: LineDetailVersionDiff[];
}

export interface LineDetailDocument {
  id: string;
  name: string;
  gene: string | null;
  status: LineStatus;
  dob: string | null;
  ageMonths: number | null;
  generationNo: number;
  idedNumber: number;
  lastIdDate: string | null;
  breedingStartedAt: string | null;
  closedAt: string | null;
  closedReason: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  createdByName: string;
  updatedAt: string;
  updatedByName: string;
  isCryopreserved: boolean;
  cryoStrawCount: number;
  phenotypes: { id: string; description: string }[];
  attributes: { id: string; key: string; value: string | null }[];
  protocols: LineDetailProtocol[];
  cryoRecords: LineDetailCryoRecord[];
  cryoUses: LineDetailCryoUse[];
  references: LineDetailReference[];
  generations: LineDetailGeneration[];
  versions: LineDetailVersion[];
}

export interface BuildLineDetailInput {
  line: LineRow;
  phenotypes: readonly LinePhenotypeRow[];
  attributes: readonly LineAttributeRow[];
  protocols: readonly IdProtocolRow[];
  cryoRecords: readonly CryoRecordRow[];
  /** Used vials of this line; omitted means none. */
  cryoUses?: readonly CryoVialUseRow[];
  /** Place of every cryo record of the line, including removed ones (a used-up record is removed). */
  cryoPlaces?: Readonly<Record<string, string | null>>;
  references: readonly LineReferenceRow[];
  genotypingRecords: readonly GenotypingRecordRow[];
  attachments: readonly AttachmentRow[];
  versions: readonly LineVersionRow[];
  /** Live chat messages for this line, for BR-4's Last Update (the line's own update, or a later
   * chat message, whichever is more recent). */
  chatMessages: readonly ChatMessageRow[];
  userNames: Readonly<Record<string, string>>;
  now?: string | Date;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const list = map.get(groupKey);
    if (list === undefined) map.set(groupKey, [row]);
    else list.push(row);
  }
  return map;
}

function userName(userNames: Readonly<Record<string, string>>, userId: string): string {
  return userNames[userId] ?? userId;
}

function toAttachment(row: AttachmentRow): LineDetailAttachment {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.file_name,
    mimeType: row.mime_type,
    caption: row.caption,
    isLatest: row.is_latest === 1,
    createdAt: row.created_at,
  };
}

export function buildLineDetail(input: BuildLineDetailInput): LineDetailDocument {
  const { line, userNames } = input;
  const attachmentsByOwner = groupBy(input.attachments, (row) => row.owner_id);
  const attachmentsById = new Map(input.attachments.map((row) => [row.id, row]));
  const protocolLabelById = new Map(input.protocols.map((row) => [row.id, row.label]));

  const currentIds = new Set(
    currentProtocols(line.current_protocol_id, input.protocols).map((row) => row.id),
  );
  const protocols: LineDetailProtocol[] = input.protocols.map((row) => ({
    id: row.id,
    protocolType: row.protocol_type,
    label: row.label,
    fields: JSON.parse(row.fields) as Record<string, unknown>,
    notes: row.notes,
    isCurrent: currentIds.has(row.id),
    attachments: [
      ...(attachmentsByOwner.get(row.id) ?? []),
      // Gel images of the genotyping records done with this protocol show on its card too (T-016).
      ...input.genotypingRecords
        .filter((record) => record.protocol_id === row.id)
        .flatMap((record) => attachmentsByOwner.get(record.id) ?? []),
    ].map(toAttachment),
  }));

  const cryoUseRows = input.cryoUses ?? [];
  const usedByRecord = new Map<string, number>();
  for (const use of cryoUseRows)
    usedByRecord.set(
      use.cryo_record_id,
      (usedByRecord.get(use.cryo_record_id) ?? 0) + use.quantity,
    );
  const cryoUses: LineDetailCryoUse[] = cryoUseRows.map((use) => ({
    id: use.id,
    cryoId: use.cryo_id,
    quantity: use.quantity,
    usedAt: use.used_at,
    note: use.note,
    usedByName: userName(userNames, use.created_by),
    place: input.cryoPlaces?.[use.cryo_record_id] ?? null,
  }));
  const cryoRecords: LineDetailCryoRecord[] = input.cryoRecords.map((row) => ({
    id: row.id,
    cryoDate: row.cryo_date,
    place: row.place,
    boxName: row.box_name,
    cryoIdStart: row.cryo_id_start,
    cryoIdEnd: row.cryo_id_end,
    count: row.count,
    usedCount: usedByRecord.get(row.id) ?? 0,
    detailsUnknown: row.details_unknown === 1,
    notes: row.notes,
  }));

  const references: LineDetailReference[] = input.references.map((row) => {
    const attachment =
      row.attachment_id === null ? null : (attachmentsById.get(row.attachment_id) ?? null);
    return {
      id: row.id,
      title: row.title,
      url: row.url,
      note: row.note,
      attachment: attachment === null ? null : toAttachment(attachment),
    };
  });

  const recordsByGeneration = groupBy(input.genotypingRecords, (row) => String(row.generation_no));
  const generations: LineDetailGeneration[] = [...recordsByGeneration.entries()]
    .map(([generationNoText, records]): LineDetailGeneration => {
      const generationNo = Number(generationNoText);
      const transition = records.find((row) => row.is_new_generation === 1);
      const dob = generationNo === line.generation_no ? line.dob : (transition?.new_dob ?? null);
      return {
        generationNo,
        dob,
        records: records.map((row): LineDetailGenotypingRecord => ({
          id: row.id,
          generationNo: row.generation_no,
          recordDate: row.record_date,
          protocolId: row.protocol_id,
          protocolLabel:
            row.protocol_id === null ? null : (protocolLabelById.get(row.protocol_id) ?? null),
          positiveCount: row.positive_count,
          screenedCount: row.screened_count,
          isNewGeneration: row.is_new_generation === 1,
          newDob: row.new_dob,
          notes: row.notes,
          attachments: (attachmentsByOwner.get(row.id) ?? []).map(toAttachment),
        })),
      };
    })
    .sort((a, b) => b.generationNo - a.generationNo);

  const versions: LineDetailVersion[] = input.versions.map((row) => ({
    id: row.id,
    versionNo: row.version_no,
    changeType: row.change_type,
    summary: row.summary,
    note: row.note,
    createdAt: row.created_at,
    createdByName: userName(userNames, row.created_by),
    viaAdmin: row.via_admin === 1,
    diff: JSON.parse(row.diff ?? '[]') as LineDetailVersionDiff[],
  }));

  const latestChat = input.chatMessages.reduce<ChatMessageRow | null>(
    (latest, message) =>
      latest === null || message.created_at > latest.created_at ? message : latest,
    null,
  );
  const lastUpdateEvent = lastUpdate(
    { at: line.updated_at, byUserId: line.updated_by },
    latestChat === null ? null : { at: latestChat.created_at, byUserId: latestChat.user_id },
  );

  return {
    id: line.id,
    name: line.name,
    gene: line.gene,
    status: line.status,
    dob: line.dob,
    ageMonths: line.dob === null ? null : ageInMonths(line.dob, input.now ?? new Date()),
    generationNo: line.generation_no,
    idedNumber: line.ided_number,
    lastIdDate: line.last_id_date,
    breedingStartedAt: line.breeding_started_at,
    closedAt: line.closed_at,
    closedReason: line.closed_reason,
    notes: line.notes,
    version: line.version,
    createdAt: line.created_at,
    createdByName: userName(userNames, line.created_by),
    updatedAt: lastUpdateEvent.at,
    updatedByName: userName(userNames, lastUpdateEvent.byUserId),
    isCryopreserved: isCryopreserved(input.cryoRecords.length),
    cryoStrawCount: input.cryoRecords.reduce((sum, row) => sum + (row.count ?? 0), 0),
    phenotypes: input.phenotypes.map((row) => ({ id: row.id, description: row.description })),
    attributes: input.attributes.map((row) => ({ id: row.id, key: row.key, value: row.value })),
    protocols,
    cryoRecords,
    cryoUses,
    references,
    generations,
    versions,
  };
}
