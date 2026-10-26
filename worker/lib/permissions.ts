import type { Context } from 'hono';
import { can, type Capability } from '../../domain/permissions';
import type { ActingUser } from '../../domain/types';
import type { Bindings } from '../middleware/session';
import { actingUser } from './attribution';
import { ApiError } from './errors';
import { messages } from './messages';

/**
 * BR-15: every route asks for a capability instead of comparing roles. Not signed in -> 401.
 * Missing capability -> 403 (`ADMIN_ONLY` for `admin.*`, otherwise `FORBIDDEN`).
 */
export async function requireCapability(
  c: Context<{ Bindings: Bindings }>,
  capability: Capability,
): Promise<ActingUser> {
  const acting = await actingUser(c);
  if (can(acting.role, capability)) return acting;
  if (capability === 'admin.*') throw new ApiError(403, 'ADMIN_ONLY', messages.adminOnly);
  throw new ApiError(403, 'FORBIDDEN', messages.restrictedApi);
}

/** The signed-in role when it may only see the line overview (docs/08 §4); a full reader gets `null`. */
export async function restrictedViewer(
  c: Context<{ Bindings: Bindings }>,
): Promise<ActingUser | null> {
  const acting = await actingUser(c);
  return can(acting.role, 'lines.read_full') ? null : acting;
}
