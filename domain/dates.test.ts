import { describe, expect, it } from 'vitest';
import { isIsoDate, labToday } from './dates';

describe('isIsoDate', () => {
  it('accepts a valid YYYY-MM-DD date', () => {
    expect(isIsoDate('2026-09-28')).toBe(true);
  });
  it('rejects a wrongly formatted string', () => {
    expect(isIsoDate('28/09/2026')).toBe(false);
  });
  it('rejects a date that does not exist', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
  });
});

describe('labToday', () => {
  it('uses the America/New_York calendar date, not UTC', () => {
    // 02:00 UTC on the 29th is still the evening of the 28th in New York.
    expect(labToday(new Date('2026-09-29T02:00:00Z'))).toBe('2026-09-28');
    expect(labToday(new Date('2026-09-29T15:00:00Z'))).toBe('2026-09-29');
  });
  it('defaults to now', () => {
    expect(labToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
