import { request } from './api';

export const CHAT_STATE_CHANGED = 'fish-db:chat-state-changed';

export function notifyChatStateChanged() {
  window.dispatchEvent(new Event(CHAT_STATE_CHANGED));
}

export interface ChatRead {
  userId: string;
  userName: string;
  readAt: string;
}

export interface ChatMessage {
  id: string;
  line_id: string | null;
  user_id: string;
  via_admin: number;
  body: string;
  request_type: string | null;
  request_status: 'open' | 'done' | null;
  request_done_by: string | null;
  request_done_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  author_name: string;
  reads: ChatRead[];
  mentions: { userId: string; userName: string }[];
  readByMe: boolean;
}

export interface ChatPage {
  items: ChatMessage[];
  nextBefore: string | null;
  openRequestCount: number;
  openRequests: {
    id: string;
    body: string;
    requestType: string;
    userId: string;
    authorName: string;
    createdAt: string;
  }[];
  requestTypes: { results: { value: string }[] };
}

export interface ChatScope {
  lineId?: string;
}

const collection = ({ lineId }: ChatScope) =>
  lineId === undefined ? '/api/messages' : `/api/lines/${encodeURIComponent(lineId)}/messages`;

export const getChat = (scope: ChatScope, before?: string) =>
  request<ChatPage>(
    `${collection(scope)}${before === undefined ? '' : `?${new URLSearchParams({ before })}`}`,
  );

export const postChatMessage = (scope: ChatScope, body: string, requestType: string | null) =>
  request<{ id: string; createdAt: string }>(collection(scope), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, requestType }),
  });

export const markChatRead = (id: string) =>
  request<undefined>(`/api/messages/${encodeURIComponent(id)}/read`, { method: 'POST' });

export const unmarkChatRead = (id: string) =>
  request<undefined>(`/api/messages/${encodeURIComponent(id)}/read`, { method: 'DELETE' });

export const updateRequestStatus = (id: string, status: 'open' | 'done') =>
  request(`/api/messages/${encodeURIComponent(id)}/request`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });

export const editChatMessage = (id: string, body: string) =>
  request(`/api/messages/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });

export const deleteChatMessage = (id: string) =>
  request<undefined>(`/api/messages/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const getChatCounts = () =>
  request<{ unread: number; openRequests: number }>('/api/messages/unread-count');
