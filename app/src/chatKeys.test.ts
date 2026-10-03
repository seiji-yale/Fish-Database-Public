import { describe, expect, it } from 'vitest';
import { isSendShortcut, type EnterKeyLike } from './chatKeys';

const shiftEnter: EnterKeyLike = {
  key: 'Enter',
  shiftKey: true,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  repeat: false,
};

describe('isSendShortcut', () => {
  it('is Shift+Enter', () => {
    expect(isSendShortcut(shiftEnter)).toBe(true);
  });

  it('leaves plain Enter alone (it inserts a new line)', () => {
    expect(isSendShortcut({ ...shiftEnter, shiftKey: false })).toBe(false);
  });

  it('ignores other keys and other modifiers', () => {
    expect(isSendShortcut({ ...shiftEnter, key: 'a' })).toBe(false);
    expect(isSendShortcut({ ...shiftEnter, ctrlKey: true })).toBe(false);
    expect(isSendShortcut({ ...shiftEnter, metaKey: true })).toBe(false);
    expect(isSendShortcut({ ...shiftEnter, altKey: true })).toBe(false);
  });

  it('ignores IME composition and a held key', () => {
    expect(isSendShortcut({ ...shiftEnter, isComposing: true })).toBe(false);
    expect(isSendShortcut({ ...shiftEnter, repeat: true })).toBe(false);
  });
});
