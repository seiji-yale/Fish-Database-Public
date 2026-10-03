/**
 * The `/` shortcut (T-026, OQ-33): pressing `/` anywhere moves the cursor to the search box.
 * It never steals a `/` the person is typing: it is ignored in editable controls, during IME
 * composition, with a modifier key, while a dialog is open, and when a key is held down.
 */

export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  repeat: boolean;
  defaultPrevented: boolean;
}

export interface FocusContext {
  /** The element that has focus now (event target). */
  target: {
    tagName: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  } | null;
  /** A modal dialog is open. */
  dialogOpen: boolean;
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

export function isEditable(target: FocusContext['target']): boolean {
  if (target === null) return false;
  if (EDITABLE_TAGS.has(target.tagName.toUpperCase())) return true;
  if (target.isContentEditable === true) return true;
  const attribute = target.getAttribute?.('contenteditable');
  return attribute !== null && attribute !== undefined && attribute !== 'false';
}

export function shouldFocusSearch(event: KeyLike, context: FocusContext): boolean {
  return (
    event.key === '/' &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey &&
    !event.isComposing &&
    !event.repeat &&
    !event.defaultPrevented &&
    !context.dialogOpen &&
    !isEditable(context.target)
  );
}

/** The search box to focus: the first one that is on screen (header on desktop, page box otherwise). */
export function visibleSearchInput(root: ParentNode = document): HTMLInputElement | null {
  const inputs = [...root.querySelectorAll<HTMLInputElement>('input[data-search-input]')];
  return inputs.find((input) => input.offsetParent !== null) ?? null;
}

/** Wires the shortcut to the whole page; returns the function that removes it. */
export function installSlashShortcut(): () => void {
  function onKeyDown(event: KeyboardEvent) {
    const dialogOpen = document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
    if (!shouldFocusSearch(event, { target: event.target as Element | null, dialogOpen })) return;
    const input = visibleSearchInput();
    if (input === null) return;
    event.preventDefault();
    input.focus();
    input.select();
  }
  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
  };
}
