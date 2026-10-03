import { describe, expect, it } from 'vitest';
import { currentProtocols, primaryAfter } from './currentProtocols';

const rows = [
  { id: 'a', sort_order: 0, is_current: 0 },
  { id: 'b', sort_order: 1, is_current: 1 },
  { id: 'c', sort_order: 2, is_current: 1 },
];

describe('currentProtocols', () => {
  it('lists the flagged methods in order, primary first', () => {
    expect(currentProtocols('c', rows).map((row) => row.id)).toEqual(['c', 'b']);
    expect(currentProtocols(null, rows).map((row) => row.id)).toEqual(['b', 'c']);
  });

  it('counts the primary pointer of an older line that has no flag yet', () => {
    expect(currentProtocols('a', rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(currentProtocols('a', [{ id: 'a', sort_order: 0, is_current: 0 }])).toHaveLength(1);
  });

  it('is empty when nothing is current', () => {
    expect(currentProtocols(null, [{ id: 'a', sort_order: 0, is_current: 0 }])).toEqual([]);
  });
});

describe('primaryAfter', () => {
  it('keeps a primary that is still current, else takes the first current, else none', () => {
    expect(primaryAfter('b', [{ id: 'a' }, { id: 'b' }])).toBe('b');
    expect(primaryAfter('x', [{ id: 'a' }, { id: 'b' }])).toBe('a');
    expect(primaryAfter(null, [{ id: 'a' }])).toBe('a');
    expect(primaryAfter('a', [])).toBeNull();
  });
});
