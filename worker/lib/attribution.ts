import type { Context } from 'hono';
import { ForbiddenAuthorError, resolveAuthor } from '../../domain/attribution';
import type { ActingUser, AuthorAction, ResolvedAuthor } from '../../domain/types';
import type { UserRow } from '../db/types';
import { signedInUser, type Bindings } from '../middleware/session';
import { ApiError } from './errors';
import { messages } from './messages';

function toActingUser(row: UserRow): ActingUser {
  return { id: row.id, name: row.name, role: row.role, isActive: row.is_active === 1 };
}

/** The person signed in on this browser (ADR-0005). Not signed in -> 401 LOGIN_REQUIRED. */
export async function actingUser(c: Context<{ Bindings: Bindings }>): Promise<ActingUser> {
  const row = await signedInUser(c);
  if (row === null) throw new ApiError(401, 'LOGIN_REQUIRED', messages.loginRequired);
  return toActingUser(row);
}

/**
 * BR-5 for an API write: the signed-in person is the author. Guests -> 403 FORBIDDEN.
 * A `chosenUserId` sent by an older client (the retired "Who is making this change?" dialog) is
 * ignored by the routes.
 */
export async function requireAuthor(
  c: Context<{ Bindings: Bindings }>,
  action: AuthorAction,
): Promise<ResolvedAuthor> {
  const acting = await actingUser(c);
  try {
    return resolveAuthor(acting, action);
  } catch (error) {
    if (error instanceof ForbiddenAuthorError)
      throw new ApiError(403, 'FORBIDDEN', messages.guestCannotEdit);
    throw error;
  }
}
