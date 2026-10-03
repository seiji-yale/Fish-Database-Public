import { describe, expect, it } from 'vitest';
import { createMigratedDb } from './db/testing/testDb';
import { loadFixture } from './db/fixtures';
import fixture from '../tests/fixtures/lines.small.json';
import { buildExportFiles } from './export/build';
import { exportLinesCsv } from './export/linesCsv';
import { mirrorImagePath } from './export/imagePath';
import { buildSnapshotData, buildSnapshotHtml, jsonForScript } from './export/snapshot';
import type { ExportDocument } from './export/schema';

async function exportOf(): Promise<ExportDocument> {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  return (await buildExportFiles(db, new Date('2026-10-05T15:30:00Z'), exportLinesCsv)).json;
}

/** One line with every kind of child row, to see what the viewer is given. */
function sample(): ExportDocument {
  const base = (id: string, extra: Record<string, unknown>) => ({ id, ...extra });
  return {
    exported_at: '2026-10-05T15:30:00.000Z',
    app_version: '0.0.0',
    users: [{ id: 'u1', name: 'Bob' }],
    enumerations: [],
    lineVersions: [],
    activities: [],
    chatMessages: [],
    settings: {
      upcoming_breeding_months: null,
      default_annealing_c: null,
      default_cycles: null,
      lab_passphrase_enabled: false,
    },
    lines: [
      {
        line: base('L1', {
          name: 'a/b <script>',
          gene: 'g',
          status: 'Closed',
          dob: '2026-01-01',
          generation_no: 2,
          ided_number: 3,
          last_id_date: null,
          breeding_started_at: null,
          closed_at: '2026-02-02',
          closed_reason: 'gone',
          notes: '</script><b>x</b>',
          current_protocol_id: 'P1',
          updated_at: '2026-03-03T00:00:00.000Z',
          updated_by: 'u1',
        }),
        phenotypes: [
          base('ph1', { description: 'kept', deleted_at: null }),
          base('ph2', { description: 'removed', deleted_at: '2026-01-01' }),
        ],
        attributes: [
          base('a1', { key: 'Source', value: 'Lab', deleted_at: null }),
          base('a2', { key: 'Old', value: 'x', deleted_at: '2026-01-01' }),
        ],
        protocols: [
          base('P1', {
            label: 'PCR 1',
            protocol_type: 'pcr',
            fields: '{"annealing_c":60}',
            notes: null,
            is_current: 0,
            deleted_at: null,
          }),
          base('P2', {
            label: 'Gone',
            protocol_type: 'tails',
            fields: '{}',
            deleted_at: '2026-01-01',
          }),
        ],
        genotypingRecords: [
          base('G1', {
            record_date: '2026-04-04',
            generation_no: 2,
            positive_count: 5,
            screened_count: null,
            is_new_generation: 1,
            new_dob: '2026-04-05',
            protocol_id: 'P1',
            notes: 'ok',
            created_by: 'u1',
          }),
          base('G2', {
            record_date: '2026-04-06',
            generation_no: 2,
            positive_count: 1,
            screened_count: 4,
            is_new_generation: 0,
            new_dob: null,
            protocol_id: null,
            notes: null,
            created_by: 'nobody',
          }),
        ],
        cryoRecords: [
          base('C1', {
            cryo_date: null,
            place: 'Tank',
            box_name: null,
            cryo_id_start: 'C1',
            cryo_id_end: 'C3',
            count: 3,
            details_unknown: 0,
            notes: null,
            deleted_at: null,
          }),
          base('C2', { details_unknown: 1, deleted_at: '2026-01-01' }),
        ],
        cryoVialUses: [],
        references: [
          base('R1', {
            title: 'Paper',
            url: 'https://example.org',
            note: null,
            attachment_id: 'T3',
            deleted_at: null,
          }),
          base('R2', { title: 'Gone', url: null, attachment_id: null, deleted_at: '2026-01-01' }),
        ],
        attachments: [
          base('T1', {
            owner_id: 'P1',
            file_name: 'gel #1.png',
            mime_type: 'image/png',
            caption: 'cap',
            r2_key: 'lines/L1/T1-gel-1.png',
            deleted_at: null,
          }),
          base('T2', {
            owner_id: 'G1',
            file_name: 'x.heic',
            mime_type: 'image/heic',
            caption: null,
            r2_key: 'lines/L1/T2-x.heic',
            deleted_at: null,
          }),
          base('T3', {
            owner_id: 'R1',
            file_name: null,
            mime_type: null,
            caption: null,
            r2_key: 'lines/L1/T3-m.pdf',
            deleted_at: null,
          }),
          base('T4', {
            owner_id: 'P1',
            file_name: 'old.png',
            mime_type: 'image/png',
            r2_key: 'lines/L1/T4-old.png',
            deleted_at: '2026-01-01',
          }),
        ],
      },
    ],
  };
}

