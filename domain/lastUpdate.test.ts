import { describe, expect, it } from 'vitest';
import { lastUpdate } from './lastUpdate';

const edit = { at: '2026-09-20T12:00:00Z', byUserId: 'bob' };

describe('BR-4 last update', () => {
  it('is the data change when the line has no chat messages', () => {
    expect(lastUpdate(edit, null)).toEqual(edit);
  });
  it('is a later chat message, with the person who posted it', () => {
    const chat = { at: '2026-09-21T09:00:00Z', byUserId: 'carol' };
    expect(lastUpdate(edit, chat)).toEqual(chat);
  });
  it('stays the data change when the newest chat message is older or at the same time', () => {
    expect(lastUpdate(edit, { at: '2026-09-19T09:00:00Z', byUserId: 'carol' })).toEqual(edit);
    expect(lastUpdate(edit, { at: edit.at, byUserId: 'carol' })).toEqual(edit);
  });
});
