import { describe, expect, it } from 'vitest';
import { validateNewLine } from '../../domain/newLine';
import {
  buildNewLinePayload,
  fieldDomId,
  initialFormState,
  isDirty,
  newProtocolDraft,
  nextEntryState,
} from './newLineForm';

const TODAY = '2026-09-29';

describe('buildNewLinePayload', () => {
  it('turns an untouched form into a payload the shared schema rejects only for the missing name and DOB', () => {
    const result = validateNewLine(buildNewLinePayload(initialFormState()), TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(['name', 'dob']);
  });

  it('sends numbers as numbers, keeps the 60/35 defaults and drops fields the type does not have', () => {
    const form = initialFormState();
    form.name = 'demo_c3';
    form.dob = '2026-01-05';
    form.idedNumber = ' 3 ';
    const pcr = {
      ...newProtocolDraft('pcr'),
      fields: { primer_f_name: 'F1', annealing_c: '58.5', cycles: '30', seq_primer: 'ignored' },
    };
    form.protocols = [pcr];
    const result = validateNewLine(buildNewLinePayload(form), TODAY);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.value.idedNumber).toBe(3);
    expect(result.value.protocols[0]?.fields).toEqual({
      primer_f_name: 'F1',
      annealing_c: 58.5,
      cycles: 30,
    });
  });

  it('starts a PCR draft with annealing 60 and cycles 35 filled in', () => {
    const draft = newProtocolDraft('pcr');
    expect(draft.fields).toMatchObject({ annealing_c: '60', cycles: '35' });
    const form = { ...initialFormState(), name: 'a', dob: '2026-01-01', protocols: [draft] };
    const result = validateNewLine(buildNewLinePayload(form), TODAY);
    expect(result.ok && result.value.protocols[0]?.fields).toEqual({ annealing_c: 60, cycles: 35 });
  });

  it('passes text that is not a number through so the API can say "Enter a number."', () => {
    const form = initialFormState();
    form.idedNumber = 'many';
    form.protocols = [{ ...newProtocolDraft('pcr'), fields: { annealing_c: 'hot' } }];
    form.cryoMode = 'add';
    form.cryo.count = 'lots';
    const payload = buildNewLinePayload(form);
    expect(payload['idedNumber']).toBe('many');
    expect((payload['cryo'] as { count: unknown }).count).toBe('lots');
    const result = validateNewLine({ ...payload, name: 'a', dob: '2026-01-01' }, TODAY);
    if (result.ok) throw new Error('expected errors');
    expect(result.errors['protocols.0.fields.annealing_c']).toBe('Enter a number.');
    expect(result.errors['idedNumber']).toBeDefined();
    expect(result.errors['cryo.count']).toBeDefined();
  });

  it('treats an empty IDed number as 0 and an empty count as absent', () => {
    const form = initialFormState();
    form.idedNumber = '  ';
    form.cryoMode = 'add';
    form.cryo.detailsUnknown = true;
    const payload = buildNewLinePayload(form);
    expect(payload['idedNumber']).toBe(0);
    expect((payload['cryo'] as { count: unknown }).count).toBeNull();
  });

  it('sends cryo only when "Add first record" is chosen, and a count as a number', () => {
    const form = initialFormState();
    expect(buildNewLinePayload(form)['cryo']).toBeNull();
    form.cryoMode = 'add';
    form.cryo.count = '7';
    expect((buildNewLinePayload(form)['cryo'] as { count: unknown }).count).toBe(7);
  });

  it('splits sequence result links by line and sends custom rows', () => {
    const form = initialFormState();
    form.protocols = [
      {
        ...newProtocolDraft('pcr_sequence'),
        fields: { seq_result_urls: ' https://a.example \n\n https://b.example ' },
      },
      { ...newProtocolDraft('custom'), items: [{ key: 'Marker', value: 'kdrl' }] },
    ];
    const protocols = buildNewLinePayload(form)['protocols'] as {
      fields: Record<string, unknown>;
    }[];
    expect(protocols[0]?.fields['seq_result_urls']).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(protocols[1]?.fields).toEqual({ items: [{ key: 'Marker', value: 'kdrl' }] });
  });

  it('sends an empty link list when the sequence-links field was never touched', () => {
    const form = initialFormState();
    form.protocols = [newProtocolDraft('pcr_sequence')];
    const [protocol] = buildNewLinePayload(form)['protocols'] as {
      fields: Record<string, unknown>;
    }[];
    expect(protocol?.fields['seq_result_urls']).toEqual([]);
  });
});

describe('nextEntryState (FR-NEW-04)', () => {
  it('keeps the ID method type and the attribute names, clears everything else', () => {
    const form = initialFormState();
    form.name = 'first';
    form.gene = 'g';
    form.dob = '2026-01-01';
    form.phenotypes = ['x'];
    form.attributes = [
      { key: 'Source', value: 'REPOSITORY A' },
      { key: '  ', value: 'orphan' },
    ];
    form.protocols = [newProtocolDraft('fluorescence')];
    form.cryoMode = 'add';
    const next = nextEntryState(form);
    expect(next).toMatchObject({
      name: '',
      gene: '',
      dob: '',
      phenotypes: [],
      attributes: [{ key: 'Source', value: '' }],
      cryoMode: 'none',
      idedNumber: '0',
    });
    expect(next.protocols).toHaveLength(1);
    expect(next.protocols[0]?.type).toBe('fluorescence');
  });

  it('falls back to None when the previous form had no protocol', () => {
    const form = { ...initialFormState(), protocols: [] };
    expect(nextEntryState(form).protocols[0]?.type).toBe('none');
  });
});

describe('isDirty', () => {
  it('ignores the protocol drafts’ React keys and notices any typed value', () => {
    const baseline = initialFormState();
    expect(isDirty(initialFormState(), baseline)).toBe(false);
    expect(isDirty({ ...baseline, name: 'x' }, baseline)).toBe(true);
  });
});

describe('fieldDomId', () => {
  it('maps every error path to the id of its input', () => {
    expect(fieldDomId('name')).toBe('nl-name');
    expect(fieldDomId('dob')).toBe('nl-dob');
    expect(fieldDomId('attributes.2.key')).toBe('nl-attr-2-key');
    expect(fieldDomId('references.1.url')).toBe('nl-ref-1-url');
    expect(fieldDomId('protocols.0.fields.primer_f_name')).toBe('nl-p-0-primer_f_name');
    expect(fieldDomId('protocols.1.fields.items.3.key')).toBe('nl-p-1-items-3-key');
    expect(fieldDomId('protocols.0.label')).toBe('nl-p-0-label');
    expect(fieldDomId('cryo')).toBe('nl-cryo-choice');
    expect(fieldDomId('cryo.cryoDate')).toBe('nl-cryo-cryoDate');
  });
});
