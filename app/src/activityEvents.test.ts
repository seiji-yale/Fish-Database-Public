import { describe, expect, it } from 'vitest';
import { timelineEvents } from './activityEvents';
import type { LineDetailVersion } from './lineDetailApi';

function version(
  versionNo: number,
  changeType: string,
  diff: LineDetailVersion['diff'] = [],
  createdAt = '2026-08-20T15:00:00Z',
): LineDetailVersion {
  return {
    id: `v${String(versionNo)}`,
    versionNo,
    changeType,
    summary: '',
    note: null,
    createdAt,
    createdByName: 'Bob',
    viaAdmin: false,
    diff,
  };
}

describe('timelineEvents', () => {
  it('reads the cross date, the closed date and the day of a reopen', () => {
    const events = timelineEvents(
      [
        version(1, 'imported'),
        version(2, 'breeding_started', [
          { path: 'line.breeding_started_at', before: null, after: '2026-06-01' },
        ]),
        version(3, 'closed', [{ path: 'line.closed_at', before: null, after: '2026-07-02' }]),
        version(4, 'reopened', []),
        version(5, 'edited', [{ path: 'line.gene', before: null, after: 'g' }]),
      ],
      1,
    );
    expect(events.map((event) => [event.date, event.text])).toEqual([
      ['2026-08-20', 'Line reopened'],
      ['2026-07-02', 'Line closed'],
      ['2026-06-01', 'Breeding started'],
    ]);
  });

  it('puts each event into the generation that was current at the time', () => {
    const events = timelineEvents(
      [
        version(2, 'breeding_started', [
          { path: 'line.breeding_started_at', before: null, after: '2026-01-10' },
        ]),
        version(3, 'genotyping_new_gen', [
          { path: 'line.generation_no', before: 1, after: 2 },
          { path: 'line.status', before: 'Breeding', after: 'Current' },
        ]),
        version(4, 'breeding_started', []),
      ],
      2,
    );
    expect(events.map((event) => [event.generationNo, event.date])).toEqual([
      [2, '2026-08-20'],
      [1, '2026-01-10'],
    ]);
  });
});
