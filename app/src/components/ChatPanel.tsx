import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import {
  deleteChatMessage,
  editChatMessage,
  getChat,
  markChatRead,
  notifyChatStateChanged,
  postChatMessage,
  unmarkChatRead,
  updateRequestStatus,
  type ChatMessage,
  type ChatPage,
  type ChatScope,
} from '../chatApi';
import { formatDateTime, formatRelativeTime } from '../dateFormat';
import { getSession } from '../session';
import { strings } from '../strings';
import { isSendShortcut } from '../chatKeys';
import { ACTING_USER_CHANGED, useActingUser } from '../useActingUser';

const EDIT_WINDOW_MS = 15 * 60 * 1000;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function BodyText({ body, mentionNames }: { body: string; mentionNames: string[] }) {
  const parts = body.split(/(https?:\/\/[^\s]+)/g);
  const mentionPattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(@(?:${['all', ...mentionNames]
      .map(escapeRegExp)
      .sort((left, right) => right.length - left.length)
      .join('|')}))(?=$|[^\\p{L}\\p{N}_])`,
    'giu',
  );
  return (
    <p className="chat-message__body">
      {parts.map((part, index) => {
        if (/^https?:\/\//.test(part))
          return (
            <a key={`${part}-${String(index)}`} href={part} target="_blank" rel="noreferrer">
              {part}
            </a>
          );
        const pieces: ReactNode[] = [];
        let cursor = 0;
        for (const match of part.matchAll(mentionPattern)) {
          const start = match.index;
          const boundary = match[1] ?? '';
          const token = match[2] ?? '';
          const mentionStart = start + boundary.length;
          if (start > cursor) pieces.push(part.slice(cursor, start));
          if (boundary !== '') pieces.push(boundary);
          pieces.push(
            <strong className="chat-mention" key={`${String(index)}-${String(mentionStart)}`}>
              {token}
            </strong>,
          );
          cursor = mentionStart + token.length;
        }
        if (cursor < part.length) pieces.push(part.slice(cursor));
        return <span key={String(index)}>{pieces.length > 0 ? pieces : part}</span>;
      })}
    </p>
  );
}

export function ChatPanel({ scope, compact = false }: { scope: ChatScope; compact?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [openRequestCount, setOpenRequestCount] = useState(0);
  const [openRequests, setOpenRequests] = useState<ChatPage['openRequests']>([]);
  const [requestTypes, setRequestTypes] = useState<string[]>([]);
  const [body, setBody] = useState('');
  const [requestType, setRequestType] = useState('');
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const loadedMessagesRef = useRef<ChatMessage[]>([]);
  const olderCursorRef = useRef<string | null>(null);
  const acting = useActingUser();
  const lineId = scope.lineId;
  const chatScope = useMemo(() => (lineId === undefined ? {} : { lineId }), [lineId]);
  const [nowMs, setNowMs] = useState(0);

  const refresh = useCallback(
    async (older?: string) => {
      try {
        const page = await getChat(chatScope, older);
        const wasEmpty = loadedMessagesRef.current.length === 0;
        const merged = new Map(loadedMessagesRef.current.map((item) => [item.id, item]));
        for (const item of page.items) merged.set(item.id, item);
        const nextMessages = [...merged.values()].sort(
          (left, right) =>
            left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
        );
        loadedMessagesRef.current = nextMessages;
        setMessages(nextMessages);
        if (older !== undefined || wasEmpty) olderCursorRef.current = page.nextBefore;
        setNextBefore(olderCursorRef.current);
        setOpenRequestCount(page.openRequestCount);
        setOpenRequests(page.openRequests);
        setRequestTypes(page.requestTypes.results.map((item) => item.value));
        setError(null);
      } catch {
        setError(strings.chatLoadFailed);
      }
    },
    [chatScope],
  );

  useEffect(() => {
    const loadViewer = () => {
      void getSession()
        .then((session) => {
          setViewerId(session.user?.id ?? null);
        })
        .catch(() => undefined);
    };
    loadViewer();
    window.addEventListener(ACTING_USER_CHANGED, loadViewer);
    return () => {
      window.removeEventListener(ACTING_USER_CHANGED, loadViewer);
    };
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => {
      void refresh();
      setNowMs(Date.now());
    }, 0);
    const updateNow = () => {
      setNowMs(Date.now());
    };
    const interval = window.setInterval(() => {
      void refresh();
    }, 30_000);
    const clock = window.setInterval(updateNow, 30_000);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.clearInterval(clock);
      window.clearTimeout(initialLoad);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    if (!targetId.startsWith('chat-request-')) return;
    document.getElementById(targetId)?.scrollIntoView({ block: 'center' });
  }, [openRequests]);

  async function send() {
    if (body.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      await postChatMessage(chatScope, body.trim(), requestType || null);
      setBody('');
      setRequestType('');
      await refresh();
      notifyChatStateChanged();
      if (scrollRef.current !== null) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    } catch {
      setError(strings.chatSendFailed);
    } finally {
      setBusy(false);
    }
  }

  async function changeRequest(id: string, status: 'open' | 'done') {
    setBusy(true);
    try {
      await updateRequestStatus(id, status);
      if (status === 'done') {
        const message = loadedMessagesRef.current.find((item) => item.id === id);
        const pinnedRequest = openRequests.find((item) => item.id === id);
        const authorId = message?.user_id ?? pinnedRequest?.userId;
        if (authorId !== undefined && authorId !== viewerId) {
          try {
            await markChatRead(id);
          } catch {
            setError(strings.chatLoadFailed);
          }
        }
      }
      notifyChatStateChanged();
      await refresh();
    } catch {
      setError(strings.chatSendFailed);
    } finally {
      setBusy(false);
    }
  }

  async function toggleRead(message: ChatMessage) {
    try {
      if (message.readByMe) await unmarkChatRead(message.id);
      else await markChatRead(message.id);
      notifyChatStateChanged();
      await refresh();
    } catch {
      setError(strings.chatLoadFailed);
    }
  }

  function submitEdit(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    void editChatMessage(id, editBody)
      .then(async () => {
        setEditingId(null);
        await refresh();
      })
      .catch(() => {
        setError(strings.chatSendFailed);
      });
  }

  return (
    <div className={`chat-panel${compact ? ' chat-panel--compact' : ''}`}>
      {openRequestCount > 0 ? (
        <section className="chat-requests" aria-label={strings.chatRequestOpen}>
          <h3>{strings.chatRequestCount(openRequestCount)}</h3>
          {openRequests.map((message) => (
            <article
              key={`request-${message.id}`}
              id={`chat-request-${message.id}`}
              className="chat-request"
            >
              <strong>{message.requestType}</strong>
              <p>{message.body}</p>
              <p>{message.authorName}</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void changeRequest(message.id, 'done')}
              >
                {strings.chatMarkDone}
              </button>
            </article>
          ))}
        </section>
      ) : null}
      <div
        className="chat-message-list"
        ref={scrollRef}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {nextBefore !== null ? (
          <button
            type="button"
            className="chat-load-earlier"
            onClick={() => void refresh(nextBefore)}
          >
            {strings.chatLoadEarlier}
          </button>
        ) : null}
        {messages.length === 0 ? <p className="chat-empty">{strings.chatEmpty}</p> : null}
        {messages.map((message) => {
          const mine = message.user_id === viewerId;
          const messageAge = nowMs - Date.parse(message.created_at);
          const editable =
            mine && message.deleted_at === null && messageAge >= 0 && messageAge <= EDIT_WINDOW_MS;
          return (
            <article
              key={message.id}
              className={`chat-message${mine ? ' chat-message--mine' : ''}${message.request_status === 'open' ? ' chat-message--request' : ''}`}
            >
              <div className="chat-message__meta">
                <span className="chat-avatar" aria-hidden="true">
                  {initials(message.author_name)}
                </span>
                <strong>{message.author_name}</strong>
                <time dateTime={message.created_at} title={formatDateTime(message.created_at)}>
                  {formatRelativeTime(message.created_at)}
                </time>
                {message.edited_at !== null ? <span>{strings.chatEdited}</span> : null}
              </div>
              {message.deleted_at !== null ? (
                <p className="chat-removed">{strings.chatRemoved}</p>
              ) : editingId === message.id ? (
                <form
                  onSubmit={(event) => {
                    submitEdit(event, message.id);
                  }}
                  className="chat-edit-form"
                >
                  <textarea
                    aria-label={strings.chatComposerLabel}
                    value={editBody}
                    onChange={(event) => {
                      setEditBody(event.target.value);
                    }}
                    onKeyDown={(event) => {
                      if (!isSendShortcut(event.nativeEvent)) return;
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }}
                    aria-keyshortcuts="Shift+Enter"
                    rows={3}
                  />
                  <button type="submit">{strings.chatSave}</button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(null);
                    }}
                  >
                    {strings.chatCancelEdit}
                  </button>
                </form>
              ) : (
                <BodyText
                  body={message.body}
                  mentionNames={message.mentions.map((mention) => mention.userName)}
                />
              )}
              {message.request_type !== null ? (
                <span
                  className={`chat-request-badge chat-request-badge--${message.request_status ?? 'done'}`}
                >
                  {message.request_type}
                  {strings.chatRequestStatusSeparator}
                  {message.request_status === 'open'
                    ? strings.chatRequestOpen
                    : strings.chatRequestDone}
                </span>
              ) : null}
              <div className="chat-message__actions">
                {!mine && message.deleted_at === null ? (
                  <button type="button" onClick={() => void toggleRead(message)}>
                    {message.readByMe ? strings.chatUnread : strings.chatRead}
                  </button>
                ) : null}
                {message.reads.length > 0 ? (
                  <span>
                    {strings.chatReadBy(message.reads.map((read) => read.userName).join(', '))}
                  </span>
                ) : null}
                {mine && message.request_status !== null && message.deleted_at === null ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void changeRequest(
                        message.id,
                        message.request_status === 'open' ? 'done' : 'open',
                      )
                    }
                  >
                    {message.request_status === 'open' ? strings.chatMarkDone : strings.chatReopen}
                  </button>
                ) : null}
                {editable ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(message.id);
                        setEditBody(message.body);
                      }}
                    >
                      {strings.chatEdit}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void deleteChatMessage(message.id)
                          .then(() => refresh())
                          .catch(() => {
                            setError(strings.chatSendFailed);
                          });
                      }}
                    >
                      {strings.chatDelete}
                    </button>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {error !== null ? (
        <p className="chat-error" role="alert">
          {error}
        </p>
      ) : null}
      {acting.role === 'guest' ? (
        <p className="chat-guest-note">{strings.chatGuestNote}</p>
      ) : (
        <form
          className="chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <label htmlFor="chat-body">{strings.chatComposerLabel}</label>
          <textarea
            id="chat-body"
            value={body}
            placeholder={strings.chatMentionHint}
            rows={2}
            maxLength={4000}
            onChange={(event) => {
              setBody(event.target.value);
            }}
            onKeyDown={(event) => {
              if (!isSendShortcut(event.nativeEvent)) return;
              event.preventDefault();
              if (!busy && body.trim() !== '') void send();
            }}
            aria-keyshortcuts="Shift+Enter"
            onInput={(event) => {
              event.currentTarget.style.height = 'auto';
              event.currentTarget.style.height = `${String(event.currentTarget.scrollHeight)}px`;
            }}
          />
          <p className="chat-composer__shortcut">{strings.chatSendShortcutHint}</p>
          <div className="chat-composer__actions">
            <label htmlFor="chat-request-type">{strings.chatRequestOptional}</label>
            <select
              id="chat-request-type"
              value={requestType}
              onChange={(event) => {
                setRequestType(event.target.value);
              }}
            >
              <option value="">{strings.chatNoRequest}</option>
              {requestTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <button className="button--primary" type="submit" disabled={busy || body.trim() === ''}>
              {strings.chatSend}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
