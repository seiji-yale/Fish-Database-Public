import { describe, expect, it } from 'vitest';
import { newLineMessages, validateNewLine, type NewLineValidation } from './newLine';

const TODAY = '2026-09-29';

function ok(input: unknown): Extract<NewLineValidation, { ok: true }> {
  const result = validateNewLine(input, TODAY);
  if (!result.ok) throw new Error(`expected valid input: ${JSON.stringify(result.errors)}`);
  return result;
}

function errorsOf(input: unknown): Record<string, string> {
  const result = validateNewLine(input, TODAY);
  if (result.ok) throw new Error('expected invalid input');
  return result.errors;
}

const minimal = { name: 'demo_c3', dob: '2026-01-05' };

describe('validateNewLine: minimal payload (BR-9 defaults)', () => {
  it('needs only a name and a DOB and fills the defaults', () => {
    const { value } = ok(minimal);
    expect(value).toMatchObject({
      name: 'demo_c3',
      dob: '2026-01-05',
      status: 'Current',
      idedNumber: 0,
      gene: null,
      notes: null,
      phenotypes: [],
      attributes: [],
      protocols: [],
      cryo: null,
      references: [],
    });
  });

  it('trims the name and text fields and turns blank text into null', () => {
    const { value } = ok({
      ...minimal,
      name: '  demo_021  ',
      gene: '  gli2  ',
      notes: '   ',
    });
    expect(value.name).toBe('demo_021');
    expect(value.gene).toBe('gli2');
    expect(value.notes).toBeNull();
  });
});

describe('validateNewLine: identity and generation errors (BR-8, FR-NEW-02)', () => {
  it('requires a name of 1–60 characters', () => {
    expect(errorsOf({ ...minimal, name: '   ' }).name).toMatch(/Enter the line name/);
    expect(errorsOf({ ...minimal, name: undefined }).name).toMatch(/Enter the line name/);
    expect(errorsOf({ ...minimal, name: 'x'.repeat(61) }).name).toMatch(/at most 60/);
    expect(ok({ ...minimal, name: 'x'.repeat(60) }).value.name).toHaveLength(60);
  });

  it('requires a real DOB that is not in the future', () => {
    expect(errorsOf({ name: 'a' }).dob).toMatch(/Enter the date of birth/);
    expect(errorsOf({ name: 'a', dob: '' }).dob).toMatch(/Enter the date of birth/);
    expect(errorsOf({ name: 'a', dob: '2026-02-30' }).dob).toMatch(/YYYY-MM-DD/);
    expect(errorsOf({ name: 'a', dob: '2026-09-30' }).dob).toMatch(/cannot be in the future/);
    expect(ok({ name: 'a', dob: TODAY }).value.dob).toBe(TODAY);
  });

  it('accepts Current or Breeding only, and a whole non-negative IDed number', () => {
    expect(ok({ ...minimal, status: 'Breeding' }).value.status).toBe('Breeding');
    expect(errorsOf({ ...minimal, status: 'Closed' }).status).toMatch(/Current or Breeding/);
    expect(errorsOf({ ...minimal, idedNumber: -1 }).idedNumber).toMatch(/0 or more/);
    expect(errorsOf({ ...minimal, idedNumber: 1.5 }).idedNumber).toMatch(/whole number/);
    expect(errorsOf({ ...minimal, idedNumber: 'many' }).idedNumber).toMatch(/whole number/);
    expect(ok({ ...minimal, idedNumber: 12 }).value.idedNumber).toBe(12);
  });

  it('rejects text over its limit and reports a non-object body on the form', () => {
    expect(errorsOf({ ...minimal, gene: 'g'.repeat(201) }).gene).toMatch(/at most 200/);
    expect(errorsOf('nonsense').form).toBeDefined();
  });

  it('reports only the first message per field', () => {
    expect(Object.keys(errorsOf({ name: '', dob: '' }))).toEqual(['name', 'dob']);
  });
});

