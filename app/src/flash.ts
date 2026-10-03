/**
 * A one-shot message that survives a full page load (this app has no client router): the New Line
 * form sets it before opening the created line, and the Line Detail page shows it once as a toast
 * (FR-GLB-03). Storage failures are ignored: the message is a courtesy, not data.
 */
const KEY = 'flash-message';

export function setFlash(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    /* Private mode or blocked storage: skip the toast. */
  }
}

export function takeFlash(): string | null {
  try {
    const message = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return message;
  } catch {
    return null;
  }
}
