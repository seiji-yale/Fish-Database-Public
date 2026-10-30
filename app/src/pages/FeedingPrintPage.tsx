/**
 * The printable month (T-035, FR-FEED-18): title, the calendar with full names and event labels, the
 * totals, Notes & links and a footer. It lives outside the app shell like `/lines/:id/print`, and opens the
 * browser's print dialog, where "Save as PDF" makes the PDF (FR-EXP-01). Landscape, one page for the grid.
 */
import { useEffect, useState } from 'react';
import { monthGrid, weekdayName } from '../../../domain/feeding';
import { formatDateTime } from '../dateFormat';
import { getFeedingMonth, type FeedingMonth } from '../feedingApi';
import { feedingHref, readFeedingUrl } from '../feedingView';
import { strings } from '../strings';
import { useActingUser } from '../useActingUser';
import { NotAvailablePage } from './NotAvailablePage';
import { FeedingNotesBlock, FeedingTotalsPanel } from '../components/FeedingPanels';

function monthTitle(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

function PrintMonth({
  data,
  generatedAt,
  who,
}: {
  data: FeedingMonth;
  generatedAt: string;
  who: string;
}) {
  const byDate = new Map(data.days.map((day) => [day.date, day]));
  // The page is printed landscape; an `@page` rule only works when it is in the document.
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = '@page { size: landscape; margin: 0.4in; }';
    document.head.append(style);
    return () => {
      style.remove();
    };
  }, []);
  return (
    <main className="print-view feeding-print">
      <header className="print-header">
        <a className="print-return" href={feedingHref(data.month, 'grid')}>
          <span aria-hidden="true">{strings.backToLinesIcon}</span> {strings.feedingPrintReturn}
        </a>
        <p>{strings.appName}</p>
        <h1>{strings.feedingPrintTitle(monthTitle(data.month))}</h1>
      </header>
      <table className="feeding-print__grid">
        <thead>
          <tr>
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <th scope="col" key={index}>
                {weekdayName(`2026-10-${String(4 + index).padStart(2, '0')}`)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(data.month).map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((date, column) => {
                const day = date === null ? undefined : byDate.get(date);
                return (
                  <td key={column}>
                    {day === undefined ? null : (
                      <>
                        <div className="feeding-print__day">{Number(day.date.slice(8))}</div>
                        <div className="feeding-print__who">
                          {day.assignment?.userName ?? strings.feedingNone}
                        </div>
                        {day.events.map((event) => (
                          <div className="feeding-print__event" key={event.id}>
                            {event.title}
                          </div>
                        ))}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="feeding-print__below">
        <FeedingTotalsPanel totals={data.totals} />
        <FeedingNotesBlock notes={data.notes} linkOnly />
      </div>
      <footer className="print-footer">
        <span>{window.location.origin}</span>
        <span>{strings.feedingPrintGenerated(formatDateTime(generatedAt), who)}</span>
      </footer>
    </main>
  );
}

export function FeedingPrintPage() {
  const acting = useActingUser();
  const [data, setData] = useState<FeedingMonth | null>(null);
  const [failed, setFailed] = useState(false);
  const [generatedAt] = useState(() => new Date().toISOString());
  const month = readFeedingUrl(window.location.search).month;

  const canExport = acting.can('feeding.export');
  useEffect(() => {
    if (!canExport) return;
    let cancelled = false;
    getFeedingMonth(month)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [month, canExport]);

  useEffect(() => {
    if (data !== null) window.print();
  }, [data]);

  // The print route sits outside the app shell: until the session is read nobody can print.
  if (acting.name === null)
    return (
      <main className="print-view">
        <p>{strings.loading}</p>
      </main>
    );
  if (!canExport) return <NotAvailablePage />;
  if (failed)
    return (
      <main className="print-view">
        <p role="alert">{strings.feedingLoadError}</p>
      </main>
    );
  return data === null ? (
    <main className="print-view">
      <p>{strings.loading}</p>
    </main>
  ) : (
    <PrintMonth data={data} generatedAt={generatedAt} who={acting.name} />
  );
}
