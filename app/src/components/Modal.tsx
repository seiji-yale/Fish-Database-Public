/**
 * A modal dialog with a real focus trap: focus moves in on open (to `initialFocus`, or the first
 * focusable element), Tab and Shift+Tab stay inside, Escape asks the owner to close, and focus
 * returns to whatever had it before (the button that opened the dialog).
 */
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Modal({
  title,
  titleId,
  children,
  onClose,
  initialFocus,
  wide = false,
}: {
  title: string;
  titleId: string;
  children: ReactNode;
  onClose: () => void;
  /** CSS selector of the element that gets focus first. */
  initialFocus?: string;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target =
      (initialFocus === undefined ? null : ref.current?.querySelector<HTMLElement>(initialFocus)) ??
      ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus();
    return () => {
      opener?.focus();
    };
    // Focus is placed once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        className={`dialog${wide ? ' dialog--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