describe('validateNewLine: phenotypes, attributes, references', () => {
  it('trims phenotypes, drops empty and case-insensitive duplicates and keeps order', () => {
    const { value } = ok({
      ...minimal,
      phenotypes: [' curly tail ', '', 'Curly Tail', 'small eye'],
    });
    expect(value.phenotypes).toEqual(['curly tail', 'small eye']);
  });

  it('requires an attribute name and rejects the same name twice (any case)', () => {
    const errors = errorsOf({
      ...minimal,
      attributes: [
        { key: 'Source', value: 'REPOSITORY A' },
        { key: '', value: 'x' },
        { key: 'source', value: 'y' },
      ],
    });
    expect(errors['attributes.1.key']).toMatch(/Enter a name/);
    expect(errors['attributes.2.key']).toMatch(/only once/);
    expect(errors['attributes.0.key']).toBeUndefined();
  });

  it('keeps attributes with an empty value as null', () => {
    const { value } = ok({ ...minimal, attributes: [{ key: 'Source', value: '' }] });
    expect(value.attributes).toEqual([{ key: 'Source', value: null }]);
  });

  it('requires a reference title and an http(s) URL', () => {
    const errors = errorsOf({
      ...minimal,
      references: [
        { title: '', url: 'https://example.org/a' },
        { title: 'Paper', url: 'ftp://example.org' },
        { title: 'Paper', url: 'javascript:alert(1)' },
      ],
    });
    expect(errors['references.0.title']).toMatch(/Enter a title/);
    expect(errors['references.1.url']).toMatch(/http/);
    expect(errors['references.2.url']).toMatch(/http/);
    const { value } = ok({
      ...minimal,
      references: [{ title: 'Paper', url: 'https://www.dropbox.com/s/abc' }, { title: 'No link' }],
    });
    expect(value.references).toEqual([
      { title: 'Paper', url: 'https://www.dropbox.com/s/abc' },
      { title: 'No link', url: null },
    ]);
  });
});

describe('validateNewLine: protocols (FR-ID-03…07, BR-9)', () => {
  it('applies annealing 60 and cycles 35 only when omitted or blank', () => {
    const omitted = ok({
      ...minimal,
      protocols: [{ type: 'pcr', fields: { primer_f_name: 'F1' } }],
    });
    expect(omitted.value.protocols[0]).toEqual({
      type: 'pcr',
      label: 'PCR',
      fields: { primer_f_name: 'F1', annealing_c: 60, cycles: 35 },
      notes: null,
    });
    const blank = ok({
      ...minimal,
      protocols: [{ type: 'pcr', fields: { annealing_c: '', cycles: null } }],
    });
    expect(blank.value.protocols[0]?.fields).toEqual({ annealing_c: 60, cycles: 35 });
    const chosen = ok({
      ...minimal,
      protocols: [{ type: 'pcr', fields: { annealing_c: 0, cycles: 28 } }],
    });
    expect(chosen.value.protocols[0]?.fields).toEqual({ annealing_c: 0, cycles: 28 });
  });

  it('gives each type its default label unless one is typed', () => {
    const { value } = ok({
      ...minimal,
      protocols: [
        { type: 'none' },
        { type: 'tails', label: '  Fin clip  ', notes: 'Use 1 mm' },
        { type: 'pcr_sequence' },
        { type: 'fluorescence', fields: { fluorophore: 'GFP', screening_day: '1-2' } },
      ],
    });
    expect(value.protocols.map((protocol) => protocol.label)).toEqual([
      'None',
      'Fin clip',
      'PCR + Sequence',
      'Fluorescence',
    ]);
    expect(value.protocols[1]?.notes).toBe('Use 1 mm');
  });

  it('reports field errors under the protocol index and field name', () => {
    const errors = errorsOf({
      ...minimal,
      protocols: [
        { type: 'pcr', fields: { annealing_c: 'hot' } },
        { type: 'fluorescence', fields: { screening_day: '9' } },
        { type: 'tails', fields: { primer_f_name: 'not allowed' } },
      ],
    });
    expect(errors['protocols.0.fields.annealing_c']).toMatch(/number/);
    expect(errors['protocols.1.fields.screening_day']).toMatch(/0 to 7/);
    expect(errors['protocols.2.fields.primer_f_name']).toMatch(/not available/);
    expect(errorsOf({ ...minimal, protocols: [{ type: 'bogus' }] })['protocols.0.type']).toMatch(
      /Choose an ID method/,
    );
  });

  it('accepts a sequence with unusual characters but returns a warning', () => {
    const result = ok({
      ...minimal,
      protocols: [{ type: 'pcr', fields: { primer_f_seq: 'ACGT-XX' } }],
    });
    expect(result.warnings['protocols.0.fields.primer_f_seq']).toMatch(/nucleotide/);
  });

  it('cleans custom items: trims, drops empty rows, requires a name', () => {
    const { value } = ok({
      ...minimal,
      protocols: [
        {
          type: 'custom',
          fields: {
            items: [
              { key: ' Marker ', value: ' Tg(kdrl) ' },
              { key: '', value: '' },
              { key: 'Dose', value: '' },
            ],
          },
        },
      ],
    });
    expect(value.protocols[0]?.fields.items).toEqual([
      { key: 'Marker', value: 'Tg(kdrl)' },
      { key: 'Dose', value: '' },
    ]);
    const errors = errorsOf({
      ...minimal,
      protocols: [{ type: 'custom', fields: { items: [{ key: '', value: 'orphan' }] } }],
    });
    expect(errors['protocols.0.fields.items.0.key']).toMatch(/Enter a name/);
  });

  it('keeps a custom protocol with no items and ignores rows that are not objects', () => {
    expect(ok({ ...minimal, protocols: [{ type: 'custom' }] }).value.protocols[0]?.fields).toEqual(
      {},
    );
    const { value } = ok({
      ...minimal,
      protocols: [{ type: 'custom', fields: { items: ['text', null, { key: 'Dose' }] } }],
    });
    expect(value.protocols[0]?.fields.items).toEqual([{ key: 'Dose', value: '' }]);
  });
});

