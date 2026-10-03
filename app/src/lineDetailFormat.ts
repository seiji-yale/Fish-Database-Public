/**
 * Pure display helpers for the Line Detail page (T-009 Steps 3-5): everything here turns API
 * values into text, so it is unit-tested without a browser. Wording comes from `strings.ts`.
 */
import { strings } from './strings';

/** `C0605–C0610 (8)`; a single ID when start equals end; `—` (plus the count) when no IDs exist. */
export function formatCryoIds(
  start: string | null,
  end: string | null,
  count: number | null,
): string {
  let ids: string = strings.emptyValue;
  if (start !== null && end !== null) ids = start === end ? start : `${start}–${end}`;
  else if (start !== null || end !== null) ids = start ?? end ?? strings.emptyValue;
  return count === null ? ids : `${ids} (${String(count)})`;
}

export type ReferenceKind = 'link' | 'pdf' | 'image' | 'file';

/** Only http(s) URLs may become links: a stored `javascript:` URL must never be clickable. */
export function safeExternalUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function referenceKind(url: string | null, mimeType: string | null): ReferenceKind {
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType?.startsWith('image/') === true) return 'image';
  if (mimeType !== null) return 'file';
  return url === null ? 'file' : 'link';
}

const FIELD_LABELS: Record<string, string> = {
  name: strings.fieldLineName,
  gene: strings.gene,
  status: strings.status,
  dob: strings.dob,
  generation_no: strings.generationLabel,
  ided_number: strings.idedNumber,
  last_id_date: strings.lastIdDate,
  breeding_started_at: strings.breedingSince,
  closed_at: strings.closedOn,
  closed_reason: strings.closedReasonLabel,
  notes: strings.columnNotes,
  current_protocol_id: strings.currentIdMethod,
  phenotypes: strings.phenotypes,
  attributes: strings.moreAttributes,
  protocols: strings.sectionIdProtocols,
  cryoRecords: strings.sectionCryopreservation,
  references: strings.references,
};

/** A diff path as people name it (glossary label); unknown paths get a readable fallback. */
export function diffFieldLabel(path: string): string {
  // Every changed column of the line starts with `line.`: obvious on this page, so it is left out.
  const key = path.replace(/^line\./, '');
  const known = FIELD_LABELS[key];
  if (known !== undefined) return known;
  const words = key.replaceAll('_', ' ').replaceAll('.', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : strings.emptyValue;
}

function rowText(row: unknown): string {
  if (row === null || typeof row !== 'object') return scalarText(row);
  const record = row as Record<string, unknown>;
  for (const key of ['label', 'title', 'description']) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  if (typeof record['key'] === 'string') return `${record['key']}: ${scalarText(record['value'])}`;
  if (record['details_unknown'] === 1) return strings.detailsUnknown;
  const start = record['cryo_id_start'];
  const end = record['cryo_id_end'];
  const count = record['count'];
  if (typeof start === 'string' || typeof end === 'string' || typeof count === 'number')
    return formatCryoIds(
      typeof start === 'string' ? start : null,
      typeof end === 'string' ? end : null,
      typeof count === 'number' ? count : null,
    );
  return strings.emptyValue;
}

/**
 * A diff value as text. Lists of child rows (phenotypes, protocols, ...) become a comma-separated
 * summary of their names; `protocolLabels` turns `current_protocol_id` into the protocol's label.
 */
export function formatDiffValue(
  path: string,
  value: unknown,
  protocolLabels: ReadonlyMap<string, string> = new Map(),
): string {
  if (value === null || value === undefined || value === '') return strings.emptyValue;
  if (path === 'current_protocol_id' && typeof value === 'string')
    return protocolLabels.get(value) ?? strings.emptyValue;
  if (Array.isArray(value))
    return value.length === 0 ? strings.emptyValue : value.map(rowText).join('; ');
  if (typeof value === 'boolean') return value ? strings.yes : strings.no;
  if (typeof value === 'object') return JSON.stringify(value);
  return scalarText(value);
}
