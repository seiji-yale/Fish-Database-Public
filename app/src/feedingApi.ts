import { request } from './api';
import type { SessionUser } from './session';

/** The Feeding Schedule API (T-033, docs/08 §8). The shapes are those of `worker/lib/feedingRead.ts`. */
export interface FeedingAssignment {
  id: string;
  userId: string;
  userName: string;
  note: string | null;
  createdAt: string;
  createdByName: string;
}

export interface FeedingEvent {
  id: string;
  seriesId: string | null;
  title: string;
  note: string | null;
  followingCount: number;
}

export interface FeedingDay {
  date: string;
  weekday: string;
  assignment: FeedingAssignment | null;
  events: FeedingEvent[];
}

export interface FeedingPerson {
  id: string;
  name: string;
  role: SessionUser['role'];
}

export interface FeedingTotals {
  byUser: { userId: string; name: string; weekdays: number; weekend: number; total: number }[];
  unassigned: number;
}

export interface FeedingMonth {
  month: string;
  today: string;
  days: FeedingDay[];
  assignable: FeedingPerson[];
  totals: FeedingTotals;
  notes: string;
}

export interface FeedingHistoryRow {
  id: string;
  userName: string;
  note: string | null;
  createdAt: string;
  createdByName: string;
  replacedAt: string | null;
  replacedByName: string | null;
}

export interface RepeatWeekCounts {
  filled: number;
  kept: number;
  replaced: number;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getFeedingMonth = (month: string) =>
  request<FeedingMonth>(`/api/feeding?month=${encodeURIComponent(month)}`);

export const getFeedingHistory = (date: string) =>
  request<FeedingHistoryRow[]>(`/api/feeding/days/${date}/history`);

export const putFeedingDay = (
  date: string,
  body: { userId: string | null; note: string | null; expectedAssignmentId: string | null },
) => request<FeedingDay>(`/api/feeding/days/${date}`, json('PUT', body));

export const postRepeatWeek = (body: {
  weekStart: string;
  month: string;
  overwrite: boolean;
  dryRun: boolean;
}) => request<RepeatWeekCounts>('/api/feeding/repeat-week', json('POST', body));
