import type { UserRole } from './types';

/**
 * The only permission vocabulary (ADR-0006, BR-15, docs/08 §2.2). The API enforces it; the client
 * uses the same table to decide what to render. Code never compares `role === 'guest'` directly.
 */
export const CAPABILITIES = [
  'lines.read_overview',
  'lines.read_full',
  'lines.write',
  'lines.export',
  'attachments.read_files',
  'attachments.read_refs',
  'activity.read',
  'chat.read',
  'chat.write',
  'users.list',
  'feeding.read',
  'feeding.write',
  'feeding.export',
  'admin.*',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL: readonly Capability[] = CAPABILITIES;

const MEMBER: readonly Capability[] = CAPABILITIES.filter((capability) => capability !== 'admin.*');

const FEEDER: readonly Capability[] = [
  'lines.read_overview',
  'attachments.read_refs',
  'users.list',
  'feeding.read',
  'feeding.write',
  'feeding.export',
];

const GUEST: readonly Capability[] = ['lines.read_overview', 'attachments.read_refs'];

const BY_ROLE: Readonly<Record<UserRole, ReadonlySet<Capability>>> = {
  admin: new Set(ALL),
  member: new Set(MEMBER),
  feeder: new Set(FEEDER),
  guest: new Set(GUEST),
};

export function can(role: UserRole, capability: Capability): boolean {
  return BY_ROLE[role].has(capability);
}

/** The capabilities of a role, in table order (sent by `GET /api/session`). */
export function capabilitiesOf(role: UserRole): Capability[] {
  return CAPABILITIES.filter((capability) => can(role, capability));
}

/** A restricted role sees the line overview only (docs/08 §4). */
export function isRestricted(role: UserRole): boolean {
  return !can(role, 'lines.read_full');
}

/** Roles an Admin may assign in Settings → Users (the built-in Guest is never assignable). */
export const ASSIGNABLE_ROLES = [
  'admin',
  'member',
  'feeder',
] as const satisfies readonly UserRole[];
