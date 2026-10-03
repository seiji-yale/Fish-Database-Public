/**
 * Breeding-cycle events for the Activity timeline (T-013, docs/04-ui-spec.md 5.5): Start Breeding,
 * Close and Reopen have no genotyping record, so they are read back from the line's history. Each
 * event belongs to the generation that was current when it happened; the generation is found by
 * walking the versions from newest to oldest and stepping back over every `generation_no` change.
 */
import { formatDateTime } from './dateFormat';
import type { LineDetailVersion } from './lineDetailApi';
import { strings } from './strings';

export interface TimelineEvent {
  key: string;
  generationNo: number;
  /** `YYYY-MM-DD`, used to place the event among the genotyping records. */
  date: string;
  text: string;
}

function change(version: LineDetailVersion, column: string) {
  return version.diff.find((entry) => entry.path === `line.${column}`);
}

function textAfter(version: LineDetailVersion, column: string): string | null {
  const after = change(version, column)?.after;
  return typeof after === 'string' ? after : null;
}

export function timelineEvents(
  versions: readonly LineDetailVersion[],
  currentGenerationNo: number,
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let generationNo = currentGenerationNo;
  for (const version of [...versions].sort((a, b) => b.versionNo - a.versionNo)) {
    const day = formatDateTime(version.createdAt).slice(0, 10);
    const base = { key: version.id, generationNo };
    if (version.changeType === 'breeding_started') {
      const date = textAfter(version, 'breeding_started_at') ?? day;
      events.push({ ...base, date, text: strings.timelineBreedingStarted });
    } else if (version.changeType === 'closed') {
      const date = textAfter(version, 'closed_at') ?? day;
      events.push({ ...base, date, text: strings.timelineClosed });
    } else if (version.changeType === 'reopened') {
      events.push({ ...base, date: day, text: strings.timelineReopened });
    }
    const before = change(version, 'generation_no')?.before;
    if (typeof before === 'number') generationNo = before;
  }
  return events;
}
