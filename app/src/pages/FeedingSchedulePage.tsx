/**
 * Feeding Schedule (T-034, docs/08 §3.1 - §3.3, §5): the month calendar, who feeds on which day, the month
 * totals, Notes & links, the Day dialog and Repeat this week. The month and the phone layout live in the
 * URL (`?month=2026-10&view=list`), so a page can be bookmarked; the page reads the month again whenever the
 * window regains focus (FR-FEED-09), unless a dialog is open.
 */
import { useCallback, useEffect, useState } from 'react';
import { FeedingCalendar } from '../components/FeedingCalendar';
import { FeedingDayDialog } from '../components/FeedingDayDialog';
import { FeedingNotesBlock, FeedingTotalsPanel } from '../components/FeedingPanels';
import { RepeatWeekDialog } from '../components/RepeatWeekDialog';
import { SegmentedControl, Skeleton, Toast } from '../components/shared';
import { getFeedingMonth, type FeedingDay, type FeedingMonth } from '../feedingApi';
import {
  feedingHref,
  readFeedingUrl,
  shiftMonth,
  withDay,
  type FeedingViewMode,
} from '../feedingView';
import { labToday } from '../../../domain/dates';
import { strings } from '../strings';
import { useActingUser } from '../useActingUser';

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${month}-01T12:00:00Z`));
}

export function FeedingSchedulePage() {
  const acting = useActingUser();
  const canWrite = acting.can('feeding.write');
  const [url, setUrl] = useState(() => readFeedingUrl(window.location.search));
  const [data, setData] = useState<FeedingMonth | null>(null);
  const [failed, setFailed] = useState(false);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [repeatWeek, setRepeatWeek] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const dialogOpen = openDate !== null || repeatWeek !== null;

  /** Reads a month; the answer is applied only if it is still the month on screen. */
  const fetchMonth = useCallback((month: string): Promise<FeedingMonth | null> => {
    return getFeedingMonth(month)
      .then((next) => {
        setData((current) => (current === null || current.month === next.month ? next : current));
        setFailed(false);
        return next;
      })
      .catch(() => null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getFeedingMonth(url.month)
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url.month, reloadKey]);

  useEffect(() => {
    if (dialogOpen) return;
    const refresh = () => {
      void fetchMonth(url.month);
    };
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
    };
  }, [fetchMonth, url.month, dialogOpen]);

  useEffect(() => {
    const onPop = () => {
      setUrl(readFeedingUrl(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
    };
  }, []);

  function go(month: string, view: FeedingViewMode = url.view) {
    window.history.pushState(null, '', feedingHref(month, view));
    setUrl({ month, view });
  }

  // While another month is loading, the old one is not shown as if it were the new one.
  const shown = data !== null && data.month === url.month ? data : null;
  const today = data?.today ?? labToday();
  const previous = shiftMonth(url.month, -1);
  const next = shiftMonth(url.month, 1);
  const openDay: FeedingDay | undefined = shown?.days.find((day) => day.date === openDate);

  return (
    <section className="feeding-page" data-view={url.view}>
      <div className="feeding-page__head">
        <h1>{strings.feedingSchedule}</h1>
        <button
          type="button"
          onClick={() => {
            go(today.slice(0, 7));
          }}
        >
          {strings.feedingToday}
        </button>
      </div>
      <nav className="feeding-nav" aria-label={strings.feedingMonthNav}>
        <button
          type="button"
          disabled={previous === null}
          onClick={() => {
            if (previous !== null) go(previous);
          }}
        >
          {strings.feedingPrevious}
        </button>
        <h2 className="sr-only feeding-nav__month" aria-live="polite">
          {monthLabel(url.month)}
        </h2>
        <input
          type="month"
          className="feeding-nav__picker"
          aria-label={strings.feedingMonthPicker}
          min="2000-01"
          max="2100-12"
          value={url.month}
          onChange={(event) => {
            if (/^\d{4}-\d{2}$/.test(event.target.value)) go(event.target.value);
          }}
        />
        <button
          type="button"
          disabled={next === null}
          onClick={() => {
            if (next !== null) go(next);
          }}
        >
          {strings.feedingNext}
        </button>
      </nav>
      <div className="feeding-view-toggle">
        <SegmentedControl
          label={strings.feedingViewLabel}
          options={[strings.feedingViewGrid, strings.feedingViewList]}
          value={url.view === 'list' ? strings.feedingViewList : strings.feedingViewGrid}
          onChange={(value) => {
            go(url.month, value === strings.feedingViewList ? 'list' : 'grid');
          }}
        />
      </div>
      {failed ? (
        <div role="alert">
          <p>{strings.feedingLoadError}</p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setReloadKey((key) => key + 1);
            }}
          >
            {strings.reload}
          </button>
        </div>
      ) : null}
      {shown === null && !failed ? <Skeleton lines={6} /> : null}
      {shown === null ? null : (
        <div className="feeding-layout">
          <div className="feeding-layout__calendar">
            <FeedingCalendar
              data={shown}
              view={url.view}
              canWrite={canWrite}
              onOpenDay={setOpenDate}
              onRepeatWeek={setRepeatWeek}
            />
          </div>
          <div className="feeding-layout__side">
            <FeedingTotalsPanel totals={shown.totals} />
          </div>
          <div className="feeding-layout__notes">
            <FeedingNotesBlock notes={shown.notes} />
          </div>
        </div>
      )}
      {shown !== null && openDay !== undefined ? (
        <FeedingDayDialog
          key={openDay.date}
          day={openDay}
          assignable={shown.assignable}
          canWrite={canWrite}
          onClose={() => {
            setOpenDate(null);
          }}
          onSaved={(saved, message) => {
            setData((current) => (current === null ? current : withDay(current, saved)));
            setOpenDate(null);
            setToast(message);
          }}
          onReload={async (date) => {
            const fresh = await fetchMonth(url.month);
            return fresh?.days.find((day) => day.date === date) ?? null;
          }}
        />
      ) : null}
      {shown !== null && repeatWeek !== null ? (
        <RepeatWeekDialog
          weekStart={repeatWeek}
          month={url.month}
          monthLabel={monthLabel(url.month)}
          onClose={() => {
            setRepeatWeek(null);
          }}
          onApplied={(counts) => {
            setRepeatWeek(null);
            setToast(strings.feedingRepeatDone(counts.filled, counts.kept, counts.replaced));
            void fetchMonth(url.month);
          }}
        />
      ) : null}
      {toast === null ? null : (
        <Toast
          message={toast}
          onClose={() => {
            setToast(null);
          }}
        />
      )}
    </section>
  );
}
