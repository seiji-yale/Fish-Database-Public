import { request } from './api';

export type LineStatus = 'Current' | 'Breeding' | 'Closed';

export interface LineDetailAttachment {
  id: string;
  kind: string;
  fileName: string | null;
  mimeType: string | null;
  caption: string | null;
  isLatest: boolean;
  createdAt: string;
}

export interface LineDetailProtocol {
  id: string;
  protocolType: string;
  label: string;
  fields: Record<string, unknown>;
  notes: string | null;
  isCurrent: boolean;
  attachments: LineDetailAttachment[];
}

export interface LineDetailCryoRecord {
  id: string;
  cryoDate: string | null;
  place: string | null;
  boxName: string | null;
  cryoIdStart: string | null;
  cryoIdEnd: string | null;
  /** Vials left (drops when vials are used). */
  count: number | null;
  /** Vials already taken out of this record. */
  usedCount: number;
  detailsUnknown: boolean;
  notes: string | null;
}

export interface LineDetailCryoUse {
  id: string;
  cryoId: string | null;
  quantity: number;
  usedAt: string;
  note: string | null;
  usedByName: string;
  place: string | null;
}

export interface LineDetailReference {
  id: string;
  title: string;
  url: string | null;
  note: string | null;
  attachment: LineDetailAttachment | null;
}

export interface LineDetailGenotypingRecord {
  id: string;
  generationNo: number;
  recordDate: string;
  protocolId: string | null;
  protocolLabel: string | null;
  positiveCount: number;
  screenedCount: number | null;
  isNewGeneration: boolean;
  newDob: string | null;
  notes: string | null;
  attachments: LineDetailAttachment[];
}

export interface LineDetailGeneration {
  generationNo: number;
  dob: string | null;
  records: LineDetailGenotypingRecord[];
}

export interface LineDetailVersionDiff {
  path: string;
  before: unknown;
  after: unknown;
}

export interface LineDetailVersion {
  id: string;
  versionNo: number;
  changeType: string;
  summary: string;
  note: string | null;
  createdAt: string;
  createdByName: string;
  viaAdmin: boolean;
  diff: LineDetailVersionDiff[];
}

/** Mirrors `worker/lib/lineDetail.ts` `LineDetailDocument` (the app does not import worker code). */
export interface LineDetailDocument {
  id: string;
  name: string;
  gene: string | null;
  status: LineStatus;
  dob: string | null;
  ageMonths: number | null;
  generationNo: number;
  idedNumber: number;
  lastIdDate: string | null;
  breedingStartedAt: string | null;
  closedAt: string | null;
  closedReason: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  createdByName: string;
  updatedAt: string;
  updatedByName: string;
  isCryopreserved: boolean;
  cryoStrawCount: number;
  phenotypes: { id: string; description: string }[];
  attributes: { id: string; key: string; value: string | null }[];
  protocols: LineDetailProtocol[];
  cryoRecords: LineDetailCryoRecord[];
  cryoUses: LineDetailCryoUse[];
  references: LineDetailReference[];
  generations: LineDetailGeneration[];
  versions: LineDetailVersion[];
}

export const getLineDetail = (id: string) =>
  request<LineDetailDocument>(`/api/lines/${encodeURIComponent(id)}`);
