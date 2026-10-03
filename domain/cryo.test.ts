import { describe, expect, it } from 'vitest';
import { cryoRangeCount, isCryopreserved } from './cryo';

describe('isCryopreserved (BR-6)', () => {
  it('is false with zero live cryo records', () => {
    expect(isCryopreserved(0)).toBe(false);
  });

  it('is true with at least one live cryo record, including one with unknown details', () => {
    expect(isCryopreserved(1)).toBe(true);
    expect(isCryopreserved(3)).toBe(true);
  });
});

describe('cryoRangeCount (FR-CRYO-01)', () => {
  it('counts an inclusive range of IDs', () => {
    expect(cryoRangeCount('C0701', 'C0707')).toBe(7);
    expect(cryoRangeCount('c0001', 'C0001')).toBe(1);
  });

  it('returns null when a count cannot be derived', () => {
    expect(cryoRangeCount(null, 'C0551')).toBeNull();
    expect(cryoRangeCount('C0548', null)).toBeNull();
    expect(cryoRangeCount('C0548', 'X0072')).toBeNull();
    expect(cryoRangeCount('box A', 'C0551')).toBeNull();
    expect(cryoRangeCount('C0551', 'C0548')).toBeNull();
  });
});
