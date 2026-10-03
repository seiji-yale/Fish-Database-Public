/**
 * Shift+Enter sends a chat message (T-023 Part D); plain Enter still starts a new line. It must not fire
 * while an IME is composing (Enter confirms the conversion), with Ctrl/Cmd/Alt held, or for a held key.
 */
export interface EnterKeyLike {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  repeat: boolean;
}

export function isSendShortcut(event: EnterKeyLike): boolean {
  return (
    event.key === 'Enter' &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.isComposing &&
    !event.repeat
  );
}
