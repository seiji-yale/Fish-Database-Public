import { request } from './api';

export type LineListView = 'active' | 'all' | 'closed';
export type LineStatus = 'Current' | 'Breeding' | 'Closed';

export interface LineListReference {
  id: string;
  title: string;
  url: string | null;
  hasAttachment: boolean;
}

/** Mirrors `worker/lib/lineList.ts` `LineListItem` (the app does not import worker code). */
export interface LineListItem {
  id: string;
  name: string;
  gene: string | null;
  phenotypes: string[];
  dob: string | null;
  ageMonths: number | null;
  status: LineStatus;
  idMethod: string;
  idMethodType: string;
  lastIdDate: string | null;
  idedNumber: number;
  isCryopreserved: boolean;
  cryoSummary: string;
  needsBreeding: boolean;
  missingDob: boolean;
  references: LineListReference[];
  notes: string | null;
  lastUpdateAt: string;
  lastUpdateBy: string;
  attributes: Record<string, string>;
}

export interface LineListResponse {
  view: LineListView;
  total: number;
  items: LineListItem[];
}

export interface LineListQuery {
  view: LineListView;
  q?: string | undefined;
  sort?: string | undefined;
  dir?: 'asc' | 'desc' | undefined;
  idMethod?: string | undefined;
  cryo?: 'yes' | 'no' | undefined;
  breedSoon?: boolean | undefined;
}

function searchParams(query: LineListQuery): URLSearchParams {
  const params = new URLSearchParams({ view: query.view });
  if (query.q !== undefined && query.q !== '') params.set('q', query.q);
  if (query.sort !== undefined) params.set('sort', query.sort);
  if (query.dir !== undefined) params.set('dir', query.dir);
  if (query.idMethod !== undefined) params.set('idMethod', query.idMethod);
  if (query.cryo !== undefined) params.set('cryo', query.cryo);
  if (query.breedSoon === true) params.set('breedSoon', '1');
  return params;
}

export const getLines = (query: LineListQuery) =>
  request<LineListResponse>(`/api/lines?${searchParams(query).toString()}`);

export const linesCsvUrl = (query: LineListQuery): string =>
  `/api/lines.csv?${searchParams(query).toString()}`;
