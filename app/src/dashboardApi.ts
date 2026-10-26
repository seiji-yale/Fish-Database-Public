import { request } from './api';
import type { LineStatus } from './linesApi';

export interface DashboardActivity {
  id: string;
  lineId: string | null;
  lineName: string | null;
  userName: string;
  type: string;
  summary: string;
  createdAt: string;
}

export interface DashboardActivityPage {
  items: DashboardActivity[];
  nextBefore: string | null;
}

export interface DashboardResponse {
  restricted?: undefined;
  today: string;
  thresholdMonths: number;
  counters: {
    active: number;
    closed: number;
    cryopreserved: number;
    unreadMessages: number;
    openRequests: number;
  };
  upcoming: {
    id: string;
    name: string;
    gene: string | null;
    dob: string | null;
    ageMonths: number | null;
    idMethod: string;
    idedNumber: number;
  }[];
  currentlyBreeding: {
    id: string;
    name: string;
    breedingStartedAt: string | null;
    days: number | null;
  }[];
  missingDob: { id: string; name: string; status: LineStatus }[];
  openRequests: {
    id: string;
    lineId: string | null;
    lineName: string | null;
    body: string;
    requestType: string;
    userId: string;
    authorName: string;
    createdAt: string;
  }[];
  unreadMessages: {
    id: string;
    lineId: string | null;
    lineName: string | null;
    body: string;
    authorName: string;
    createdAt: string;
  }[];
  recentActivity: DashboardActivityPage;
}

/** What Guests and Feeders get (FR-GUEST-09): the three line counters and nothing else. */
export interface RestrictedDashboardResponse {
  today: string;
  restricted: true;
  counters: { active: number; closed: number; cryopreserved: number };
}

export const getDashboard = () =>
  request<DashboardResponse | RestrictedDashboardResponse>('/api/dashboard');

export const markAllChatRead = () =>
  request<{ marked: number }>('/api/messages/read-all', { method: 'POST' });

export const getMoreActivities = (before: string) =>
  request<DashboardActivityPage>(`/api/activities?${new URLSearchParams({ before })}`);
