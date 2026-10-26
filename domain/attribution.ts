import { can } from './permissions';
import type { ActingUser, AuthorAction, ResolvedAuthor } from './types';

export class ForbiddenAuthorError extends Error {
  constructor() {
    super('Guests can read but cannot change anything.');
    this.name = 'ForbiddenAuthorError';
  }
}

export interface AuthorRules {
  /** OQ-40 (a): the Guest URL can be passed on by anyone, so Guests do not chat by default. */
  guestsMayChat: boolean;
}

export const DEFAULT_AUTHOR_RULES: AuthorRules = { guestsMayChat: false };

/**
 * BR-5 (ADR-0005): the signed-in person is the author of every change, Admins included.
 * Guests and Feeders cannot write (a Guest chats only if `guestsMayChat`); a deactivated user cannot author anything.
 */
export function resolveAuthor(
  acting: ActingUser,
  action: AuthorAction = 'data',
  rules: AuthorRules = DEFAULT_AUTHOR_RULES,
): ResolvedAuthor {
  if (acting.isActive === false) throw new ForbiddenAuthorError();
  const allowed =
    action === 'chat'
      ? can(acting.role, 'chat.write') || (acting.role === 'guest' && rules.guestsMayChat)
      : can(acting.role, 'lines.write');
  if (!allowed) throw new ForbiddenAuthorError();
  return { authorId: acting.id, viaAdmin: false };
}
