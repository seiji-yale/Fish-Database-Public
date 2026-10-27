/**
 * The month calendar of the Feeding Schedule (T-034, docs/08 §5.2 - §5.3): a Sunday-first table with a
 * button per day (name, `—`, or `Unassigned` with a warning mark for the next 14 days), and on phones an
 * optional List view. Nothing is shown by colour alone (NFR-01).
 */
import { monthGrid, weekdayName } from '../../../domain/feeding';
import type { FeedingDay, FeedingMonth } from '../feedingApi';
import { isUnassignedSoon, weekStartOf, type FeedingViewMode } from '../feedingView';
import { strings } from '../strings';
import { IconButton } from './Icons';

const COLUMN_HEADS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function whoText(day: FeedingDay, today: string): string {
  if (day.assignment !== null) return day.assignment.userName;
  return isUnassignedSoon(day, today) ? strings.feedingUnassigned : strings.feedingNone;
}

export function FeedingDayCell({
  day,
  today,
  canWrite,
  onOpen,
}: {
  day: FeedingDay;
  today: string;
  canWrite: boolean;
  onOpen: (date: string) => void;
}) {
  const soon = isUnassignedSoon(day, today);
  const isToday = day.date === today;
  const hasNote = (day.assignment?.note ?? '') !== '';
  const label = strings.feedingCell(
    strings.feedingDayTitle(day.weekday, day.date),
    day.assignment?.userName ?? (soon ? strings.feedingUnassigned : strings.feedingNobody),
  );
  const className = [
    'feeding-cell',
    isToday ? 'feeding-cell--today' : '',
    soon ? 'feeding-cell--soon' : '',
  ]
    .filter((name) => name !== '')
    .join(' ');
  const content = (
    <>
      <span className="feeding-cell__day">
        {Number(day.date.slice(8))}
        {isToday ? <span className="feeding-cell__today">{strings.feedingToday}</span> : null}
      </span>
      <span className="feeding-cell__who">
        {soon ? <span aria-hidden="true">{`${strings.feedingWarnIcon} `}</span> : null}
        {whoText(day, today)}
        {hasNote ? (
          <span className="feeding-cell__note" title={day.assignment?.note ?? ''}>
            <span aria-hidden="true">{` ${strings.feedingNoteIcon}`}</span>
            <span className="sr-only">{strings.feedingNoteMarker}</span>
          </span>
        ) : null}
      </span>
      {day.events.map((event) => (
        <span className="feeding-cell__event" key={event.id}>
          <span className="feeding-cell__event-label">{event.title}</span>
          <span className="feeding-cell__event-dot" aria-hidden="true">
            {strings.feedingTodayDot}
          </span>
        </span>
      ))}
    </>
  );
  return canWrite ? (
    <button
      type="button"
      className={className}
      aria-label={label}
      data-date={day.date}
      onClick={() => {
        onOpen(day.date);
      }}
    >
      {content}
    </button>
  ) : (
    <div className={className} role="group" aria-label={label} data-date={day.date}>
      {content}
    </div>
  );
}

export function FeedingCalendar({
  data,
  view,
  canWrite,
  onOpenDay,
  onRepeatWeek,
}: {
  data: FeedingMonth;
  view: FeedingViewMode;
  canWrite: boolean;
  onOpenDay: (date: string) => void;
  onRepeatWeek: (weekStart: string) => void;
}) {
  const byDate = new Map(data.days.map((day) => [day.date, day]));
  const weeks = monthGrid(data.month);
  const weekStarts = weeks.map((week) => {
    const first = week.find((cell) => cell !== null);
    return first === undefined ? '' : weekStartOf(first);
  });
  return (
    <>
      <table className="feeding-grid">
        <caption className="sr-only">{strings.feedingSchedule}</caption>
        <thead>
          <tr>
            {COLUMN_HEADS.map((head) => (
              <th scope="col" key={head}>
                {head}
              </th>
            ))}
            {canWrite ? (
              <th scope="col" className="feeding-grid__actions">
                <span className="sr-only">{strings.feedingWeekActions}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, weekIndex) => (
            <tr key={weekStarts[weekIndex]}>
              {week.map((date, column) => {
                const day = date === null ? undefined : byDate.get(date);
                return (
                  <td key={column} className={day === undefined ? 'feeding-grid__blank' : ''}>
                    {day === undefined ? null : (
                      <FeedingDayCell
                        day={day}
                        today={data.today}
                        canWrite={canWrite}
                        onOpen={onOpenDay}
                      />
                    )}
                  </td>
                );
              })}
              {canWrite ? (
                <td className="feeding-grid__actions">
                  <IconButton
                    icon="repeat"
                    label={`${strings.feedingRepeatWeek} (${strings.feedingWeekOf(weekStarts[weekIndex] ?? '')})`}
                    onClick={() => {
                      onRepeatWeek(weekStarts[weekIndex] ?? '');
                    }}
                  />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {view === 'list' ? (
        <div className="feeding-list">
          {weeks.map((week, weekIndex) => (
            <section
              key={weekStarts[weekIndex]}
              aria-label={strings.feedingWeekOf(weekStarts[weekIndex] ?? '')}
            >
              <div className="feeding-list__heading">
                <h3>{strings.feedingWeekOf(weekStarts[weekIndex] ?? '')}</h3>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => {
                      onRepeatWeek(weekStarts[weekIndex] ?? '');
                    }}
                  >
                    {strings.feedingRepeatWeek}
                  </button>
                ) : null}
              </div>
              <ul>
                {week.map((date) => {
                  const day = date === null ? undefined : byDate.get(date);
                  if (day === undefined) return null;
                  const text = [
                    `${weekdayName(day.date).slice(0, 3)} ${String(Number(day.date.slice(8)))}`,
                    whoText(day, data.today),
                    ...day.events.map((event) => event.title),
                  ].join(' · ');
                  const soon = isUnassignedSoon(day, data.today);
                  return (
                    <li key={day.date} className={day.date === data.today ? 'is-today' : ''}>
                      {canWrite ? (
                        <button
                          type="button"
                          className={soon ? 'feeding-row feeding-row--soon' : 'feeding-row'}
                          data-date={day.date}
                          onClick={() => {
                            onOpenDay(day.date);
                          }}
                        >
                          {soon ? (
                            <span aria-hidden="true">{`${strings.feedingWarnIcon} `}</span>
                          ) : null}
                          {text}
                          {day.date === data.today ? ` · ${strings.feedingToday}` : ''}
                          {(day.assignment?.note ?? '') !== '' ? (
                            <span aria-hidden="true">{` ${strings.feedingNoteIcon}`}</span>
                          ) : null}
                        </button>
                      ) : (
                        <span className="feeding-row" data-date={day.date}>
                          {text}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </>
  );
}
