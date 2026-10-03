export interface MentionUser {
  id: string;
  name: string;
  is_active: number;
}

function isWordCharacter(value: string | undefined): boolean {
  return value !== undefined && /[\p{L}\p{N}_]/u.test(value);
}

function hasTokenBoundary(body: string, end: number): boolean {
  return !isWordCharacter(body[end]);
}

/** Resolve @Name and @all into the active users who should receive an unread notification. */
export function resolveChatMentions(
  body: string,
  users: readonly MentionUser[],
  authorId: string,
): MentionUser[] {
  const activeUsers = users.filter((user) => user.is_active === 1 && user.id !== authorId);
  const byName = [...activeUsers].sort((left, right) => right.name.length - left.name.length);
  const recipients = new Map<string, MentionUser>();

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== '@' || isWordCharacter(body[index - 1])) continue;
    const tokenStart = index + 1;
    const allEnd = tokenStart + 3;
    if (body.slice(tokenStart, allEnd).toLowerCase() === 'all' && hasTokenBoundary(body, allEnd)) {
      for (const user of activeUsers) recipients.set(user.id, user);
      index = allEnd - 1;
      continue;
    }

    const recipient = byName.find((user) => {
      const end = tokenStart + user.name.length;
      return (
        body.slice(tokenStart, end).toLowerCase() === user.name.toLowerCase() &&
        hasTokenBoundary(body, end)
      );
    });
    if (recipient !== undefined) {
      recipients.set(recipient.id, recipient);
      index = tokenStart + recipient.name.length - 1;
    }
  }

  return [...recipients.values()];
}
