/** Shared, persistence-free domain shapes. */
export type LineStatus = 'Current' | 'Breeding' | 'Closed';

export interface LineDoc {
  id: string;
  name: string;
  status: LineStatus;
  dob: string | null;
  generationNo: number;
  idedNumber: number;
  lastIdDate: string | null;
  breedingStartedAt: string | null;
  closedAt: string | null;
  closedReason: string | null;
  version: number;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface GenotypingInput {
  recordDate: string;
  positiveCount: number;
  isNewGeneration: boolean;
  newDob?: string | null;
}

export type UserRole = 'admin' | 'member' | 'guest';

export interface ActingUser {
  id: string;
  name: string;
  role: UserRole;
  isActive?: boolean;
}

export type AuthorAction = 'data' | 'chat';

export interface ResolvedAuthor {
  authorId: string;
  viaAdmin: boolean;
}

export interface SnapshotDiff {
  path: string;
  before: unknown;
  after: unknown;
}

export interface ProtocolValidationIssue {
  field: string;
  message: string;
}

export interface ProtocolValidationResult {
  errors: ProtocolValidationIssue[];
  warnings: ProtocolValidationIssue[];
}
