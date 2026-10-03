import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/lines.small.json';
import { loadFixture, parseFixture } from './fixtures';
import { listActivitiesByLine } from './queries/activities';
import { listCryoRecordsByLine } from './queries/cryoRecords';
import { listGenotypingRecordsByLine } from './queries/genotypingRecords';
import { getIdProtocolById, listIdProtocolsByLine } from './queries/idProtocols';
import { listLineAttributesByLine } from './queries/lineAttributes';
import { listLinePhenotypesByLine } from './queries/linePhenotypes';
import { listLineReferencesByLine } from './queries/lineReferences';
import { getLineByName, listLines } from './queries/lines';
import { listLineVersionsByLine } from './queries/lineVersions';
import { createMigratedDb } from './testing/testDb';

async function seededDb() {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  return db;
}

describe('lines.small.json fixture', () => {
  it('loads five lines, queryable through the helpers', async () => {
    const db = await seededDb();
    const lines = await listLines(db);
    expect(lines.map((line) => [line.name, line.status])).toEqual([
      ['demo_a1', 'Current'],
      ['demo_b2', 'Current'],
      ['demo_c3', 'Current'],
      ['demo_d4', 'Current'],
      ['DEMO_E5', 'Closed'],
    ]);
  });

  it('gives every line version 1 (imported), one imported activity, and a current protocol', async () => {
    const db = await seededDb();
    for (const line of await listLines(db)) {
      const versions = await listLineVersionsByLine(db, line.id);
      expect(versions.map((v) => [v.version_no, v.change_type])).toEqual([[1, 'imported']]);
      expect(await listActivitiesByLine(db, line.id, 10)).toHaveLength(1);
      expect(line.version).toBe(1);
      expect(line.generation_no).toBe(1);
      expect(line.current_protocol_id).not.toBeNull();
      const current = await getIdProtocolById(db, line.current_protocol_id ?? '');
      expect(current?.line_id).toBe(line.id);
    }
  });

  it('demo_c3: PCR protocol, REPOSITORY A source, cryopreserved with unknown details, link-less reference', async () => {
    const db = await seededDb();
    const line = await getLineByName(db, 'demo_c3');
    const expected = fixture.lines.find((item) => item.name === 'demo_c3');
    expect(line).toMatchObject({
      dob: '2025-09-15',
      ided_number: expected?.ided_number,
      last_id_date: '2026-01-08',
      legacy_no: expected?.legacy_no,
    });
    const [protocol] = await listIdProtocolsByLine(db, line?.id ?? '');
    expect(protocol?.protocol_type).toBe('pcr');
    expect(JSON.parse(protocol?.fields ?? '{}')).toMatchObject({
      primer_f_name: 'Primer-1',
      primer_r_name: 'PRIMER-2',
      annealing_c: 60,
      cycles: 35,
      expected_band: '174',
    });
    expect(
      (await listLineAttributesByLine(db, line?.id ?? '')).map((a) => [a.key, a.value]),
    ).toEqual([['Source', 'REPOSITORY A']]);
    const cryo = await listCryoRecordsByLine(db, line?.id ?? '');
    expect(cryo).toHaveLength(1);
    expect(cryo[0]).toMatchObject({ details_unknown: 1, cryo_id_start: null, place: null });
    expect(
      (await listLineReferencesByLine(db, line?.id ?? '')).map((r) => [r.title, r.url]),
    ).toEqual([['Example primers.docx', null]]);
    const records = await listGenotypingRecordsByLine(db, line?.id ?? '');
    expect(records.map((r) => [r.record_date, r.positive_count, r.protocol_id])).toEqual([
      ['2026-01-08', expected?.genotyping_records[0]?.positive_count, protocol?.id],
    ]);
  });

  it('demo_d4: Tails, phenotype, note, cryo range with count', async () => {
    const db = await seededDb();
    const line = await getLineByName(db, 'demo_d4');
    expect(line?.notes).toBe('Example husbandry note');
    expect((await listLinePhenotypesByLine(db, line?.id ?? '')).map((p) => p.description)).toEqual([
      'Short Fins',
    ]);
    expect(
      (await listIdProtocolsByLine(db, line?.id ?? '')).map((p) => [p.protocol_type, p.fields]),
    ).toEqual([['tails', '{}']]);
    expect(
      (await listCryoRecordsByLine(db, line?.id ?? '')).map((c) => [
        c.cryo_id_start,
        c.cryo_id_end,
        c.count,
      ]),
    ).toEqual([['C0548', 'C0551', fixture.lines[3]?.cryo_records[0]?.count]]);
  });

  it('DEMO_E5: Closed, PCR + Sequence with the parsed condition and the original kept in notes', async () => {
    const db = await seededDb();
    const line = await getLineByName(db, 'DEMO_E5');
    expect(line?.status).toBe('Closed');
    const [protocol] = await listIdProtocolsByLine(db, line?.id ?? '');
    expect(protocol?.protocol_type).toBe('pcr_sequence');
    expect(protocol?.notes).toBe('[import] PCR condition: 61 / 30 s / 35 Cycle');
    expect(JSON.parse(protocol?.fields ?? '{}')).toMatchObject({
      annealing_c: 61,
      cycles: 35,
      seq_primer: 'PRIMER-3',
      expected_band: 'N/A',
      expected_mutation: 'G125 to T',
    });
  });

  it('demo_b2: fluorescence fields, no phenotypes, not cryopreserved', async () => {
    const db = await seededDb();
    const line = await getLineByName(db, 'demo_b2');
    const [protocol] = await listIdProtocolsByLine(db, line?.id ?? '');
    expect(JSON.parse(protocol?.fields ?? '{}')).toEqual({
      fluorophore: 'GFP',
      screening_day: '2',
      description: 'green fin fluorescence',
    });
    expect(await listLinePhenotypesByLine(db, line?.id ?? '')).toEqual([]);
    expect(await listCryoRecordsByLine(db, line?.id ?? '')).toEqual([]);
  });

  it('demo_a1: gene split from the allele note, guide sequence kept', async () => {
    const db = await seededDb();
    const line = await getLineByName(db, 'demo_a1');
    expect(line).toMatchObject({
      gene: 'demogene5',
      notes: '[import] allele note: 3 bp insertion',
    });
    const [protocol] = await listIdProtocolsByLine(db, line?.id ?? '');
    expect(JSON.parse(protocol?.fields ?? '{}')).toMatchObject({
      guide_seq: 'GATTACCTTGCGCACACACC',
      expected_mutation: 'AAG > A--',
      expected_band: '300',
    });
  });

  it('cannot be loaded twice, and a failed line leaves nothing behind', async () => {
    const db = await seededDb();
    await expect(loadFixture(db, fixture)).rejects.toThrow(/UNIQUE/);
    expect(await listLines(db)).toHaveLength(5);
  });

  it('rejects a fixture with an unknown field or a wrong type', () => {
    expect(() => parseFixture({ description: 'x', lines: [{ id: 'a', surprise: 1 }] })).toThrow();
    expect(() => parseFixture({ description: 'x', lines: 'no' })).toThrow();
    expect(parseFixture(fixture)).toHaveLength(5);
  });

  it('needs an active non-built-in account', async () => {
    const db = createMigratedDb();
    await db.prepare('UPDATE users SET is_active = 0 WHERE is_builtin = 0').run();
    await expect(loadFixture(db, fixture)).rejects.toThrow(/No active test account/);
  });
});
