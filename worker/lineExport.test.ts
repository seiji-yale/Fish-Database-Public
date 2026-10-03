import { describe, expect, it } from 'vitest';
import { buildLineDetail } from './lib/lineDetail';
import { buildLineExportCsv, lineExportCsvFileName } from './lib/lineExport';
import {
  makeLine,
  makeProtocol,
  makeCryoRecord,
  makeAttribute,
  makeReference,
  makeGenotypingRecord,
} from './db/testing/builders';

function parseCsv(text: string): string[][] {
  const records: string[][] = [[]];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index] ?? '';
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') {
      records[records.length - 1]?.push(cell);
      cell = '';
    } else if (character === '\r' && text[index + 1] === '\n') {
      records[records.length - 1]?.push(cell);
      records.push([]);
      cell = '';
      index += 1;
    } else cell += character;
  }
  if (cell !== '' || records[records.length - 1]?.length !== 0)
    records[records.length - 1]?.push(cell);
  return records.filter((record) => record.some((item) => item !== ''));
}

describe('buildLineExportCsv (FR-EXP-02)', () => {
  it('quotes commas/newlines and neutralises spreadsheet formulas from user-entered values', () => {
    const line = buildLineDetail({
      line: makeLine({ id: 'l1', name: '=2+2', gene: '@SUM(1,1)', notes: 'keep, safe\nvalue' }),
      phenotypes: [],
      attributes: [],
      protocols: [
        makeProtocol({ id: 'p1', line_id: 'l1', fields: JSON.stringify({ primer_f_seq: '+CMD' }) }),
      ],
      cryoRecords: [],
      references: [],
      genotypingRecords: [],
      attachments: [],
      versions: [],
      chatMessages: [],
      userNames: {},
    });
    const csv = buildLineExportCsv(line);
    expect(csv).toContain("'=2+2");
    expect(csv).toContain('"keep, safe\nvalue"');
    expect(csv).toContain("'@SUM(1,1)");
  });

  it('emits child rows once and keeps line list column names in the header', () => {
    const line = buildLineDetail({
      line: makeLine({
        id: 'l1',
        name: 'line-1',
        status: 'Breeding',
        current_protocol_id: 'p1',
        breeding_started_at: '2026-08-10',
      }),
      phenotypes: [],
      attributes: [makeAttribute({ id: 'a1', line_id: 'l1' })],
      protocols: [makeProtocol({ id: 'p1', line_id: 'l1' })],
      cryoRecords: [makeCryoRecord({ id: 'c1', line_id: 'l1' })],
      references: [makeReference({ id: 'r1', line_id: 'l1' })],
      genotypingRecords: [makeGenotypingRecord({ id: 'g1', line_id: 'l1' })],
      attachments: [],
      versions: [],
      chatMessages: [],
      userNames: { [makeLine().created_by]: 'Bob' },
    });
    const [header, ...rows] = parseCsv(buildLineExportCsv(line).slice(1));
    expect(header?.join(',')).toContain(
      'Line,Gene,Phenotype(s),DOB,Status,ID Method,Last ID Date,IDed Number',
    );
    expect(rows.map((item) => item[0])).toEqual([
      'line',
      'protocol',
      'cryo',
      'genotyping',
      'reference',
    ]);
    const column = (name: string) => header?.indexOf(name) ?? -1;
    const lineRow = rows.find((item) => item[0] === 'line');
    const cryoRow = rows.find((item) => item[0] === 'cryo');
    const genotypingRow = rows.find((item) => item[0] === 'genotyping');
    const referenceRow = rows.find((item) => item[0] === 'reference');
    expect(cryoRow?.[column('Cryopreservation Date')]).toBe('2026-03-09');
    expect(cryoRow?.[column('Cryo IDs')]).toBe('C0548–C0551');
    expect(genotypingRow?.[column('Genotyping Date')]).toBe('2026-01-08');
    expect(genotypingRow?.[column('Positive Count')]).toBe('6');
    expect(referenceRow?.[column('Reference Title')]).toBe('Example primers.docx');
    expect(lineRow?.[column('Status')]).toBe('Breeding');
    expect(lineRow?.[column('Breeding Since')]).toBe('2026-08-10');
    expect(lineRow?.[column('Generation')]).toBe('1');
    expect(lineRow?.[column('More Attributes')]).toBe('Source: REPOSITORY A');
    expect(lineRow?.[column('Created By')]).toBe('Bob');
  });
});

describe('lineExportCsvFileName', () => {
  it('uses the line name and strips path separators and unsupported filename characters', () => {
    expect(lineExportCsvFileName('demo_c3', '2026-09-29')).toBe('fish-line_demo_c3_2026-09-29.csv');
    expect(lineExportCsvFileName('../DEMO_E5:sample', '2026-09-29')).toBe(
      'fish-line_DEMO_E5_sample_2026-09-29.csv',
    );
  });
});
