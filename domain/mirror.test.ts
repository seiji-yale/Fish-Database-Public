import { describe, expect, it } from 'vitest';
import { archivesToPrune, isMirrorStale, nextMirrorRun, type MirrorState } from './mirror';

// 2026-10-05 is in daylight time: 15:00Z = 11:00 New York, 05:00Z = 01:00, 07:00Z = 03:00.
const at = (iso: string) => new Date(iso);
const base = (changes: Partial<MirrorState>): MirrorState => ({
  now: at('2026-10-05T15:00:00Z'),
  dirtyAt: null,
  lastFailedAt: null,
  lastNightlyDay: '2026-10-05',
  ...changes,
});

describe('nextMirrorRun', () => {
  it('does nothing without a change', () => {
    expect(nextMirrorRun(base({}))).toBeNull();
  });
  it('waits two minutes after the first write, then runs once', () => {
    expect(nextMirrorRun(base({ dirtyAt: '2026-10-05T14:59:00Z' }))).toBeNull();
    expect(nextMirrorRun(base({ dirtyAt: '2026-10-05T14:58:00Z' }))).toBe('on_change');
  });
  it('runs the nightly export after 03:00 lab time when today has none', () => {
    const night = base({ now: at('2026-10-05T07:00:00Z'), lastNightlyDay: '2026-10-04' });
    expect(nextMirrorRun(night)).toBe('nightly');
    expect(nextMirrorRun({ ...night, lastNightlyDay: null })).toBe('nightly');
  });
  it('does not run the nightly export before 03:00 or twice a day', () => {
    expect(
      nextMirrorRun(base({ now: at('2026-10-05T05:00:00Z'), lastNightlyDay: '2026-10-04' })),
    ).toBeNull();
    expect(nextMirrorRun(base({ now: at('2026-10-05T07:00:00Z') }))).toBeNull();
  });
  it('uses the lab day, not the UTC day', () => {
    // 2026-10-06 02:30Z is still 22:30 on 2026-10-05 in New York.
    expect(
      nextMirrorRun(base({ now: at('2026-10-06T02:30:00Z'), lastNightlyDay: '2026-10-05' })),
    ).toBeNull();
  });
  it('waits five minutes after a failure', () => {
    const dirty = '2026-10-05T14:00:00Z';
    expect(
      nextMirrorRun(base({ dirtyAt: dirty, lastFailedAt: '2026-10-05T14:56:00Z' })),
    ).toBeNull();
    expect(nextMirrorRun(base({ dirtyAt: dirty, lastFailedAt: '2026-10-05T14:54:00Z' }))).toBe(
      'on_change',
    );
  });
});

describe('archivesToPrune', () => {
  it('keeps 90 days and ignores names that are not dates', () => {
    const now = at('2026-10-05T15:00:00Z'); // 90 days back is 2026-07-07: that day is kept
    expect(
      archivesToPrune(['2026-07-06', '2026-07-07', '2026-01-01', 'notes', '2026-07-4'], now),
    ).toEqual(['2026-07-06', '2026-01-01']);
    expect(archivesToPrune(['2026-10-01', '2026-10-04'], now, 3)).toEqual(['2026-10-01']);
  });
});

describe('isMirrorStale', () => {
  const now = at('2026-10-05T15:00:00Z');
  it('is quiet before the mirror was ever set up', () => {
    expect(isMirrorStale(null, null, now)).toBe(false);
  });
  it('warns after a failed run', () => {
    expect(isMirrorStale('2026-10-05T14:00:00Z', 'Dropbox said no', now)).toBe(true);
    expect(isMirrorStale(null, 'Dropbox said no', now)).toBe(true);
  });
  it('warns when nothing succeeded for more than 24 hours', () => {
    expect(isMirrorStale('2026-10-04T15:01:00Z', null, now)).toBe(false);
    expect(isMirrorStale('2026-10-04T14:59:00Z', null, now)).toBe(true);
  });
});
