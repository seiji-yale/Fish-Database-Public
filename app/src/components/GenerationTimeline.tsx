/**
 * Activity section, read view (T-009 Step 4, FR-HIST-04, docs/04-ui-spec.md §5.5): genotyping
 * records grouped per generation (newest generation first) under a
 * `Generation n · DOB … · Current` header, newest record first inside each group, each with the
 * running IDed total (BR-2 arithmetic in `domain/breeding.ts`) and its gel images. The
 * breeding-cycle events (Start Breeding, Close, ...) join this list with T-013.
 */
import { runningIdedTotals } from '../../../domain/breeding';
import { formatDate } from '../dateFormat';
import type { LineDetailGeneration, LineDetailGenotypingRecord } from '../lineDetailApi';
import { strings } from '../strings';
import type { TimelineEvent } from '../activityEvents';
import { AttachmentImages } from './Images';
import { EmptyState } from './shared';

function withTotals(records: readonly LineDetailGenotypingRecord[]) {
  // Oldest first for the arithmetic (the sort is stable for same-day records), newest first to show.
  const oldestFirst = [...records].sort((a, b) => a.recordDate.localeCompare(b.recordDate));
  const totals = runningIdedTotals(oldestFirst.map((record) => record.positiveCount));
  return oldestFirst.map((record, index) => ({ record, total: totals[index] ?? 0 })).reverse();
}

function GenotypingEntry({ record, total }: { record: LineDetailGenotypingRecord; total: number }) {
  return (
    <li className="timeline-entry">
      <p>
        <strong>{formatDate(record.recordDate)}</strong>
        {` ${
          record.protocolLabel === null
            ? strings.genotyping
            : strings.genotypingWithMethod(record.protocolLabel)
        } ${strings.positiveTotal(record.positiveCount, total)}`}
        {record.screenedCount === null ? '' : ` · ${strings.screenedCount(record.screenedCount)}`}
      </p>
      {record.isNewGeneration && record.newDob !== null ? (
        <p>
          <span className="chip">{strings.newGenerationRecord(formatDate(record.newDob))}</span>
        </p>
      ) : null}
      {record.notes === null ? null : <p>{record.notes}</p>}
      <AttachmentImages attachments={record.attachments} />
    </li>
  );
}

type TimelineItem =
  | { kind: 'record'; date: string; record: LineDetailGenotypingRecord; total: number }
  | { kind: 'event'; date: string; event: TimelineEvent };

/** Records (newest first, with running totals) and breeding events of one generation, by date. */
function itemsOf(
  records: readonly LineDetailGenotypingRecord[],
  events: readonly TimelineEvent[],
): TimelineItem[] {
  const items: TimelineItem[] = [
    ...withTotals(records).map(({ record, total }): TimelineItem => ({
      kind: 'record',
      date: record.recordDate,
      record,
      total,
    })),
    ...events.map((event): TimelineItem => ({ kind: 'event', date: event.date, event })),
  ];
  // Stable: same-day items keep the order above (records first), so totals stay in reading order.
  return items.sort((a, b) => b.date.localeCompare(a.date));
}

export function GenerationTimeline({
  generations,
  events = [],
  currentGenerationNo,
  currentDob = null,
}: {
  generations: readonly LineDetailGeneration[];
  events?: readonly TimelineEvent[];
  currentGenerationNo: number;
  currentDob?: string | null;
}) {
  // A generation with only events (no genotyping record yet) still gets its header.
  const shown: LineDetailGeneration[] = [...generations];
  for (const event of events) {
    if (!shown.some((generation) => generation.generationNo === event.generationNo))
      shown.push({
        generationNo: event.generationNo,
        dob: event.generationNo === currentGenerationNo ? currentDob : null,
        records: [],
      });
  }
  shown.sort((a, b) => b.generationNo - a.generationNo);
  if (shown.length === 0) return <EmptyState />;
  return (
    <div className="timeline">
      {shown.map((generation) => (
        <section key={generation.generationNo} className="timeline-generation">
          <h3>
            {strings.generationHeader(
              generation.generationNo,
              generation.dob === null ? strings.emptyValue : formatDate(generation.dob),
              generation.generationNo === currentGenerationNo,
            )}
          </h3>
          <ul>
            {itemsOf(
              generation.records,
              events.filter((event) => event.generationNo === generation.generationNo),
            ).map((item) =>
              item.kind === 'record' ? (
                <GenotypingEntry key={item.record.id} record={item.record} total={item.total} />
              ) : (
                <li key={item.event.key} className="timeline-entry timeline-entry--event">
                  <p>
                    <strong>{formatDate(item.event.date)}</strong>
                    {` ${item.event.text}`}
                  </p>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
