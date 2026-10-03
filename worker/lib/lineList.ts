import { currentProtocols } from '../../domain/currentProtocols';
/**
 * Pure assembly for the Line List (T-008, FR-LIST-01…08, BR-3, BR-6, BR-10): turns the raw rows the
 * route fetches (one batch query per child table, see `worker/routes/lines.ts`) into one row per
 * line, then sorts, searches, filters and serialises to CSV. No I/O here so every rule has a plain
 * unit test; `ageInMonths` / `needsBreeding` (BR-3), `lastUpdate` (BR-4) and `isCryopreserved`
 * (BR-6) are the domain functions this module must not re-derive by hand.
 */
import { ageInMonths, needsBreeding } from '../../domain/breeding';
import { isCryopreserved } from '../../domain/cryo';
import { lastUpdate } from '../../domain/lastUpdate';
import type {
  ChatMessageRow,
  CryoRecordRow,
  IdProtocolRow,
  LineAttributeRow,
  LinePhenotypeRow,
  LineReferenceRow,
  LineRow,
  LineStatus,
  ProtocolType,
} from '../db/types';

/** FR-ID-01: the type is never shown to users; only the id protocol's own `label` is (BR-10). */
export const NO_ID_METHOD_LABEL = 'None';
export const NO_ID_METHOD_TYPE: ProtocolType = 'none';

export interface LineListReference {
  id: string;
  title: string;
  url: string | null;
  hasAttachment: boolean;
}

export interface LineListItem {
  id: string;
  name: string;
  gene: string | null;
  phenotypes: string[];
  dob: string | null;
  ageMonths: number | null;
  status: LineStatus;
  idMethod: string;
  /** The primary current method's type (sorting). */
  idMethodType: ProtocolType;
  /** The types of all current methods, for the ID Method filter. */
  idMethodTypes: ProtocolType[];
  lastIdDate: string | null;
  idedNumber: number;
  isCryopreserved: boolean;
  cryoSummary: string;
  needsBreeding: boolean;
  missingDob: boolean;
  references: LineListReference[];
  notes: string | null;
  lastUpdateAt: string;
  lastUpdateBy: string;
  attributes: Record<string, string>;
}