describe('snapshot data', () => {
  it('leaves out removed rows, names people and protocols, and links images by relative path', () => {
    const data = buildSnapshotData(sample());
    const [line] = data.lines;
    expect(line).toMatchObject({
      name: 'a/b <script>',
      phenotypes: ['kept'],
      attributes: [{ key: 'Source', value: 'Lab' }],
      updatedBy: 'Bob',
      cryo: [{ place: 'Tank', idStart: 'C1', idEnd: 'C3', count: 3 }],
    });
    expect(line?.protocols).toHaveLength(1);
    expect(line?.protocols[0]).toMatchObject({ label: 'PCR 1', current: true });
    expect(line?.protocols[0]?.files).toEqual([
      { name: 'gel #1.png', path: 'images/a-b-script/T1-gel-1.png', isImage: true, caption: 'cap' },
    ]);
    expect(line?.genotyping.map((g) => [g.protocol, g.by, g.newGeneration])).toEqual([
      ['PCR 1', 'Bob', true],
      [null, 'Unknown', false],
    ]);
    // HEIC is a link, not a picture; a reference with a file links to it.
    expect(line?.genotyping[0]?.files[0]).toMatchObject({ isImage: false });
    expect(line?.references).toHaveLength(1);
    expect(line?.references[0]?.file).toMatchObject({ name: 'T3', isImage: false });
  });

  it('points an archive copy at the images in latest/', () => {
    const file = buildSnapshotData(sample(), '../../latest/images/').lines[0]?.protocols[0]
      ?.files[0];
    expect(file?.path).toBe('../../latest/images/a-b-script/T1-gel-1.png');
  });

  it('keeps a `#` or `?` in a file name inside the file name', () => {
    const doc = sample();
    const attachment = doc.lines[0]?.attachments[0];
    if (attachment) attachment['r2_key'] = 'lines/L1/T1-a#b?.png';
    expect(buildSnapshotData(doc).lines[0]?.protocols[0]?.files[0]?.path).toContain(
      'T1-a%23b%3F.png',
    );
  });
});

describe('mirrorImagePath', () => {
  it('uses the key file name below a safe line folder', () => {
    expect(mirrorImagePath('x/y', 'A1', 'lines/L/A1-gel.png')).toBe('x-y/A1-gel.png');
    expect(mirrorImagePath('x', 'A1', 'odd')).toBe('x/A1');
  });
});

describe('snapshot.html', () => {
  it('is one file with no external resources and safe embedded data', () => {
    const html = buildSnapshotHtml(sample());
    expect(html).not.toMatch(/(?:src|href)=["']https?:/i);
    expect(html).not.toMatch(/<link\b|@import|url\(|fetch\(|XMLHttpRequest|innerHTML/);
    // Only our own two <script> elements exist: the data and the viewer.
    expect(html.match(/<script\b/g)).toHaveLength(2);
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).toContain('Read-only copy');
    expect(html).toContain('use the app to edit');
    const embedded = /<script id="snapshot-data" type="application\/json">(.*?)<\/script>/s.exec(
      html,
    )?.[1];
    const parsed = JSON.parse(embedded ?? '') as { lines: { notes: string }[] };
    expect(parsed.lines[0]?.notes).toBe('</script><b>x</b>');
  });

  it('escapes script-breaking text and line separators in JSON', () => {
    const json = jsonForScript({ a: '</script><!--', b: '  ' });
    expect(json).not.toMatch(/</);
    expect(json).not.toContain(' ');
    expect(JSON.parse(json)).toEqual({ a: '</script><!--', b: '  ' });
  });

  it('escapes the configured app title in the offline viewer', () => {
    const html = buildSnapshotHtml(sample(), 'images/', 'Demo <Lab> & Fish');
    expect(html).toContain('<title>Demo &lt;Lab&gt; &amp; Fish (read-only copy)</title>');
    expect(html).toContain('<h1 id="app-name">Demo &lt;Lab&gt; &amp; Fish</h1>');
    expect(html).not.toContain('<h1 id="app-name">Demo <Lab>');
  });

  it('fits the fixture lines well under 2 MB', async () => {
    const html = buildSnapshotHtml(await exportOf());
    expect(new TextEncoder().encode(html).length).toBeLessThan(2_000_000);
    expect(html).toContain('demo_c3');
  });
});
