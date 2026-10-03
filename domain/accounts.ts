/** Sign-in rules (ADR-0005). Pure functions; the Worker stores the results. */

export const MIN_PASSWORD_LENGTH = 8;
export const LOCK_AFTER_FAILURES = 10;
export const LOCK_MINUTES = 15;
export const INVITE_DAYS = 7;

export type NewPasswordProblem = 'tooShort';

/**
 * A new password: at least 8 characters. The initial password may be chosen again (owner decision
 * 2026-10-02: accepted trade-off, ADR-0005), so it is not compared with the previous one.
 */
export function newPasswordProblem(next: string): NewPasswordProblem | null {
  return next.length < MIN_PASSWORD_LENGTH ? 'tooShort' : null;
}

export function isLocked(lockedUntil: string | null, now: Date): boolean {
  return lockedUntil !== null && Date.parse(lockedUntil) > now.getTime();
}

export function inviteExpiry(now: Date): string {
  return new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60_000).toISOString();
}

export function inviteUsable(
  invite: { expires_at: string; used_at: string | null },
  now: Date,
): boolean {
  return invite.used_at === null && Date.parse(invite.expires_at) > now.getTime();
}
