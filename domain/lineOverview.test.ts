import { describe, expect, it } from 'vitest';
import {
  toLineListOverview,
  toLineOverview,
  type LineListOverviewSource,
  type LineOverviewSource,
} from './lineOverview';

const listSource = {
  id: 'l1',
  name: 'demo_a1',
  gene: 'gene1',
  phenotypes: ['p1'],
  dob: '2025-01-02',
  ageMonths: 9,
  status: 'Current',
  idMethod: 'PCR',
  idMethodTypes: ['pcr'],
  lastIdDate: '2025-03-01',
  idedNumber: 4,
  missingDob: false,
  references: [{ id: 'r1', title: 'Paper', url: null, hasAttachment: true }],
  // Fields a restricted role must never get:
  isCryopreserved: true,
  cryoSummary: 'Freezer 1',
  needsBreeding: true,
  notes: 'private note',
  lastUpdateAt: '2025-04-01T00:00:00Z',
  lastUpdateBy: 'u1',
  attributes: { key: 'value' },
} satisfies LineListOverviewSource & Record<string, unknown>;

describe('toLineListOverview', () => {
  it('returns exactly the allowed keys (FR-GUEST-05)', () => {
    expect(Object.keys(toLineListOverview(listSource)).sort()).toEqual(
      [
        'ageMonths',
        'dob',
        'gene',
        'id',
        'idMethod',
        'idMethodTypes',
        'idedNumber',
        'lastIdDate',
        'missingDob',
        'name',
        'phenotypes',
        'references',
        'status',
      ].sort(),
    );
  });

  it('copies reference fields by name', () => {
    const result = toLineListOverview({
      ...listSource,
      references: [{ id: 'r1', title: 'T', url: 'u', hasAttachment: false, extra: 1 } as never],
    });
    expect(Object.keys(result.references[0] ?? {}).sort()).toEqual([
      'hasAttachment',
      'id',
      'title',
      'url',
    ]);
  });
});

const detailSource = {
  id: 'l1',
  name: 'demo_a1',
  status: 'Breeding',
  gene: 'gene1',
  phenotypes: [{ description: 'p1' }, { description: 'p2' }],
  dob: '2025-01-02',
  ageMonths: 9,
  idedNumber: 4,
  lastIdDate: '2025-03-01',
  protocols: [
    { label: 'Fin clip PCR', protocolType: 'pcr', isCurrent: true },
    { label: 'Old tails', protocolType: 'tails', isCurrent: false },
  ],
  references: [
    { id: 'r1', title: 'Paper', url: 'https://example.org', attachment: null },
    { id: 'r2', title: 'File', url: null, attachment: { id: 'a1' } },
  ],
  // Fields a restricted role must never get:
  notes: 'private',
  version: 7,
  cryoRecords: [],
  versions: [],
  chatMessages: [],
  attributes: [],
} satisfies LineOverviewSource & Record<string, unknown>;

describe('toLineOverview', () => {
  it('returns exactly the allowed keys (FR-GUEST-07)', () => {
    expect(Object.keys(toLineOverview(detailSource)).sort()).toEqual(
      [
        'ageMonths',
        'dob',
        'gene',
        'id',
        'idMethods',
        'idedNumber',
        'lastIdDate',
        'name',
        'phenotypes',
        'references',
        'restricted',
        'status',
      ].sort(),
    );
  });

  it('keeps only the label and type name of current protocols', () => {
    expect(toLineOverview(detailSource).idMethods).toEqual([
      { label: 'Fin clip PCR', typeName: 'PCR' },
    ]);
  });

  it('flattens phenotypes and marks references with files', () => {
    const result = toLineOverview(detailSource);
    expect(result.phenotypes).toEqual(['p1', 'p2']);
    expect(result.references).toEqual([
      {
        id: 'r1',
        title: 'Paper',
        url: 'https://example.org',
        hasAttachment: false,
        attachmentId: null,
      },
      { id: 'r2', title: 'File', url: null, hasAttachment: true, attachmentId: 'a1' },
    ]);
  });
});
