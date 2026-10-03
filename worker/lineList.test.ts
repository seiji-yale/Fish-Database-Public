import { describe, expect, it } from 'vitest';
import {
  buildLineList,
  buildLineListCsv,
  lineListCsvFileName,
  matchesFilters,
  matchesSearch,
  sortLineList,
  attributeKeys,
  NO_ID_METHOD_LABEL,
  NO_ID_METHOD_TYPE,
  type LineListItem,
} from './lib/lineList';
import {
  makeCryoRecord,
  makeLine,
  makePhenotype,
  makeProtocol,
  makeReference,
  makeAttribute,
  makeChatMessage,
  USER_ID,
} from './db/testing/builders';

const NOW = '2026-09-29';

describe('buildLineList (T-008)', () => {
  it('lists every current method, primary first, and keeps all their types for the filter', () => {
    const line = makeLine({ id: 'l1', current_protocol_id: 'p2' });
    const [item] = buildLineList({
      lines: [line],
      phenotypes: [],
      attributes: [],
      currentProtocols: [
        makeProtocol({ id: 'p1', line_id: 'l1', label: 'PCR', sort_order: 0, is_current: 1 }),
        makeProtocol({
          id: 'p2',
          line_id: 'l1',
          label: 'GFP screen',
          protocol_type: 'fluorescence',
          sort_order: 1,
          is_current: 1,
        }),
      ],
      cryoRecords: [],
      references: [],
      chatMessages: [],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(item?.idMethod).toBe('GFP screen, PCR');
    expect(item?.idMethodType).toBe('fluorescence');
    expect(item?.idMethodTypes).toEqual(['fluorescence', 'pcr']);
  });

  it('uses the current protocol label as the ID Method and "None" when there is none', () => {
    const withProtocol = makeLine({ id: 'l1', current_protocol_id: 'proto-1' });
    const withoutProtocol = makeLine({ id: 'l2', name: 'other', current_protocol_id: null });
    const items = buildLineList({
      lines: [withProtocol, withoutProtocol],
      phenotypes: [],
      attributes: [],
      currentProtocols: [makeProtocol({ id: 'proto-1', line_id: 'l1', label: 'PCR + Sequence' })],
      cryoRecords: [],
      references: [],
      chatMessages: [],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]?.idMethod).toBe('PCR + Sequence');
    expect(items[1]?.idMethod).toBe(NO_ID_METHOD_LABEL);
    expect(items[1]?.idMethodType).toBe(NO_ID_METHOD_TYPE);
  });

  it('joins phenotypes in the order the query returns them and groups attributes by line', () => {
    // The query layer orders by `sort_order` (worker/db/queries/linePhenotypes.ts); buildLineList
    // trusts that order rather than re-sorting.
    const line = makeLine({ id: 'l1' });
    const items = buildLineList({
      lines: [line],
      phenotypes: [
        makePhenotype({ id: 'p1', line_id: 'l1', description: 'A', sort_order: 0 }),
        makePhenotype({ id: 'p2', line_id: 'l1', description: 'B', sort_order: 1 }),
      ],
      attributes: [makeAttribute({ line_id: 'l1', key: 'Source', value: 'REPOSITORY A' })],
      currentProtocols: [],
      cryoRecords: [],
      references: [],
      chatMessages: [],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]?.phenotypes).toEqual(['A', 'B']);
    expect(items[0]?.attributes).toEqual({ Source: 'REPOSITORY A' });
  });

  it('BR-6: cryopreserved is true with at least one live cryo record; unknown details still count', () => {
    const line = makeLine({ id: 'l1' });
    const items = buildLineList({
      lines: [line],
      phenotypes: [],
      attributes: [],
      currentProtocols: [],
      cryoRecords: [makeCryoRecord({ line_id: 'l1', details_unknown: 1 })],
      references: [],
      chatMessages: [],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]?.isCryopreserved).toBe(true);
    expect(items[0]?.cryoSummary).toBe('Details unknown');
  });

  it('summarises known cryo records with place, box and the Cryo ID range', () => {
    const line = makeLine({ id: 'l1' });
    const items = buildLineList({
      lines: [line],
      phenotypes: [],
      attributes: [],
      currentProtocols: [],
      cryoRecords: [makeCryoRecord({ line_id: 'l1' })],
      references: [],
      chatMessages: [],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]?.cryoSummary).toBe('Demo freezer shelf, Demo cryo box-Bob, C0548-C0551 (7)');
  });

  it('has no cryo records: isCryopreserved is false and the summary is empty', () => {
    const line = makeLine({ id: 'l1' });
    const items = buildLineList({
      lines: [line],
      phenotypes: [],
      attributes: [],
      currentProtocols: [],
      cryoRecords: [],
      references: [],
      chatMessages: [],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]?.isCryopreserved).toBe(false);
    expect(items[0]?.cryoSummary).toBe('');
  });

  it('BR-3: reuses domain/breeding needsBreeding and ageInMonths (no DOB is never flagged)', () => {
    const overThreshold = makeLine({ id: 'l1', status: 'Current', dob: '2025-01-11' });
    const noDob = makeLine({ id: 'l2', status: 'Current', dob: null });
    const items = buildLineList({
      lines: [overThreshold, noDob],
      phenotypes: [],
      attributes: [],
      currentProtocols: [],
      cryoRecords: [],
      references: [],
      chatMessages: [],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]).toMatchObject({ needsBreeding: true, missingDob: false, ageMonths: 20 });
    expect(items[1]).toMatchObject({ needsBreeding: false, missingDob: true, ageMonths: null });
  });

  it('BR-4: Last Update is the later of the line change and the latest live chat message', () => {
    const line = makeLine({
      id: 'l1',
      updated_at: '2026-09-01T00:00:00Z',
      updated_by: USER_ID.bob,
    });
    const items = buildLineList({
      lines: [line],
      phenotypes: [],
      attributes: [],
      currentProtocols: [],
      cryoRecords: [],
      references: [],
      chatMessages: [
        makeChatMessage({
          id: 'msg-old',
          line_id: 'l1',
          created_at: '2026-08-01T00:00:00Z',
          user_id: USER_ID.carol,
        }),
        makeChatMessage({
          id: 'msg-new',
          line_id: 'l1',
          created_at: '2026-09-15T00:00:00Z',
          user_id: USER_ID.dan,
        }),
      ],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]).toMatchObject({
      lastUpdateAt: '2026-09-15T00:00:00Z',
      lastUpdateBy: USER_ID.dan,
    });
  });

  it('ignores chat messages that belong to other lines or to the lab-wide channel', () => {
    const line = makeLine({
      id: 'l1',
      updated_at: '2026-09-01T00:00:00Z',
      updated_by: USER_ID.bob,
    });
    const items = buildLineList({
      lines: [line],
      phenotypes: [],
      attributes: [],
      currentProtocols: [],
      cryoRecords: [],
      references: [],
      chatMessages: [
        makeChatMessage({ id: 'msg-1', line_id: 'other-line', created_at: '2026-09-20T00:00:00Z' }),
        makeChatMessage({ id: 'msg-2', line_id: null, created_at: '2026-09-25T00:00:00Z' }),
      ],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]).toMatchObject({
      lastUpdateAt: '2026-09-01T00:00:00Z',
      lastUpdateBy: USER_ID.bob,
    });
  });

  it('maps references with their title, url and whether an attachment is uploaded', () => {
    const line = makeLine({ id: 'l1' });
    const items = buildLineList({
      lines: [line],
      phenotypes: [],
      attributes: [],
      currentProtocols: [],
      cryoRecords: [],
      references: [
        makeReference({ line_id: 'l1', title: 'Primers', url: null, attachment_id: 'att-1' }),
      ],
      chatMessages: [],
      thresholdMonths: 11,
      now: NOW,
    });
    expect(items[0]?.references).toEqual([
      { id: 'ref-1', title: 'Primers', url: null, hasAttachment: true },
    ]);
  });
});

describe('matchesSearch (FR-GLB-05)', () => {
  const base: LineListItem = {
    id: 'l1',
    name: 'demo_c3',
    gene: 'pkd2',
    phenotypes: ['Short Fins'],
    dob: null,
    ageMonths: null,
    status: 'Current',
    idMethod: 'PCR',
    idMethodType: 'pcr',
    idMethodTypes: ['pcr'],
    lastIdDate: null,
    idedNumber: 0,
    isCryopreserved: false,
    cryoSummary: '',
    needsBreeding: false,
    missingDob: true,
    references: [],
    notes: 'Slow to breed',
    lastUpdateAt: NOW,
    lastUpdateBy: USER_ID.bob,
    attributes: { Source: 'REPOSITORY A' },
  };

  it('matches an empty query', () => {
    expect(matchesSearch(base, '')).toBe(true);
    expect(matchesSearch(base, '   ')).toBe(true);
  });

  it('matches name, gene, phenotype and notes case-insensitively', () => {
    expect(matchesSearch(base, 'DEMO_C3')).toBe(true);
    expect(matchesSearch(base, 'pkd2')).toBe(true);
    expect(matchesSearch(base, 'short fins')).toBe(true);
    expect(matchesSearch(base, 'slow to breed')).toBe(true);
  });

  it('does not match on attribute values (they are not a listed search field)', () => {
    expect(matchesSearch(base, 'REPOSITORY A')).toBe(false);
  });

  it('does not match an unrelated query', () => {
    expect(matchesSearch(base, 'demogene5')).toBe(false);
  });

  it('handles a null gene and null notes', () => {
    expect(matchesSearch({ ...base, gene: null, notes: null }, 'pkd2')).toBe(false);
  });
});

describe('matchesFilters (FR-LIST-03 filter chips)', () => {
  const base: LineListItem = {
    id: 'l1',
    name: 'demo_c3',
    gene: null,
    phenotypes: [],
    dob: null,
    ageMonths: null,
    status: 'Current',
    idMethod: 'Fluorescence',
    idMethodType: 'fluorescence',
    idMethodTypes: ['fluorescence'],
    lastIdDate: null,
    idedNumber: 0,
    isCryopreserved: true,
    cryoSummary: '',
    needsBreeding: true,
    missingDob: false,
    references: [],
    notes: null,
    lastUpdateAt: NOW,
    lastUpdateBy: USER_ID.bob,
    attributes: {},
  };

  it('matches everything when no filter is given', () => {
    expect(matchesFilters(base, {})).toBe(true);
  });

  it('filters by ID Method type', () => {
    expect(matchesFilters(base, { idMethodType: 'fluorescence' })).toBe(true);
    expect(matchesFilters(base, { idMethodType: 'pcr' })).toBe(false);
    expect(
      matchesFilters({ ...base, idMethodTypes: ['pcr', 'fluorescence'] }, { idMethodType: 'pcr' }),
    ).toBe(true);
  });

  it('filters by cryopreserved', () => {
    expect(matchesFilters(base, { cryopreserved: true })).toBe(true);
    expect(matchesFilters(base, { cryopreserved: false })).toBe(false);
  });

  it('filters by needs-breeding ("Breed soon")', () => {
    expect(matchesFilters(base, { breedSoon: true })).toBe(true);
    expect(matchesFilters(base, { breedSoon: false })).toBe(false);
  });

  it('combines filters (AND)', () => {
    expect(matchesFilters(base, { idMethodType: 'fluorescence', cryopreserved: true })).toBe(true);
    expect(matchesFilters(base, { idMethodType: 'fluorescence', cryopreserved: false })).toBe(
      false,
    );
  });
});

describe('sortLineList (FR-LIST-03)', () => {
  function item(overrides: Partial<LineListItem>): LineListItem {
    return {
      id: overrides.name ?? 'l',
      name: 'line',
      gene: null,
      phenotypes: [],
      dob: null,
      ageMonths: null,
      status: 'Current',
      idMethod: NO_ID_METHOD_LABEL,
      idMethodType: NO_ID_METHOD_TYPE,
      idMethodTypes: [NO_ID_METHOD_TYPE],
      lastIdDate: null,
      idedNumber: 0,
      isCryopreserved: false,
      cryoSummary: '',
      needsBreeding: false,
      missingDob: true,
      references: [],
      notes: null,
      lastUpdateAt: NOW,
      lastUpdateBy: USER_ID.bob,
      attributes: {},
      ...overrides,
    };
  }

  it('defaults to Status then Line name', () => {
    const rows = [
      item({ name: 'zzz', status: 'Closed' }),
      item({ name: 'bbb', status: 'Current' }),
      item({ name: 'aaa', status: 'Current' }),
      item({ name: 'mid', status: 'Breeding' }),
    ];
    const sorted = sortLineList(rows, undefined);
    expect(sorted.map((row) => row.name)).toEqual(['aaa', 'bbb', 'mid', 'zzz']);
  });

  it('sorts by a chosen column, ascending and descending', () => {
    const rows = [item({ name: 'a', idedNumber: 3 }), item({ name: 'b', idedNumber: 1 })];
    expect(sortLineList(rows, 'idedNumber', 'asc').map((row) => row.name)).toEqual(['b', 'a']);
    expect(sortLineList(rows, 'idedNumber', 'desc').map((row) => row.name)).toEqual(['a', 'b']);
  });

  it('is stable: rows that compare equal keep their input order', () => {
    const rows = [item({ name: 'first', idedNumber: 1 }), item({ name: 'second', idedNumber: 1 })];
    expect(sortLineList(rows, 'idedNumber', 'asc').map((row) => row.name)).toEqual([
      'first',
      'second',
    ]);
  });

  it('does not mutate the input array', () => {
    const rows = [item({ name: 'b' }), item({ name: 'a' })];
    sortLineList(rows, 'name', 'asc');
    expect(rows.map((row) => row.name)).toEqual(['b', 'a']);
  });
});

describe('CSV export (docs/03-data-model.md §6, FR-LIST-05, BR-10)', () => {
  const rows: LineListItem[] = [
    {
      id: 'l1',
      name: 'demo_c3',
      gene: null,
      phenotypes: ['Short Fins', 'Small Eye'],
      dob: '2025-09-15',
      ageMonths: 8,
      status: 'Current',
      idMethod: 'PCR',
      idMethodType: 'pcr',
      idMethodTypes: ['pcr'],
      lastIdDate: '2026-01-08',
      idedNumber: 6,
      isCryopreserved: true,
      cryoSummary: 'Details unknown',
      needsBreeding: false,
      missingDob: false,
      references: [{ id: 'r1', title: 'Notes, "quoted"', url: null, hasAttachment: false }],
      notes: null,
      lastUpdateAt: '2026-09-01T00:00:00Z',
      lastUpdateBy: USER_ID.bob,
      attributes: { Source: 'REPOSITORY A' },
    },
  ];

  it('starts with a UTF-8 BOM and the exact header row plus attr: columns', () => {
    const csv = buildLineListCsv(rows, { [USER_ID.bob]: 'Bob' });
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(true);
    const [header] = csv.slice(1).split('\r\n');
    expect(header).toBe(
      [
        'Line,Gene,Phenotypes,DOB,Age (months),Status,ID Method,Last ID Date,IDed Number',
        'Cryopreserved,Cryo Summary,References,Notes,Last Update,Last Update By,attr:Source',
      ].join(','),
    );
  });

  it('resolves the last-updated-by user id to a display name', () => {
    const csv = buildLineListCsv(rows, { [USER_ID.bob]: 'Bob' });
    expect(csv).toContain(',Bob,REPOSITORY A\r\n');
  });

  it('quotes cells that contain a comma or a quote', () => {
    const csv = buildLineListCsv(rows, {});
    expect(csv).toContain('"Notes, ""quoted"""');
  });

  it('never shows legacy vocabulary (BR-10): the source data already carries the display label', () => {
    const csv = buildLineListCsv(rows, {});
    expect(csv).not.toMatch(/\bGel\b/);
    expect(csv).not.toMatch(/\bNONE\b/);
  });

  it('only includes attr: columns for keys actually in use, sorted', () => {
    const empty = buildLineListCsv([], {});
    expect(empty).not.toContain('attr:');
    expect(attributeKeys(rows)).toEqual(['Source']);
  });
});

describe('lineListCsvFileName (FR-LIST-05)', () => {
  it('builds fish-lines_<view>_<date>.csv', () => {
    expect(lineListCsvFileName('all', '2026-09-29')).toBe('fish-lines_all_2026-09-29.csv');
  });
});
