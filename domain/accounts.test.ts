import { describe, expect, it } from 'vitest';
import { inviteExpiry, inviteUsable, isLocked, newPasswordProblem } from './accounts';

const now = new Date('2026-10-02T12:00:00.000Z');

describe('newPasswordProblem', () => {
  it('needs at least 8 characters', () => {
    expect(newPasswordProblem('short77')).toBe('tooShort');
    expect(newPasswordProblem('long-enough')).toBeNull();
  });
  it('accepts any password of 8+ characters, including the initial one chosen again', () => {
    expect(newPasswordProblem('initial-pw')).toBeNull();
  });
});

describe('isLocked', () => {
  it('is locked only before the lock end', () => {
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked('2026-10-02T12:10:00.000Z', now)).toBe(true);
    expect(isLocked('2026-10-02T11:59:59.000Z', now)).toBe(false);
  });
});

describe('invites', () => {
  it('expire after 7 days and work once', () => {
    const expires = inviteExpiry(now);
    expect(expires).toBe('2026-10-09T12:00:00.000Z');
    expect(inviteUsable({ expires_at: expires, used_at: null }, now)).toBe(true);
    expect(inviteUsable({ expires_at: expires, used_at: now.toISOString() }, now)).toBe(false);
    expect(inviteUsable({ expires_at: now.toISOString(), used_at: null }, now)).toBe(false);
  });
});
