import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import { EmptyState, Skeleton } from '../components/shared';
import { formatDate, formatDateTime, formatRelativeTime } from '../dateFormat';
import {
  getDashboard,
  getMoreActivities,
  markAllChatRead,
  type DashboardActivity,
  type DashboardResponse,
} from '../dashboardApi';
import { strings } from '../strings';
import { ChatPanel } from '../components/ChatPanel';
import { CHAT_STATE_CHANGED, markChatRead, notifyChatStateChanged } from '../chatApi';
import { useActingUser } from '../useActingUser';

function activityLabel(item: DashboardActivity): string {
  return strings.activityBy(item.userName, formatRelativeTime(item.createdAt));
}

function userInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

/** One button under Currently Breeding opens this: choose the line whose genotyping to update. */
function PickLineDialog({
  lines,
  onClose,
}: {
  lines: readonly { id: string; name: string }[];
  onClose: () => void;
}) {
  const [lineId, setLineId] = useState(lines[0]?.id ?? '');
  return (
    <Modal
      title={strings.updateGenotyping}
      titleId="pick-line-title"
      onClose={onClose}
      initialFocus="#pick-line"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          window.location.href = `/lines/${encodeURIComponent(lineId)}?action=update-genotyping`;
        }}
      >
        <label htmlFor="pick-line">{strings.pickLineLabel}</label>
        <select
          id="pick-line"
          value={lineId}
          onChange={(event) => {
            setLineId(event.target.value);
          }}
        >
          {lines.map((line) => (
            <option key={line.id} value={line.id}>
              {line.name}
            </option>
          ))}
        </select>
        <div className="dialog__actions">
          <button type="button" onClick={onClose}>
            {strings.cancel}
          </button>
          <button type="submit" className="button--primary">
            {strings.pickLineContinue}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DashboardContent({ initial }: { initial: DashboardResponse }) {
  const acting = useActingUser();
  const [pickingLine, setPickingLine] = useState(false);
  // Lab Chat sits beside Recent Activity on wide screens, open; on a phone it stays folded.
  const [wideScreen] = useState(() => window.matchMedia('(min-width: 960px)').matches);
  const [data, setData] = useState(initial);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activityError, setActivityError] = useState(false);
  const activityListRef = useRef<HTMLOListElement>(null);
  const [markingUnreadId, setMarkingUnreadId] = useState<string | null>(null);
  const [markingAllUnread, setMarkingAllUnread] = useState(false);
  const [unreadError, setUnreadError] = useState(false);

  const markUnreadRead = async (id: string) => {
    setMarkingUnreadId(id);
    setUnreadError(false);
    try {
      await markChatRead(id);
      notifyChatStateChanged();
    } catch {
      setUnreadError(true);
    } finally {
      setMarkingUnreadId(null);
    }
  };

  const markAllUnreadRead = async () => {
    setMarkingAllUnread(true);
    setUnreadError(false);
    try {
      await markAllChatRead();
      notifyChatStateChanged();
    } catch {
      setUnreadError(true);
    } finally {
      setMarkingAllUnread(false);
    }
  };

  /** Recent Activity scrolls like Lab Chat: the next page is fetched when the list is scrolled near its end. */
  const loadMore = useCallback(async () => {
    if (loadingMore || data.recentActivity.nextBefore === null) return;
    setLoadingMore(true);
    setActivityError(false);
    try {
      const page = await getMoreActivities(data.recentActivity.nextBefore);
      setData((current) => ({
        ...current,
        recentActivity: {
          items: [...current.recentActivity.items, ...page.items],
          nextBefore: page.nextBefore,
        },
      }));
    } catch {
      setActivityError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [data.recentActivity.nextBefore, loadingMore]);

  // A short list that does not fill the box cannot be scrolled: fetch the next page right away.
  useEffect(() => {
    const list = activityListRef.current;
    if (list !== null && list.scrollHeight <= list.clientHeight + 4 && !activityError)
      void loadMore();
  }, [data.recentActivity.items.length, activityError, loadMore]);

  const counters = [
    { label: strings.activeLines, value: data.counters.active, href: '/lines?view=active' },
    { label: strings.closedLines, value: data.counters.closed, href: '/lines?view=closed' },
    {
      label: strings.cryopreserved,
      value: data.counters.cryopreserved,
      href: '/lines?view=all&cryo=yes',
    },
    {
      label: strings.unreadMessages,
      value: data.counters.unreadMessages,
      href: '#unread-messages',
    },
    { label: strings.chatOpenRequests, value: data.counters.openRequests, href: '#open-requests' },
  ];

  return (
    <div className="dashboard-page">
      <h1>{strings.dashboard}</h1>
      {acting.name === null ? null : (
        <p className="dashboard-hello" data-testid="dashboard-hello">
          <strong>{strings.helloUser(acting.name)}</strong>
          {acting.role === 'guest' ? ` · ${strings.helloGuestHint}` : ''}
        </p>
      )}
      <section className="dashboard-counters" aria-label={strings.dashboard}>
        {counters.map((counter) => (
          <a className="dashboard-counter" href={counter.href} key={counter.label}>
            <span>{counter.label}</span>
            <strong>{counter.value}</strong>
          </a>
        ))}
      </section>

      <section
        className="dashboard-panel dashboard-unread-messages"
        id="unread-messages"
        aria-labelledby="unread-messages-title"
      >
        <div className="dashboard-unread-messages__heading">
          <h2 id="unread-messages-title">
            {strings.unreadMessages}
            {strings.metadataSeparator}
            {String(data.counters.unreadMessages)}
          </h2>
          {data.counters.unreadMessages > 0 ? (
            <button
              type="button"
              disabled={markingAllUnread || markingUnreadId !== null}
              onClick={() => void markAllUnreadRead()}
            >
              {markingAllUnread ? strings.loading : strings.chatMarkAllRead}
            </button>
          ) : null}
        </div>
        {unreadError ? (
          <p className="form-error" role="alert">
            {strings.chatLoadFailed}
          </p>
        ) : null}
        {data.unreadMessages.length === 0 ? (
          <p>{strings.chatNoUnreadMessages}</p>
        ) : (
          <ul className="dashboard-unread-messages__list">
            {data.unreadMessages.map((message) => (
              <li className="dashboard-unread-message" key={message.id}>
                <p className="dashboard-unread-message__meta">
                  <strong>{message.authorName}</strong>
                  {strings.metadataSeparator}
                  <span>{message.lineName ?? strings.labChat}</span>
                  {strings.metadataSeparator}
                  <time dateTime={message.createdAt}>{formatRelativeTime(message.createdAt)}</time>
                </p>
                <p>{message.body}</p>
                <div className="dashboard-unread-message__actions">
                  <button
                    type="button"
                    disabled={markingUnreadId !== null}
                    onClick={() => void markUnreadRead(message.id)}
                  >
                    {markingUnreadId === message.id ? strings.loading : strings.chatRead}
                  </button>
                  <a
                    href={
                      message.lineId === null
                        ? '/#lab-chat'
                        : `/lines/${encodeURIComponent(message.lineId)}#chat`
                    }
                  >
                    {strings.chatOpenChat}
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        className="dashboard-panel dashboard-open-requests"
        id="open-requests"
        aria-labelledby="open-requests-title"
      >
        <h2 id="open-requests-title">
          {strings.chatOpenRequests}
          {strings.metadataSeparator}
          {String(data.openRequests.length)}
        </h2>
        {data.openRequests.length === 0 ? (
          <p>{strings.chatNoOpenRequests}</p>
        ) : (
          <ul className="dashboard-open-requests__list">
            {data.openRequests.map((request) => (
              <li
                key={request.id}
                id={`open-request-${request.id}`}
                className="dashboard-open-request"
              >
                <div>
                  <strong>{request.requestType}</strong>
                  <span>{strings.metadataSeparator}</span>
                  <span>{request.lineName ?? strings.labChat}</span>
                </div>
                <p>{request.body}</p>
                <p className="dashboard-open-request__meta">
                  {request.authorName}
                  {strings.metadataSeparator}
                  {formatRelativeTime(request.createdAt)}
                </p>
                <a
                  href={
                    request.lineId === null
                      ? `/#open-request-${encodeURIComponent(request.id)}`
                      : `/lines/${encodeURIComponent(request.lineId)}#chat-request-${encodeURIComponent(request.id)}`
                  }
                >
                  {strings.chatOpenRequest}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dashboard-panel dashboard-upcoming" aria-labelledby="upcoming-title">
        <h2 id="upcoming-title">{strings.upcomingBreeding}</h2>
        {data.upcoming.length === 0 ? (
          <EmptyState message={strings.upcomingBreedingEmpty(data.thresholdMonths)} />
        ) : (
          <>
            <div className="data-table dashboard-table">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{strings.lineName}</th>
                    <th scope="col">{strings.gene}</th>
                    <th scope="col">{strings.dob}</th>
                    <th scope="col">{strings.ageMonthsLabel}</th>
                    <th scope="col">{strings.idMethod}</th>
                    <th scope="col">{strings.idedNumber}</th>
                    <th scope="col">{strings.openLine}</th>
                    <th scope="col">{strings.startBreeding}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.upcoming.map((line) => (
                    <tr key={line.id}>
                      <td>{line.name}</td>
                      <td>{line.gene ?? strings.emptyValue}</td>
                      <td>{line.dob === null ? strings.emptyValue : formatDate(line.dob)}</td>
                      <td>
                        {line.ageMonths === null
                          ? strings.emptyValue
                          : strings.ageMonths(line.ageMonths)}
                      </td>
                      <td>{line.idMethod}</td>
                      <td>{line.idedNumber}</td>
                      <td>
                        <a href={`/lines/${line.id}`}>{strings.openLine}</a>
                      </td>
                      <td>
                        <a href={`/lines/${line.id}?action=start-breeding`}>
                          {strings.startBreeding}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="dashboard-cards">
              {data.upcoming.map((line) => (
                <article className="dashboard-line-card" key={line.id}>
                  <h3>
                    <a href={`/lines/${line.id}`}>{line.name}</a>
                  </h3>
                  <p>{`${strings.gene}: ${line.gene ?? strings.emptyValue} · ${strings.dob}: ${line.dob === null ? strings.emptyValue : formatDate(line.dob)}`}</p>
                  <p>{`${strings.ageMonths(line.ageMonths ?? 0)}${strings.metadataSeparator}${line.idMethod}${strings.metadataSeparator}${strings.idedNumber}: ${String(line.idedNumber)}`}</p>
                  <div className="dashboard-actions">
                    <a href={`/lines/${line.id}`}>{strings.openLine}</a>
                    <a className="button--primary" href={`/lines/${line.id}?action=start-breeding`}>
                      {strings.startBreeding}
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        {data.missingDob.length > 0 ? (
          <aside className="dashboard-warning" aria-labelledby="missing-dob-title">
            <h3 id="missing-dob-title">{strings.missingDob}</h3>
            <ul>
              {data.missingDob.map((line) => (
                <li key={line.id}>
                  <a href={`/lines/${line.id}`}>{line.name}</a>
                  {strings.statusSeparator}
                  {line.status}
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </section>

      <section className="dashboard-panel dashboard-current" aria-labelledby="current-title">
        <h2 id="current-title">{strings.currentlyBreeding}</h2>
        {data.currentlyBreeding.length === 0 ? (
          <EmptyState message={strings.noBreedingLines} />
        ) : (
          <ul className="dashboard-breeding-list">
            {data.currentlyBreeding.map((line) => (
              <li key={line.id}>
                <div className="dashboard-breeding-copy">
                  <a href={`/lines/${line.id}`}>
                    <strong>{line.name}</strong>
                  </a>
                  <p>{`${strings.breedingSince}: ${line.breedingStartedAt === null ? strings.emptyValue : formatDate(line.breedingStartedAt.slice(0, 10))}${strings.metadataSeparator}${strings.days}: ${line.days === null ? strings.emptyValue : strings.ageInDays(line.days)}`}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {data.currentlyBreeding.length === 0 ? null : (
          <p className="dashboard-current__footer">
            <button
              type="button"
              className="button--primary"
              onClick={() => {
                setPickingLine(true);
              }}
            >
              {strings.updateGenotyping}
            </button>
          </p>
        )}
        {pickingLine ? (
          <PickLineDialog
            lines={data.currentlyBreeding}
            onClose={() => {
              setPickingLine(false);
            }}
          />
        ) : null}
      </section>

      <section className="dashboard-panel dashboard-activity" aria-labelledby="activity-title">
        <h2 id="activity-title">{strings.recentActivity}</h2>
        {data.recentActivity.items.length === 0 ? (
          <EmptyState message={strings.noRecentActivity} />
        ) : (
          <ol
            className="activity-list scroll-list"
            ref={activityListRef}
            tabIndex={0}
            aria-label={strings.recentActivity}
            onScroll={(event) => {
              const list = event.currentTarget;
              if (list.scrollTop + list.clientHeight >= list.scrollHeight - 80) void loadMore();
            }}
          >
            {data.recentActivity.items.map((item) => (
              <li key={item.id}>
                <p>
                  <span className="activity-avatar" aria-hidden="true">
                    {userInitials(item.userName)}
                  </span>
                  <span>{activityLabel(item)}</span>
                  {strings.statusSeparator}
                  {item.lineId === null ? (
                    <a href="#lab-chat">{strings.labChat}</a>
                  ) : (
                    <a href={`/lines/${item.lineId}`}>{item.lineName ?? strings.lineName}</a>
                  )}
                </p>
                <p>{item.summary}</p>
                <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
              </li>
            ))}
          </ol>
        )}
        {activityError ? (
          <p className="form-error" role="alert">
            {strings.activityLoadError}
          </p>
        ) : null}
        {loadingMore ? <p className="activity-loading">{strings.loading}</p> : null}
      </section>

      <section
        className="dashboard-panel dashboard-chat"
        id="lab-chat"
        aria-labelledby="lab-chat-title"
      >
        <h2 id="lab-chat-title">{strings.labChat}</h2>
        <details open={wideScreen}>
          <summary>{`${strings.labChat} · ${strings.chatRequestCount(data.counters.openRequests)}`}</summary>
          <ChatPanel scope={{}} compact />
        </details>
      </section>

      <nav className="dashboard-navigation" aria-label={strings.dashboard}>
        <a className="button--primary" href="/lines?view=active">
          {strings.seeActiveLines}
        </a>
        <a className="button--primary" href="/lines?view=all">
          {strings.seeAllLines}
        </a>
        <a className="button--primary" href="/lines/new">
          {strings.addNewLine}
        </a>
      </nav>
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    void getDashboard()
      .then((next) => {
        setData(next);
        setDataVersion((version) => version + 1);
        setError(false);
      })
      .catch(() => {
        setError(true);
      });
  }, [retryKey]);

  useEffect(() => {
    const refreshDashboard = () => {
      void getDashboard()
        .then((next) => {
          setData(next);
          setDataVersion((version) => version + 1);
          setError(false);
        })
        .catch(() => {
          setError(true);
        });
    };
    window.addEventListener('focus', refreshDashboard);
    window.addEventListener(CHAT_STATE_CHANGED, refreshDashboard);
    return () => {
      window.removeEventListener('focus', refreshDashboard);
      window.removeEventListener(CHAT_STATE_CHANGED, refreshDashboard);
    };
  }, []);

  if (data === null && error)
    return (
      <section className="dashboard-page">
        <h1>{strings.dashboard}</h1>
        <p role="alert">{strings.dashboardLoadError}</p>
        <button
          type="button"
          onClick={() => {
            setRetryKey((value) => value + 1);
          }}
        >
          {strings.dashboardRetry}
        </button>
      </section>
    );
  if (data === null)
    return (
      <section className="dashboard-page">
        <h1>{strings.dashboard}</h1>
        <Skeleton lines={6} />
      </section>
    );
  return <DashboardContent key={dataVersion} initial={data} />;
}
