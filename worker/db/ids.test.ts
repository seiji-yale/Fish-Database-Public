import { describe, expect, it } from 'vitest';
import { newId, nowIso } from './ids';

describe('newId', () => {
  it('is a 26-character Crockford base-32 ULID', () => {
    expect(newId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('encodes the time so that later ids sort after earlier ones', () => {
    const earlier = newId(Date.parse('2026-09-28T00:00:00Z'));
    const later = newId(Date.parse('2026-09-28T00:00:01Z'));
    expect(later > earlier).toBe(true);
    expect(earlier.slice(0, 10)).toBe(newId(Date.parse('2026-09-28T00:00:00Z')).slice(0, 10));
  });

  it('does not repeat within one millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId(1_800_000_000_000)));
    expect(ids.size).toBe(1000);
  });
});

describe('nowIso', () => {
  it('formats UTC without milliseconds', () => {
    expect(nowIso(new Date('2026-09-25T19:12:00.987Z'))).toBe('2026-09-25T19:12:00Z');
  });
});