describe('validateNewLine: cryopreservation (FR-CRYO-01)', () => {
  it('accepts a full record and keeps the entered values', () => {
    const { value } = ok({
      ...minimal,
      cryo: {
        cryoDate: '2026-09-01',
        place: 'Demo freezer shelf',
        boxName: 'Demo cryo box-Bob',
        cryoIdStart: 'C0548',
        cryoIdEnd: 'C0551',
        count: 7,
        notes: 'good',
      },
    });
    expect(value.cryo).toMatchObject({
      place: 'Demo freezer shelf',
      count: 7,
      detailsUnknown: false,
    });
  });

  it('accepts "Details unknown" with nothing else', () => {
    expect(ok({ ...minimal, cryo: { detailsUnknown: true } }).value.cryo?.detailsUnknown).toBe(
      true,
    );
  });

  it('refuses an empty record that is not marked unknown', () => {
    expect(errorsOf({ ...minimal, cryo: {} }).cryo).toMatch(/at least one detail/);
  });

  it('validates the date, count and ID range', () => {
    expect(errorsOf({ ...minimal, cryo: { cryoDate: '2026-13-01' } })['cryo.cryoDate']).toMatch(
      /YYYY-MM-DD/,
    );
    expect(errorsOf({ ...minimal, cryo: { cryoDate: '2026-10-01' } })['cryo.cryoDate']).toMatch(
      /future/,
    );
    expect(errorsOf({ ...minimal, cryo: { place: 'x', count: -2 } })['cryo.count']).toMatch(
      /0 or more/,
    );
    expect(errorsOf({ ...minimal, cryo: { cryoIdStart: 'C0001' } })['cryo.cryoIdEnd']).toMatch(
      /both/,
    );
    expect(errorsOf({ ...minimal, cryo: { cryoIdEnd: 'C0509' } })['cryo.cryoIdStart']).toMatch(
      /both/,
    );
  });
});

describe('newLineMessages', () => {
  it('names the existing line in the duplicate-name message (BR-8)', () => {
    expect(newLineMessages.nameTaken('DEMO_C3')).toBe(
      'A line named "DEMO_C3" already exists (names are not case-sensitive). Use a different name.',
    );
  });
});

describe('validateNewLine: all problems at once', () => {
  it('reports schema, cross-field and protocol problems together, not in two rounds', () => {
    const errors = errorsOf({
      name: '',
      dob: '',
      idedNumber: 'many',
      attributes: [
        { key: 'A', value: '' },
        { key: 'a', value: '' },
      ],
      protocols: [{ type: 'pcr', fields: { annealing_c: 'hot' } }],
      cryo: { count: 'lots', place: 'x' },
    });
    expect(Object.keys(errors).sort()).toEqual([
      'attributes.1.key',
      'cryo.count',
      'dob',
      'idedNumber',
      'name',
      'protocols.0.fields.annealing_c',
    ]);
  });
});

describe('Admin-set protocol defaults (T-018, FR-ADM-03)', () => {
  it('fill what was left out instead of the built-in 60 °C / 35 cycles; explicit values win', () => {
    const minimal = {
      name: 'x',
      dob: '2026-01-01',
      protocols: [{ type: 'pcr', label: 'PCR', fields: {} }],
    };
    const result = validateNewLine(minimal, '2026-09-30', { annealing_c: 58, cycles: 30 });
    expect(result.ok && result.value.protocols[0]?.fields).toMatchObject({
      annealing_c: 58,
      cycles: 30,
    });
    const explicit = validateNewLine(
      { ...minimal, protocols: [{ type: 'pcr', label: 'PCR', fields: { annealing_c: 61 } }] },
      '2026-09-30',
      { annealing_c: 58 },
    );
    expect(explicit.ok && explicit.value.protocols[0]?.fields).toMatchObject({
      annealing_c: 61,
      cycles: 35,
    });
  });
});
