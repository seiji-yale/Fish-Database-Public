import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from './dateFormat';

describe('date display (AGENTS.md 4: America/New_York)', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(formatDate('2026-01-08')).toBe('2026-01-08');
  });
  it('formats a timestamp as YYYY-MM-DD HH:mm with no comma, in summer and winter time', () => {
    expect(formatDateTime('2026-06-30T18:02:00Z')).toBe('2026-06-30 14:02');
    expect(formatDateTime('2026-01-05T05:07:00Z')).toBe('2026-01-05 00:07');
  });
});
