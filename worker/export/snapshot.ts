/**
 * `snapshot.html` (T-020 Step 3, FR-SYNC-03, docs/06-operations.md §1.6): one self-contained file with
 * the data embedded as JSON and a small vanilla-JS viewer (list, search, detail). It makes no network
 * calls, so it opens from Dropbox or a laptop folder with the internet off. Images are linked by relative
 * path to the mirror's `images/` folder. The data is shaped here (names resolved, removed rows left out)
 * so the viewer only has to draw it.
 */
import type { ExportDocument } from './schema';
import { mirrorImagePath } from './imagePath';
import { SNAPSHOT_SCRIPT, SNAPSHOT_STYLE } from './snapshotViewer';
import { DEFAULT_APP_NAME } from '../lib/appName';

type Row = Record<string, unknown>;

export interface SnapshotFile {
  name: string;
  /** Relative to the snapshot file. */
  path: string;
  isImage: boolean;
  caption: string | null;
}

export interface SnapshotLine {
  id: string;
  name: string;
  gene: string | null;
  status: string;
  dob: string | null;
  generation: number;
  idedNumber: number;
  lastIdDate: string | null;
  breedingStartedAt: string | null;
  closedAt: string | null;
  closedReason: string | null;
  notes: string | null;
  updatedAt: string;
  updatedBy: string;
  phenotypes: string[];
  attributes: { key: string; value: string | null }[];
  protocols: {
    label: string;
    type: string;
    current: boolean;
    fields: Record<string, unknown>;
    notes: string | null;
    files: SnapshotFile[];
  }[];
  genotyping: {
    date: string;
    generation: number;
    positive: number;
    screened: number | null;
    newGeneration: boolean;
    newDob: string | null;
    protocol: string | null;
    notes: string | null;
    by: string;
    files: SnapshotFile[];
  }[];
  cryo: {
    date: string | null;
    place: string | null;
    box: string | null;
    idStart: string | null;
    idEnd: string | null;
    count: number | null;
    detailsUnknown: boolean;
    notes: string | null;
  }[];
  references: {
    title: string;
    url: string | null;
    note: string | null;
    file: SnapshotFile | null;
  }[];
}

export interface SnapshotData {
  generatedAt: string;
  appVersion: string;
  lines: SnapshotLine[];
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const alive = (row: Row): boolean => row['deleted_at'] === null || row['deleted_at'] === undefined;

/**
 * The shaped data. `imageBase` is the folder (relative to the file) that holds `<line>/<file>`:
 * `images/` for `latest/`, `../../latest/images/` for an archive copy (archives keep no images of their own).
 */
export function buildSnapshotData(doc: ExportDocument, imageBase = 'images/'): SnapshotData {
  const userNames = new Map(doc.users.map((user) => [String(user['id']), String(user['name'])]));
  const who = (id: unknown) => userNames.get(String(id)) ?? 'Unknown';

  const lines = doc.lines.map((entry): SnapshotLine => {
    const line = entry.line;
    const name = String(line['name']);
    const files = new Map<string, SnapshotFile>();
    for (const row of entry.attachments.filter(alive)) {
      const mime = text(row['mime_type']) ?? '';
      files.set(String(row['id']), {
        name: text(row['file_name']) ?? String(row['id']),
        path: `${imageBase}${encodePath(
          mirrorImagePath(name, String(row['id']), String(row['r2_key'])),
        )}`,
        // HEIC does not display in most browsers; it stays a link.
        isImage: /^image\/(jpeg|png|webp|gif)$/.test(mime),
        caption: text(row['caption']),
      });
    }
    const ownedBy = (ownerId: unknown): SnapshotFile[] =>
      entry.attachments
        .filter((row) => alive(row) && row['owner_id'] === ownerId)
        .map((row) => files.get(String(row['id'])))
        .filter((file): file is SnapshotFile => file !== undefined);

    const protocols = entry.protocols.filter(alive);
    const protocolLabel = new Map(protocols.map((p) => [String(p['id']), String(p['label'])]));
    return {
      id: String(line['id']),
      name,
      gene: text(line['gene']),
      status: String(line['status']),
      dob: text(line['dob']),
      generation: num(line['generation_no']) ?? 1,
      idedNumber: num(line['ided_number']) ?? 0,
      lastIdDate: text(line['last_id_date']),
      breedingStartedAt: text(line['breeding_started_at']),
      closedAt: text(line['closed_at']),
      closedReason: text(line['closed_reason']),
      notes: text(line['notes']),
      updatedAt: String(line['updated_at']),
      updatedBy: who(line['updated_by']),
      phenotypes: entry.phenotypes.filter(alive).map((row) => String(row['description'])),
      attributes: entry.attributes
        .filter(alive)
        .map((row) => ({ key: String(row['key']), value: text(row['value']) })),
      protocols: protocols.map((row) => ({
        label: String(row['label']),
        type: String(row['protocol_type']),
        current: row['is_current'] === 1 || row['id'] === line['current_protocol_id'],
        fields: JSON.parse(String(row['fields'])) as Record<string, unknown>,
        notes: text(row['notes']),
        files: ownedBy(row['id']),
      })),
      genotyping: entry.genotypingRecords.map((row) => ({
        date: String(row['record_date']),
        generation: num(row['generation_no']) ?? 1,
        positive: num(row['positive_count']) ?? 0,
        screened: num(row['screened_count']),
        newGeneration: row['is_new_generation'] === 1,
        newDob: text(row['new_dob']),
        protocol: protocolLabel.get(String(row['protocol_id'])) ?? null,
        notes: text(row['notes']),
        by: who(row['created_by']),
        files: ownedBy(row['id']),
      })),
      cryo: entry.cryoRecords.filter(alive).map((row) => ({
        date: text(row['cryo_date']),
        place: text(row['place']),
        box: text(row['box_name']),
        idStart: text(row['cryo_id_start']),
        idEnd: text(row['cryo_id_end']),
        count: num(row['count']),
        detailsUnknown: row['details_unknown'] === 1,
        notes: text(row['notes']),
      })),
      references: entry.references.filter(alive).map((row) => ({
        title: String(row['title']),
        url: text(row['url']),
        note: text(row['note']),
        file: files.get(String(row['attachment_id'])) ?? null,
      })),
    };
  });

  return { generatedAt: doc.exported_at, appVersion: doc.app_version, lines };
}

/** Each path segment percent-encoded, so a `#` or `?` in a name stays part of the file name. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** JSON that is safe inside a `<script>` element: no `</script>`, no `<!--`, no line separators. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll(' ', '\\u2028')
    .replaceAll(' ', '\\u2029');
}

export function buildSnapshotHtml(
  doc: ExportDocument,
  imageBase = 'images/',
  appName = DEFAULT_APP_NAME,
): string {
  const data = buildSnapshotData(doc, imageBase);
  const safeName = appName
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeName} (read-only copy)</title>
<style>${SNAPSHOT_STYLE}</style>
</head>
<body>
<header class="top"><h1 id="app-name">${safeName}</h1><p class="banner">Read-only copy. Use the app to edit.</p></header>
<main id="app"><noscript>This copy needs JavaScript to show the lines.</noscript></main>
<footer class="foot"><span id="generated"></span> · Read-only copy — use the app to edit; changes made here are not saved.</footer>
<script id="snapshot-data" type="application/json">${jsonForScript(data)}</script>
<script>${SNAPSHOT_SCRIPT}</script>
</body>
</html>
`;
}
