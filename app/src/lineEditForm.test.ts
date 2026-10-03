import { describe, expect, it } from 'vitest';
import { validateLineEdit } from '../../domain/lineEdit';
import type { LineDetailDocument } from './lineDetailApi';
import { buildEditPayload, editFieldDomId, editFormFrom, editIsDirty } from './lineEditForm';

const line = {
  name: 'demo_c3',
  gene: null,
  dob: null,
  notes: 'n',
  phenotypes: [{ id: 'p1', description: 'curly' }],
  attributes: [
    { id: 'a1', key: 'Source', value: 'REPOSITORY A' },
    { id: 'a2', key: 'Box', value: null },
  ],
} as unknown as LineDetailDocument;

describe('editFormFrom', () => {
  it('turns missing values into empty text and starts with no reason', () => {
    expect(editFormFrom(line)).toEqual({
      name: 'demo_c3',
      gene: '',
      dob: '',
      notes: 'n',
      phenotypes: ['curly'],
      attributes: [
        { key: 'Source', value: 'REPOSITORY A' },
        { key: 'Box', value: '' },
      ],
      reason: '',
    });
  });
});

describe('buildEditPayload', () => {
  it('sends only the version and reason when nothing changed', () => {
    const original = editFormFrom(line);
    expect(buildEditPayload({ ...original }, original, 4)).toEqual({
      expectedVersion: 4,
      note: '',
    });
  });

  it('sends only the changed fields, so an imported line without DOB can still be edited', () => {
    const original = editFormFrom(line);
    const form = { ...original, gene: 'gli2', reason: 'typo' };
    const payload = buildEditPayload(form, original, 2);
    expect(payload).toEqual({ expectedVersion: 2, note: 'typo', gene: 'gli2' });
    expect(validateLineEdit(payload, '2026-09-29').ok).toBe(true);
  });

  it('sends every kind of field when each changed', () => {
    const original = editFormFrom(line);
    const form = {
      ...original,
      name: 'new',
      dob: '2026-01-02',
      notes: '',
      phenotypes: ['a'],
      attributes: [],
    };
    expect(Object.keys(buildEditPayload(form, original, 1)).sort()).toEqual([
      'attributes',
      'dob',
      'expectedVersion',
      'name',
      'note',
      'notes',
      'phenotypes',
    ]);
  });
});

describe('editIsDirty and editFieldDomId', () => {
  it('notices any change, including only a reason', () => {
    const original = editFormFrom(line);
    expect(editIsDirty({ ...original }, original)).toBe(false);
    expect(editIsDirty({ ...original, reason: 'x' }, original)).toBe(true);
  });

  it('maps error paths to input ids', () => {
    expect(editFieldDomId('name')).toBe('el-name');
    expect(editFieldDomId('note')).toBe('el-note');
    expect(editFieldDomId('attributes.2.key')).toBe('el-attr-2-key');
  });
});
