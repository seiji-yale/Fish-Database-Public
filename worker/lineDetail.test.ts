import { describe, expect, it } from 'vitest';
import { buildLineDetail } from './lib/lineDetail';
import {
  makeAttachment,
  makeChatMessage,
  makeCryoRecord,
  makeGenotypingRecord,
  makeLine,
  makeProtocol,
  makeReference,
  makeVersion,
  USER_ID,
} from './db/testing/builders';

const NOW = '2026-09-29';

function base() {
  return {
    line: makeLine({ id: 'l1' }),
    phenotypes: [],
    attributes: [],
    protocols: [],
    cryoRecords: [],
    references: [],
    genotypingRecords: [],
    attachments: [],
    chatMessages: [],
    versions: [],
    userNames: { [USER_ID.bob]: 'Bob' },
    now: NOW,
  };
}

describe('buildLineDetail (T-009)', () => {
  it('resolves author names and computes age (BR-3) and cryopreserved (BR-6)', () => {
    const document = buildLineDetail({
      ...base(),
      line: makeLine({
        id: 'l1',
        dob: '2025-01-11',
        created_by: USER_ID.bob,
        updated_by: USER_ID.bob,
      }),
      cryoRecords: [makeCryoRecord({ line_id: 'l1' })],
    });
    expect(document.ageMonths).toBe(20);
    expect(document.createdByName).toBe('Bob');
    expect(document.updatedByName).toBe('Bob');
    expect(document.isCryopreserved).toBe(true);
  });

  it('falls back to the user id when the name is unknown', () => {
    const document = buildLineDetail({
      ...base(),
      line: makeLine({ id: 'l1', created_by: 'missing-user', updated_by: 'missing-user' }),
    });
    expect(document.createdByName).toBe('missing-user');
  });

  it('marks the protocol matching current_protocol_id as current, and parses its fields JSON', () => {
    const document = buildLineDetail({
      ...base(),
      line: makeLine({ id: 'l1', current_protocol_id: 'proto-1' }),
      protocols: [
        makeProtocol({ id: 'proto-1', line_id: 'l1', fields: '{"annealing_c":61}' }),
        makeProtocol({ id: 'proto-2', line_id: 'l1', label: 'Second PCR' }),
      ],
    });
    expect(document.protocols).toHaveLength(2);
    expect(document.protocols[0]).toMatchObject({ id: 'proto-1', isCurrent: true });
    expect(document.protocols[0]?.fields).toEqual({ annealing_c: 61 });
    expect(document.protocols[1]).toMatchObject({ id: 'proto-2', isCurrent: false });
  });

  it('attaches protocol images by owner_id (id_protocol attachments)', () => {
    const document = buildLineDetail({
      ...base(),
      protocols: [makeProtocol({ id: 'proto-1', line_id: 'l1' })],
      attachments: [
        makeAttachment({ id: 'att-1', owner_type: 'id_protocol', owner_id: 'proto-1' }),
      ],
    });
    expect(document.protocols[0]?.attachments.map((a) => a.id)).toEqual(['att-1']);
  });

  it('BR-6: cryo straw count sums the count field; unknown-details records still count as cryopreserved', () => {
    const document = buildLineDetail({
      ...base(),
      cryoRecords: [
        makeCryoRecord({ id: 'c1', line_id: 'l1', count: 7 }),
        makeCryoRecord({ id: 'c2', line_id: 'l1', count: 8 }),
        makeCryoRecord({ id: 'c3', line_id: 'l1', details_unknown: 1, count: null }),
      ],
    });
    expect(document.cryoStrawCount).toBe(15);
    expect(document.isCryopreserved).toBe(true);
    expect(document.cryoRecords).toHaveLength(3);
    expect(document.cryoRecords[2]).toMatchObject({ detailsUnknown: true, count: null });
  });

  it('resolves a reference by its attachment_id (not by owner_id), a direct FK', () => {
    const document = buildLineDetail({
      ...base(),
      references: [makeReference({ id: 'ref-1', line_id: 'l1', attachment_id: 'att-1' })],
      attachments: [
        makeAttachment({ id: 'att-1', owner_type: 'line_reference', owner_id: 'ref-1' }),
      ],
    });
    expect(document.references[0]?.attachment?.id).toBe('att-1');
  });

  it('a reference with neither a url nor an attachment_id has a null attachment', () => {
    const document = buildLineDetail({
      ...base(),
      references: [makeReference({ id: 'ref-1', line_id: 'l1', url: null, attachment_id: null })],
    });
    expect(document.references[0]?.attachment).toBeNull();
  });

  it('groups genotyping records by generation, newest generation first (FR-HIST-04)', () => {
    const document = buildLineDetail({
      ...base(),
      line: makeLine({ id: 'l1', generation_no: 2, dob: '2026-02-17' }),
      genotypingRecords: [
        makeGenotypingRecord({
          id: 'g1',
          line_id: 'l1',
          generation_no: 1,
          record_date: '2025-09-10',
          positive_count: 12,
        }),
        makeGenotypingRecord({
          id: 'g2',
          line_id: 'l1',
          generation_no: 2,
          record_date: '2026-06-30',
          positive_count: 6,
          is_new_generation: 1,
          new_dob: '2026-02-17',
        }),
      ],
    });
    expect(document.generations.map((g) => g.generationNo)).toEqual([2, 1]);
    // The current generation's DOB comes from the line row.
    expect(document.generations[0]).toMatchObject({ generationNo: 2, dob: '2026-02-17' });
    expect(document.generations[0]?.records.map((r) => r.id)).toEqual(['g2']);
    // Generation 1 predates any stored transition record, so its DOB cannot be recovered.
    expect(document.generations[1]).toMatchObject({ generationNo: 1, dob: null });
  });

  it('an older, non-first generation recovers its DOB from its own transition record', () => {
    // Unlike generation 1 (no transition record exists), generation 2 here is neither the first
    // nor the current generation, and does have the record that started it (is_new_generation = 1,
    // tagged with generation_no = 2, the generation it started — docs/03-data-model.md §1).
    const document = buildLineDetail({
      ...base(),
      line: makeLine({ id: 'l1', generation_no: 3, dob: '2026-06-01' }),
      genotypingRecords: [
        makeGenotypingRecord({
          id: 'g1',
          line_id: 'l1',
          generation_no: 1,
          record_date: '2024-01-10',
          positive_count: 10,
        }),
        makeGenotypingRecord({
          id: 'g2',
          line_id: 'l1',
          generation_no: 2,
          record_date: '2025-01-15',
          positive_count: 8,
          is_new_generation: 1,
          new_dob: '2025-01-11',
        }),
        makeGenotypingRecord({
          id: 'g3',
          line_id: 'l1',
          generation_no: 3,
          record_date: '2026-06-30',
          positive_count: 6,
          is_new_generation: 1,
          new_dob: '2026-06-01',
        }),
      ],
    });
    const byGeneration = new Map(document.generations.map((g) => [g.generationNo, g]));
    expect(byGeneration.get(3)).toMatchObject({ dob: '2026-06-01' });
    expect(byGeneration.get(2)).toMatchObject({ dob: '2025-01-11' });
    expect(byGeneration.get(1)).toMatchObject({ dob: null });
  });

  it('resolves a genotyping record protocol label and its gel image attachment', () => {
    const document = buildLineDetail({
      ...base(),
      protocols: [makeProtocol({ id: 'proto-1', line_id: 'l1', label: 'PCR – insertion' })],
      genotypingRecords: [
        makeGenotypingRecord({ id: 'g1', line_id: 'l1', protocol_id: 'proto-1' }),
      ],
      attachments: [
        makeAttachment({ id: 'att-1', owner_type: 'genotyping_record', owner_id: 'g1' }),
      ],
    });
    expect(document.generations[0]?.records[0]).toMatchObject({
      protocolLabel: 'PCR – insertion',
    });
    expect(document.generations[0]?.records[0]?.attachments.map((a) => a.id)).toEqual(['att-1']);
  });

  it('parses the version diff JSON and resolves the author name', () => {
    const document = buildLineDetail({
      ...base(),
      versions: [
        makeVersion({
          id: 'v1',
          line_id: 'l1',
          created_by: USER_ID.bob,
          diff: '[{"path":"gene","before":null,"after":"pkd2"}]',
        }),
      ],
    });
    expect(document.versions[0]).toMatchObject({ id: 'v1', createdByName: 'Bob' });
    expect(document.versions[0]?.diff).toEqual([{ path: 'gene', before: null, after: 'pkd2' }]);
  });

  it('a version with no diff (e.g. an import) parses to an empty array', () => {
    const document = buildLineDetail({
      ...base(),
      versions: [makeVersion({ id: 'v1', line_id: 'l1', diff: null })],
    });
    expect(document.versions[0]?.diff).toEqual([]);
  });

  it('a line with no dob has a null ageMonths (BR-3: no DOB is never flagged)', () => {
    const document = buildLineDetail({ ...base(), line: makeLine({ id: 'l1', dob: null }) });
    expect(document.ageMonths).toBeNull();
  });

  it('BR-4: Last Update is the line change when no chat message is later', () => {
    const document = buildLineDetail({
      ...base(),
      line: makeLine({
        id: 'l1',
        updated_at: '2026-09-01T00:00:00Z',
        updated_by: USER_ID.bob,
      }),
      chatMessages: [
        makeChatMessage({
          id: 'msg-1',
          line_id: 'l1',
          created_at: '2026-08-01T00:00:00Z',
          user_id: USER_ID.carol,
        }),
      ],
    });
    expect(document).toMatchObject({
      updatedAt: '2026-09-01T00:00:00Z',
      updatedByName: 'Bob',
    });
  });

  it('BR-4: Last Update is a later chat message when one exists', () => {
    const document = buildLineDetail({
      ...base(),
      line: makeLine({
        id: 'l1',
        updated_at: '2026-09-01T00:00:00Z',
        updated_by: USER_ID.bob,
      }),
      chatMessages: [
        makeChatMessage({
          id: 'msg-1',
          line_id: 'l1',
          created_at: '2026-09-15T00:00:00Z',
          user_id: USER_ID.dan,
        }),
      ],
      userNames: { [USER_ID.bob]: 'Bob', [USER_ID.dan]: 'Dan' },
    });
    expect(document).toMatchObject({
      updatedAt: '2026-09-15T00:00:00Z',
      updatedByName: 'Dan',
    });
  });
});
