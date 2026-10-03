import { describe, expect, it } from 'vitest';
import {
  diffFieldLabel,
  formatCryoIds,
  formatDiffValue,
  referenceKind,
  safeExternalUrl,
} from './lineDetailFormat';

describe('formatCryoIds', () => {
  it('shows the range and count, e.g. DEMO_E5', () => {
    expect(formatCryoIds('C0605', 'C0610', 8)).toBe('C0605–C0610 (8)');
  });
  it('collapses a one-straw range and handles a missing count', () => {
    expect(formatCryoIds('C0001', 'C0001', 1)).toBe('C0001 (1)');
    expect(formatCryoIds('C0001', 'C0503', null)).toBe('C0001–C0503');
  });
  it('shows a lone start or end ID, and a dash for external storage with only a count', () => {
    expect(formatCryoIds('C0505', null, null)).toBe('C0505');
    expect(formatCryoIds(null, 'C0509', null)).toBe('C0509');
    expect(formatCryoIds(null, null, 4)).toBe('— (4)');
    expect(formatCryoIds(null, null, null)).toBe('—');
  });
});

describe('safeExternalUrl', () => {
  it('allows http and https only', () => {
    expect(safeExternalUrl('https://www.dropbox.com/s/abc?dl=0')).toBe(
      'https://www.dropbox.com/s/abc?dl=0',
    );
    expect(safeExternalUrl('http://example.org/a')).toBe('http://example.org/a');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('not a url')).toBeNull();
    expect(safeExternalUrl(null)).toBeNull();
  });
});

describe('referenceKind', () => {
  it('classifies by MIME type, then by whether a URL exists', () => {
    expect(referenceKind(null, 'application/pdf')).toBe('pdf');
    expect(referenceKind(null, 'image/png')).toBe('image');
    expect(referenceKind(null, 'application/msword')).toBe('file');
    expect(referenceKind('https://example.org', null)).toBe('link');
    expect(referenceKind(null, null)).toBe('file');
  });
});

describe('diffFieldLabel', () => {
  it('translates paths to glossary labels', () => {
    expect(diffFieldLabel('dob')).toBe('DOB');
    expect(diffFieldLabel('line.dob')).toBe('DOB');
    expect(diffFieldLabel('line.legacy_check')).toBe('Legacy check');
    expect(diffFieldLabel('ided_number')).toBe('IDed number');
    expect(diffFieldLabel('cryoRecords')).toBe('Cryopreservation');
    expect(diffFieldLabel('current_protocol_id')).toBe('Current ID method');
  });
  it('falls back to readable words, never a raw JSON path', () => {
    expect(diffFieldLabel('legacy_check')).toBe('Legacy check');
    expect(diffFieldLabel('a.b_c')).toBe('A b c');
  });
});

describe('formatDiffValue', () => {
  it('renders empty values as a dash and scalars as text', () => {
    expect(formatDiffValue('gene', null)).toBe('—');
    expect(formatDiffValue('gene', undefined)).toBe('—');
    expect(formatDiffValue('gene', '')).toBe('—');
    expect(formatDiffValue('status', 'Closed')).toBe('Closed');
    expect(formatDiffValue('ided_number', 7)).toBe('7');
    expect(formatDiffValue('x', true)).toBe('Yes');
    expect(formatDiffValue('x', false)).toBe('No');
    expect(formatDiffValue('x', { a: 1 })).toBe('{"a":1}');
  });
  it('resolves the current protocol id to its label', () => {
    const labels = new Map([['p1', 'PCR – insertion']]);
    expect(formatDiffValue('current_protocol_id', 'p1', labels)).toBe('PCR – insertion');
    expect(formatDiffValue('current_protocol_id', 'gone', labels)).toBe('—');
  });
  it('summarises lists of child rows by name', () => {
    expect(formatDiffValue('phenotypes', [])).toBe('—');
    expect(
      formatDiffValue('phenotypes', [{ description: 'Curved' }, { description: 'Small' }]),
    ).toBe('Curved; Small');
    expect(formatDiffValue('protocols', [{ label: 'PCR' }])).toBe('PCR');
    expect(formatDiffValue('references', [{ title: 'Doc.docx' }])).toBe('Doc.docx');
    expect(
      formatDiffValue('attributes', [{ key: 'Source', value: 'REPOSITORY A' }, { key: 'Tank' }]),
    ).toBe('Source: REPOSITORY A; Tank: —');
    expect(formatDiffValue('cryoRecords', [{ details_unknown: 1 }])).toBe('Details unknown');
    expect(
      formatDiffValue('cryoRecords', [
        { cryo_id_start: 'C0001', cryo_id_end: 'C0502', count: 2, details_unknown: 0 },
        { cryo_id_start: null, cryo_id_end: null, count: 3, details_unknown: 0 },
      ]),
    ).toBe('C0001–C0502 (2); — (3)');
    expect(formatDiffValue('cryoRecords', [{ cryo_id_start: null, details_unknown: 0 }])).toBe('—');
    expect(formatDiffValue('x', ['plain', 5])).toBe('plain; 5');
    expect(formatDiffValue('x', [{ other: 1 }])).toBe('—');
  });
});
