import { describe, expect, it } from 'vitest';
import { ForbiddenAuthorError, resolveAuthor } from './attribution';
import type { ActingUser } from './types';

const member: ActingUser = { id: 'm1', name: 'Member', role: 'member', isActive: true };
const admin: ActingUser = { id: 'a1', name: 'Boss', role: 'admin', isActive: true };
const guest: ActingUser = { id: 'g1', name: 'Guest', role: 'guest', isActive: true };

describe('resolveAuthor (BR-5, ADR-0005)', () => {
  it('records the signed-in member or admin as the author', () => {
    expect(resolveAuthor(member)).toEqual({ authorId: 'm1', viaAdmin: false });
    expect(resolveAuthor(admin, 'chat')).toEqual({ authorId: 'a1', viaAdmin: false });
  });
  it('refuses Guests for data and, by default, for chat', () => {
    expect(() => resolveAuthor(guest)).toThrow(ForbiddenAuthorError);
    expect(() => resolveAuthor(guest, 'chat')).toThrow(ForbiddenAuthorError);
  });
  it('lets Guests chat only when the rule allows it, never change data', () => {
    expect(resolveAuthor(guest, 'chat', { guestsMayChat: true })).toEqual({
      authorId: 'g1',
      viaAdmin: false,
    });
    expect(() => resolveAuthor(guest, 'data', { guestsMayChat: true })).toThrow(
      ForbiddenAuthorError,
    );
  });
  it('refuses a deactivated user', () => {
    expect(() => resolveAuthor({ ...member, isActive: false })).toThrow(ForbiddenAuthorError);
  });
});
