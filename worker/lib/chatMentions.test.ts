import { describe, expect, it } from 'vitest';
import { resolveChatMentions, type MentionUser } from './chatMentions';

const users: MentionUser[] = [
  { id: 'admin', name: 'Admin', is_active: 1 },
  { id: 'bob', name: 'Bob', is_active: 1 },
  { id: 'dan', name: 'Dan', is_active: 1 },
  { id: 'guest', name: 'Guest', is_active: 1 },
  { id: 'erin', name: 'Erin', is_active: 0 },
];

describe('resolveChatMentions', () => {
  it('matches active users by name without matching prefixes, email addresses, or inactive users', () => {
    expect(
      resolveChatMentions('Hi @Bob, @Dan! @Bobx name@example.com @Erin', users, 'guest'),
    ).toEqual([users[1], users[2]]);
  });

  it('resolves @all case-insensitively to every active user except the author', () => {
    expect(resolveChatMentions('Please review this, @ALL.', users, 'bob')).toEqual([
      users[0],
      users[2],
      users[3],
    ]);
  });

  it('deduplicates repeated names and overlapping @all mentions', () => {
    expect(resolveChatMentions('@Dan @all @Bob', users, 'guest')).toEqual([
      users[2],
      users[0],
      users[1],
    ]);
  });

  it('returns no recipients when there are no recognized mentions', () => {
    expect(resolveChatMentions('Please review this message.', users, 'guest')).toEqual([]);
  });
});
