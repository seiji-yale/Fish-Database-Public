import { describe, expect, it } from 'vitest';
import { referenceMessages, validateReference } from './referenceEdit';

const base = { expectedVersion: 2 };

describe('validateReference', () => {
  it('accepts a title with a link, or with a staged file', () => {
    expect(validateReference({ ...base, title: ' ZFIN ', url: 'https://zfin.org' })).toEqual({
      ok: true,
      value: {
        expectedVersion: 2,
        title: 'ZFIN',
        url: 'https://zfin.org',
        attachmentId: null,
        keepFile: false,
        note: null,
      },
    });
    expect(
      validateReference({ ...base, title: 'PDF', attachmentId: 'a1', note: 'n' }),
    ).toMatchObject({
      ok: true,
      value: { attachmentId: 'a1', url: null, note: 'n' },
    });
  });

  it('lets an edit keep the file the reference already has', () => {
    expect(validateReference({ ...base, title: 'Renamed' }, true)).toMatchObject({
      ok: true,
      value: { keepFile: true },
    });
    expect(
      validateReference({ ...base, title: 'Now a link', url: 'https://x.example' }, true),
    ).toMatchObject({
      ok: true,
      value: { keepFile: false },
    });
  });

  it('reports each problem on its field', () => {
    const errors = (input: unknown, hasFile = false) => {
      const result = validateReference(input, hasFile);
      return result.ok ? {} : result.errors;
    };
    expect(errors({ ...base, title: '', url: 'https://x.example' })).toHaveProperty('title');
    expect(errors({ ...base, title: 'x' })).toEqual({ url: referenceMessages.linkOrFile });
    expect(errors({ ...base, title: 'x', url: 'ftp://x' })).toHaveProperty('url');
    expect(errors({ ...base, title: 'x', url: 'https://x.example', attachmentId: 'a' })).toEqual({
      url: referenceMessages.notBoth,
    });
    expect(errors({ expectedVersion: 0, title: 'x', url: 'https://x.example' })).toHaveProperty(
      'expectedVersion',
    );
    expect(Object.keys(errors(3))).toEqual(['form']);
  });
});
