/** The month totals and the Notes & links block next to the calendar (T-034, FR-FEED-07, FR-FEED-08). */
import type { FeedingTotals } from '../feedingApi';
import { linkParts } from '../feedingView';
import { strings } from '../strings';

export function FeedingTotalsPanel({ totals }: { totals: FeedingTotals }) {
  return (
    <section className="feeding-totals" aria-labelledby="feeding-totals-title">
      <h2 id="feeding-totals-title">{strings.feedingTotals}</h2>
      {totals.byUser.length === 0 ? <p>{strings.feedingNoTotals}</p> : null}
      <ul>
        {totals.byUser.map((entry) => (
          <li key={entry.userId}>
            {strings.feedingTotalLine(entry.name, entry.total, entry.weekdays, entry.weekend)}
          </li>
        ))}
        {totals.unassigned > 0 ? (
          <li className="feeding-totals__unassigned">
            {strings.feedingUnassignedLine(totals.unassigned)}
          </li>
        ) : null}
      </ul>
    </section>
  );
}

export function FeedingNotesBlock({ notes }: { notes: string }) {
  if (notes.trim() === '') return null;
  return (
    <section className="feeding-notes" aria-labelledby="feeding-notes-title">
      <h2 id="feeding-notes-title">{strings.feedingNotesTitle}</h2>
      <p>
        {linkParts(notes).map((part, index) =>
          part.href === undefined ? (
            <span key={index}>{part.text}</span>
          ) : (
            <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
              {part.text}
            </a>
          ),
        )}
      </p>
    </section>
  );
}
