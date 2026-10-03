import type { LineDetailDocument } from './lineDetail';

const HEADERS = [
  'Section',
  'Line',
  'Gene',
  'Phenotype(s)',
  'DOB',
  'Status',
  'ID Method',
  'Last ID Date',
  'IDed Number',
  'Cryopreserved',
  'Cryo Summary',
  'Notes',
  'Last Update',
  'Last Update By',
  'Created',
  'Created By',
  'Breeding Since',
  'Closed On',
  'Closed Reason',
  'Generation',
  'More Attributes',
  'Protocol Type',
  'Protocol Label',
  'Protocol Fields',
  'Protocol Attachments',
  'Cryopreservation Date',
  'Place',
  'Box Name',
  'Cryo IDs',
  'Count',
  'Cryo Details',
  'Genotyping Date',
  'Positive Count',
  'Screened Count',
  'Genotyping Protocol',
  'Genotyping Notes',
  'Genotyping Attachments',
  'Reference Title',
  'Reference URL',
  'Reference Note',
  'Reference Attachment',
] as const;

type CsvColumn = (typeof HEADERS)[number];
type CsvValues = Partial<Record<CsvColumn, string>>;

function csvCell(raw: string): string {
  // Keep exported user-entered text from becoming an Excel formula when the CSV is opened.
  const safe = /^[\t\r ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function baseValues(line: LineDetailDocument): CsvValues {
  const currentLabels = line.protocols
    .filter((protocol) => protocol.isCurrent)
    .map((protocol) => protocol.label)
    .join('; ');
  const cryoSummary = line.cryoRecords
    .map((record) => {
      if (record.detailsUnknown) return 'Details unknown';
      const ids = [record.cryoIdStart, record.cryoIdEnd].filter(
        (item): item is string => item !== null,
      );
      return [
        ...(record.place === null ? [] : [record.place]),
        ...(ids.length === 0 ? [] : [ids.join('–')]),
      ].join(', ');
    })
    .filter(Boolean)
    .join('; ');
  return {
    Line: line.name,
    Gene: line.gene ?? '',
    'Phenotype(s)': line.phenotypes.map((item) => item.description).join('; '),
    DOB: line.dob ?? '',
    Status: line.status,
    'ID Method': currentLabels,
    'Last ID Date': line.lastIdDate ?? '',
    'IDed Number': String(line.idedNumber),
    Cryopreserved: line.isCryopreserved ? 'Yes' : 'No',
    'Cryo Summary': cryoSummary,
    Notes: line.notes ?? '',
    'Last Update': line.updatedAt,
    'Last Update By': line.updatedByName,
    Created: line.createdAt,
    'Created By': line.createdByName,
    'Breeding Since': line.breedingStartedAt ?? '',
    'Closed On': line.closedAt ?? '',
    'Closed Reason': line.closedReason ?? '',
    Generation: String(line.generationNo),
    'More Attributes': line.attributes.map((item) => `${item.key}: ${item.value ?? ''}`).join('; '),
  };
}

function row(section: string, base: CsvValues, extra: CsvValues = {}): string[] {
  const values: CsvValues = { ...base, ...extra, Section: section };
  return HEADERS.map((header) => csvCell(values[header] ?? ''));
}

/** FR-EXP-02: one flat line row followed by one row per child record. */
export function buildLineExportCsv(line: LineDetailDocument): string {
  const base = baseValues(line);
  const rows = [row('line', base)];
  for (const protocol of line.protocols) {
    rows.push(
      row('protocol', base, {
        'Protocol Type': protocol.protocolType,
        'Protocol Label': protocol.label,
        'Protocol Fields': JSON.stringify(protocol.fields),
        'Protocol Attachments': protocol.attachments
          .map((attachment) => attachment.fileName ?? attachment.caption ?? attachment.id)
          .join('; '),
      }),
    );
  }
  for (const cryo of line.cryoRecords) {
    rows.push(
      row('cryo', base, {
        'Cryopreservation Date': cryo.cryoDate ?? '',
        Place: cryo.place ?? '',
        'Box Name': cryo.boxName ?? '',
        'Cryo IDs': [cryo.cryoIdStart, cryo.cryoIdEnd]
          .filter((item): item is string => item !== null)
          .join('–'),
        Count: cryo.count === null ? '' : String(cryo.count),
        'Cryo Details': cryo.detailsUnknown ? 'Details unknown' : '',
        Notes: cryo.notes ?? '',
      }),
    );
  }
  for (const generation of line.generations) {
    for (const record of generation.records) {
      rows.push(
        row('genotyping', base, {
          'Genotyping Date': record.recordDate,
          'Positive Count': String(record.positiveCount),
          'Screened Count': record.screenedCount === null ? '' : String(record.screenedCount),
          Generation: String(record.generationNo),
          'Genotyping Protocol': record.protocolLabel ?? '',
          'Genotyping Notes': record.notes ?? '',
          'Genotyping Attachments': record.attachments
            .map((attachment) => attachment.fileName ?? attachment.caption ?? attachment.id)
            .join('; '),
        }),
      );
    }
  }
  for (const reference of line.references) {
    rows.push(
      row('reference', base, {
        'Reference Title': reference.title,
        'Reference URL': reference.url ?? '',
        'Reference Note': reference.note ?? '',
        'Reference Attachment':
          reference.attachment?.fileName ?? reference.attachment?.caption ?? '',
      }),
    );
  }
  const csv = [HEADERS, ...rows].map((cells) => cells.map(csvCell).join(',')).join('\r\n');
  return `${String.fromCharCode(0xfeff)}${csv}\r\n`;
}

export function lineExportCsvFileName(name: string, today: string): string {
  const safeName =
    name
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^\.+|\.+$/g, '')
      .replace(/^_+|_+$/g, '') || 'line';
  return `fish-line_${safeName}_${today}.csv`;
}
