import { describe, expect, it } from 'vitest';
import { descriptiveFromSnapshot, validateLineEdit } from './lineEdit';

const TODAY = '2026-09-29';

function ok(input: unknown) {
  const result = validateLineEdit(input, TODAY);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.value;
}
function errorsOf(input: unknown): Record<string, string> {
  const result = validateLineEdit(input, TODAY);
  if (result.ok) throw new Error('expected errors');
  return result.errors;
}

describe('validateLineEdit', () => {
  it('needs the version the form was opened with (BR-12)', () => {
    expect(errorsOf({ gene: 'x' }).expectedVersion).toMatch(/Reload/);
    expect(errorsOf({ expectedVersion: 0 }).expectedVersion).toMatch(/Reload/);
    expect(errorsOf({ expectedVersion: '2' }).expectedVersion).toMatch(/Reload/);
    expect(ok({ expectedVersion: 1 })).toEqual({ expectedVersion: 1, note: null, changes: {} });
  });

  it('returns only the fields that were sent', () => {
    expect(ok({ expectedVersion: 3, gene: '  gli2  ' }).changes).toEqual({ gene: 'gli2' });
  });

  it('clears text with blank or null and keeps omitted fields out', () => {
    const { changes } = ok({ expectedVersion: 1, gene: '', notes: null });
    expect(changes).toEqual({ gene: null, notes: null });
    expect('name' in changes).toBe(false);
  });

  it('carries the optional reason', () => {
    expect(ok({ expectedVersion: 1, note: '  typo  ' }).note).toBe('typo');
    expect(ok({ expectedVersion: 1, note: '' }).note).toBeNull();
    expect(errorsOf({ expectedVersion: 1, note: 'x'.repeat(501) }).note).toMatch(/at most 500/);
  });

  it('applies the same name rules as New Line (BR-8)', () => {
    expect(errorsOf({ expectedVersion: 1, name: '  ' }).name).toMatch(/Enter the line name/);
    expect(errorsOf({ expectedVersion: 1, name: 'x'.repeat(61) }).name).toMatch(/at most 60/);
    expect(ok({ expectedVersion: 1, name: ' new name ' }).changes.name).toBe('new name');
  });

  it('validates DOB (real date, not in the future) and does not allow clearing it', () => {
    expect(errorsOf({ expectedVersion: 1, dob: '2999-01-01' }).dob).toMatch(/future/);
    expect(errorsOf({ expectedVersion: 1, dob: '2026-02-30' }).dob).toMatch(/YYYY-MM-DD/);
    expect(errorsOf({ expectedVersion: 1, dob: '' }).dob).toMatch(/Enter the date of birth/);
    expect(ok({ expectedVersion: 1, dob: '2026-01-05' }).changes.dob).toBe('2026-01-05');
  });

  it('cleans phenotypes and checks attributes', () => {
    const { changes } = ok({
      expectedVersion: 1,
      phenotypes: [' a ', 'A', '', 'b'],
      attributes: [{ key: 'Source', value: '' }],
    });
    expect(changes.phenotypes).toEqual(['a', 'b']);
    expect(changes.attributes).toEqual([{ key: 'Source', value: null }]);
    const errors = errorsOf({
      expectedVersion: 1,
      attributes: [{ key: 'A' }, { key: 'a' }, { key: '' }],
    });
    expect(errors['attributes.1.key']).toMatch(/only once/);
    expect(errors['attributes.2.key']).toMatch(/Enter a name/);
  });

  it('reports a non-object body on the form', () => {
    expect(errorsOf('nope').form).toBeDefined();
  });
});

describe('descriptiveFromSnapshot (FR-HIST-02)', () => {
  it('reads the document written by every write path', () => {
    expect(
      descriptiveFromSnapshot({
        line: { name: 'demo_c3', gene: 'g', notes: null, dob: '2026-01-05', status: 'Current' },
        phenotypes: [{ description: 'curly tail' }, { description: 5 }],
        attributes: [
          { key: 'Source', value: 'REPOSITORY A' },
          { key: 'Empty', value: null },
          { value: 'x' },
        ],
        protocols: [],
      }),
    ).toEqual({
      name: 'demo_c3',
      gene: 'g',
      notes: null,
      dob: '2026-01-05',
      phenotypes: ['curly tail'],
      attributes: [
        { key: 'Source', value: 'REPOSITORY A' },
        { key: 'Empty', value: null },
      ],
    });
  });

  it('tolerates missing lists in a document snapshot', () => {
    expect(descriptiveFromSnapshot({ line: { name: 'a' } })).toEqual({
      name: 'a',
      gene: null,
      notes: null,
      dob: null,
      phenotypes: [],
      attributes: [],
    });
  });

  it('reads the flat snapshot the Excel import wrote for version 1', () => {
    expect(
      descriptiveFromSnapshot({
        name: 'DEMO_E5',
        gene: 'demo_e5',
        notes: 'n',
        dob: '2025-01-11',
        phenotypes: ['a', 3, 'b'],
        source_attribute: 'REPOSITORY A',
      }),
    ).toEqual({
      name: 'DEMO_E5',
      gene: 'demo_e5',
      notes: 'n',
      dob: '2025-01-11',
      phenotypes: ['a', 'b'],
      attributes: [{ key: 'Source', value: 'REPOSITORY A' }],
    });
    expect(descriptiveFromSnapshot({ name: 'x' })).toMatchObject({
      phenotypes: [],
      attributes: [],
    });
  });

  it('returns null for a shape it does not know', () => {
    expect(descriptiveFromSnapshot(null)).toBeNull();
    expect(descriptiveFromSnapshot([])).toBeNull();
    expect(descriptiveFromSnapshot({})).toBeNull();
    expect(descriptiveFromSnapshot({ line: { gene: 'x' } })).toBeNull();
  });
});

describe('descriptiveFromSnapshot: fixture-loaded lines', () => {
  it('reads attributes kept as rows instead of source_attribute', () => {
    expect(
      descriptiveFromSnapshot({
        name: 'y',
        attributes: [{ key: 'Source', value: 'REPOSITORY A' }, 'junk', { value: 'no key' }],
      })?.attributes,
    ).toEqual([{ key: 'Source', value: 'REPOSITORY A' }]);
  });
});
