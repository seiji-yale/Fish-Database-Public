import { describe, expect, it } from 'vitest';
import { isEditable, shouldFocusSearch, type FocusContext, type KeyLike } from './slashShortcut';

const slash: KeyLike = {
  key: '/',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  isComposing: false,
  repeat: false,
  defaultPrevented: false,
};
const body: FocusContext = { target: { tagName: 'BODY' }, dialogOpen: false };

describe('shouldFocusSearch', () => {
  it('fires for a plain "/" on the page', () => {
    expect(shouldFocusSearch(slash, body)).toBe(true);
    expect(shouldFocusSearch(slash, { target: null, dialogOpen: false })).toBe(true);
  });

  it('ignores other keys and modifier combinations', () => {
    expect(shouldFocusSearch({ ...slash, key: 'a' }, body)).toBe(false);
    expect(shouldFocusSearch({ ...slash, ctrlKey: true }, body)).toBe(false);
    expect(shouldFocusSearch({ ...slash, metaKey: true }, body)).toBe(false);
    expect(shouldFocusSearch({ ...slash, altKey: true }, body)).toBe(false);
  });

  it('ignores IME composition, a held key and an already handled key', () => {
    expect(shouldFocusSearch({ ...slash, isComposing: true }, body)).toBe(false);
    expect(shouldFocusSearch({ ...slash, repeat: true }, body)).toBe(false);
    expect(shouldFocusSearch({ ...slash, defaultPrevented: true }, body)).toBe(false);
  });

  it('never steals a "/" typed into an editable control', () => {
    for (const tagName of ['INPUT', 'textarea', 'SELECT'])
      expect(shouldFocusSearch(slash, { target: { tagName }, dialogOpen: false })).toBe(false);
    expect(
      shouldFocusSearch(slash, {
        target: { tagName: 'DIV', isContentEditable: true },
        dialogOpen: false,
      }),
    ).toBe(false);
  });

  it('ignores the shortcut while a dialog is open', () => {
    expect(shouldFocusSearch(slash, { ...body, dialogOpen: true })).toBe(false);
  });
});

describe('isEditable', () => {
  it('knows contenteditable attributes', () => {
    const attr = (value: string | null) => ({ tagName: 'DIV', getAttribute: () => value });
    expect(isEditable(attr('true'))).toBe(true);
    expect(isEditable(attr(''))).toBe(true);
    expect(isEditable(attr('false'))).toBe(false);
    expect(isEditable(attr(null))).toBe(false);
    expect(isEditable({ tagName: 'A' })).toBe(false);
    expect(isEditable(null)).toBe(false);
  });
});