export interface BuildLineListInput {
  lines: readonly LineRow[];
  phenotypes: readonly LinePhenotypeRow[];
  attributes: readonly LineAttributeRow[];
  /** Only the protocols pointed to by each line's `current_protocol_id`. */
  currentProtocols: readonly IdProtocolRow[];
  cryoRecords: readonly CryoRecordRow[];
  references: readonly LineReferenceRow[];
  chatMessages: readonly ChatMessageRow[];
  thresholdMonths: number;
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

function cryoRecordSummary(record: CryoRecordRow): string {
  if (record.details_unknown === 1) return 'Details unknown';
  const parts: string[] = [];
  if (record.place !== null && record.place !== '') parts.push(record.place);
  if (record.box_name !== null && record.box_name !== '') parts.push(record.box_name);
  const range =
    record.cryo_id_start !== null && record.cryo_id_end !== null
      ? `${record.cryo_id_start}-${record.cryo_id_end}`
      : (record.cryo_id_start ?? record.cryo_id_end);
  if (range !== null)
    parts.push(record.count !== null ? `${range} (${String(record.count)})` : range);
  return parts.length > 0 ? parts.join(', ') : 'Details unknown';
}

export function buildLineList(input: BuildLineListInput): LineListItem[] {
  const phenotypesByLine = groupBy(input.phenotypes, (row) => row.line_id);
  const attributesByLine = groupBy(input.attributes, (row) => row.line_id);
  const cryoByLine = groupBy(input.cryoRecords, (row) => row.line_id);
  const referencesByLine = groupBy(input.references, (row) => row.line_id);
  const chatByLine = groupBy(input.chatMessages, (row) => row.line_id ?? '');
  const protocolsByLine = groupBy(input.currentProtocols, (row) => row.line_id);
  const now = input.now ?? new Date();

  return input.lines.map((line): LineListItem => {
    const phenotypes = (phenotypesByLine.get(line.id) ?? []).map((row) => row.description);
    const attributes = Object.fromEntries(
      (attributesByLine.get(line.id) ?? [])
        .filter((row): row is LineAttributeRow & { value: string } => row.value !== null)
        .map((row) => [row.key, row.value]),
    );
    const cryoRecords = cryoByLine.get(line.id) ?? [];
    const references = (referencesByLine.get(line.id) ?? []).map((row): LineListReference => ({
      id: row.id,
      title: row.title,
      url: row.url,
      hasAttachment: row.attachment_id !== null,
    }));
    // Several current methods: primary first (`domain/currentProtocols.ts`).
    const current = currentProtocols(line.current_protocol_id, protocolsByLine.get(line.id) ?? []);
    const protocol = current[0];
    const need = needsBreeding(line, now, input.thresholdMonths);
    const latestChat = (chatByLine.get(line.id) ?? []).reduce<ChatMessageRow | null>(
      (latest, message) =>
        latest === null || message.created_at > latest.created_at ? message : latest,
      null,
    );
    const event = lastUpdate(
      { at: line.updated_at, byUserId: line.updated_by },
      latestChat === null ? null : { at: latestChat.created_at, byUserId: latestChat.user_id },
    );
    return {
      id: line.id,
      name: line.name,
      gene: line.gene,
      phenotypes,
      dob: line.dob,
      ageMonths: line.dob === null ? null : ageInMonths(line.dob, now),
      status: line.status,
      idMethod:
        current.length === 0 ? NO_ID_METHOD_LABEL : current.map((row) => row.label).join(', '),
      idMethodType: protocol?.protocol_type ?? NO_ID_METHOD_TYPE,
      idMethodTypes:
        current.length === 0 ? [NO_ID_METHOD_TYPE] : current.map((row) => row.protocol_type),
      lastIdDate: line.last_id_date,
      idedNumber: line.ided_number,
      isCryopreserved: isCryopreserved(cryoRecords.length),
      cryoSummary: cryoRecords.map(cryoRecordSummary).join('; '),
      needsBreeding: need.needsBreeding,
      missingDob: need.missingDob,
      references,
      notes: line.notes,
      lastUpdateAt: event.at,
      lastUpdateBy: event.byUserId,
      attributes,
    };
  });
}

/** FR-GLB-05: matches line name, gene, phenotype, and notes (case-insensitive substring). */
export function matchesSearch(item: LineListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  if (item.name.toLowerCase().includes(q)) return true;
  if (item.gene !== null && item.gene.toLowerCase().includes(q)) return true;
  if (item.phenotypes.some((phenotype) => phenotype.toLowerCase().includes(q))) return true;
  if (item.notes !== null && item.notes.toLowerCase().includes(q)) return true;
  return false;
}

/** FR-LIST-03 filter chips: ID Method, Cryopreserved, "Needs breeding". Every field is optional —
 * an absent field does not filter on it. */
export interface LineListFilters {
  idMethodType?: ProtocolType | undefined;
  cryopreserved?: boolean | undefined;
  breedSoon?: boolean | undefined;
}

export function matchesFilters(item: LineListItem, filters: LineListFilters): boolean {
  if (filters.idMethodType !== undefined && !item.idMethodTypes.includes(filters.idMethodType))
    return false;
  if (filters.cryopreserved !== undefined && item.isCryopreserved !== filters.cryopreserved)
    return false;
  if (filters.breedSoon !== undefined && item.needsBreeding !== filters.breedSoon) return false;
  return true;
}

/** Status order used for the default sort and for sorting the Status column (FR-LIST-03). */
export const STATUS_SORT_ORDER: Record<LineStatus, number> = { Current: 0, Breeding: 1, Closed: 2 };

export const LINE_LIST_SORT_KEYS = [
  'name',
  'gene',
  'phenotypes',
  'dob',
  'status',
  'idMethod',
  'lastIdDate',
  'idedNumber',
  'isCryopreserved',
  'references',
  'ageMonths',
  'notes',
  'lastUpdateAt',
] as const;
export type LineListSortKey = (typeof LINE_LIST_SORT_KEYS)[number];
export type LineListSortDir = 'asc' | 'desc';

function sortValue(item: LineListItem, key: LineListSortKey): string | number {
  switch (key) {
    case 'name':
      return item.name.toLowerCase();
    case 'gene':
      return (item.gene ?? '').toLowerCase();
    case 'phenotypes':
      return item.phenotypes.join('; ').toLowerCase();
    case 'dob':
      return item.dob ?? '';
    case 'status':
      return STATUS_SORT_ORDER[item.status];
    case 'idMethod':
      return item.idMethod.toLowerCase();
    case 'lastIdDate':
      return item.lastIdDate ?? '';
    case 'idedNumber':
      return item.idedNumber;
    case 'isCryopreserved':
      return item.isCryopreserved ? 1 : 0;
    case 'references':
      return item.references.length;
    case 'ageMonths':
      return item.ageMonths ?? -1;
    case 'notes':
      return (item.notes ?? '').toLowerCase();
    case 'lastUpdateAt':
      return item.lastUpdateAt;
  }
}

function compareDefault(a: LineListItem, b: LineListItem): number {
  const statusDiff = STATUS_SORT_ORDER[a.status] - STATUS_SORT_ORDER[b.status];
  if (statusDiff !== 0) return statusDiff;
  const an = a.name.toLowerCase();
  const bn = b.name.toLowerCase();
  return an < bn ? -1 : an > bn ? 1 : 0;
}

/** FR-LIST-03: default sort is Status then Line name; `Array#sort` is stable (ES2019+). */
export function sortLineList(
  items: readonly LineListItem[],
  sort: LineListSortKey | undefined,
  dir: LineListSortDir = 'asc',
): LineListItem[] {
  const sorted = [...items];
  if (sort === undefined) {
    sorted.sort(compareDefault);
    return sorted;
  }
  sorted.sort((a, b) => {
    const av = sortValue(a, sort);
    const bv = sortValue(b, sort);
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });
  return sorted;
}

export function attributeKeys(items: readonly LineListItem[]): string[] {
  const keys = new Set<string>();
  for (const item of items) for (const key of Object.keys(item.attributes)) keys.add(key);
  return [...keys].sort((a, b) => a.localeCompare(b));
}

function csvCell(value: string): string {
  return /["\n,]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

const CSV_HEADERS = [
  'Line',
  'Gene',
  'Phenotypes',
  'DOB',
  'Age (months)',
  'Status',
  'ID Method',
  'Last ID Date',
  'IDed Number',
  'Cryopreserved',
  'Cryo Summary',
  'References',
  'Notes',
  'Last Update',
  'Last Update By',
] as const;

/** docs/03-data-model.md §6: the Line List CSV columns, UTF-8 BOM, plus one `attr:<key>` per key in use. */
export function buildLineListCsv(
  items: readonly LineListItem[],
  userNames: Readonly<Record<string, string>>,
): string {
  const attrKeys = attributeKeys(items);
  const headers = [...CSV_HEADERS, ...attrKeys.map((key) => `attr:${key}`)];
  const rows = items.map((item) => [
    item.name,
    item.gene ?? '',
    item.phenotypes.join('; '),
    item.dob ?? '',
    item.ageMonths === null ? '' : String(item.ageMonths),
    item.status,
    item.idMethod,
    item.lastIdDate ?? '',
    String(item.idedNumber),
    item.isCryopreserved ? 'Yes' : 'No',
    item.cryoSummary,
    item.references.map((reference) => reference.title).join('; '),
    item.notes ?? '',
    item.lastUpdateAt,
    userNames[item.lastUpdateBy] ?? item.lastUpdateBy,
    ...attrKeys.map((key) => item.attributes[key] ?? ''),
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
  const bom = String.fromCharCode(0xfeff);
  return `${bom}${csv}\r\n`;
}

/** FR-LIST-05: `fish-lines_<view>_<YYYY-MM-DD>.csv`. */
export function lineListCsvFileName(view: string, today: string): string {
  return `fish-lines_${view}_${today}.csv`;
}
