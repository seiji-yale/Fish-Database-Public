/**
 * A "⋯" button that opens a small menu of row actions (Edit, Use vials, Remove, ...). It replaces a
 * row of buttons so a list stays easy to scan on a narrow screen. Closes after a choice, on Escape
 * and when the person clicks elsewhere.
 *
 * The list is placed with `position: fixed` next to the button, so a table's scroll container cannot
 * clip it; it opens upward when there is no room below, and follows the button when the page scrolls.
 */
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { strings } from '../strings';

export interface RowMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function RowMenu({ label, items }: { label: string; items: readonly RowMenuItem[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});

  /** Puts the open list right under the button, or above it when the screen has no room below. */
  const itemCount = items.length;
  const position = useCallback(() => {
    const button = ref.current?.querySelector('summary');
    if (button === null || button === undefined) return;
    const rect = button.getBoundingClientRect();
    const needed = itemCount * 44 + 16;
    const below = window.innerHeight - rect.bottom;
    const right = Math.max(8, window.innerWidth - rect.right);
    setPlace(
      below >= needed || rect.top < needed
        ? { top: rect.bottom + 4, right }
        : { bottom: window.innerHeight - rect.top + 4, right },
    );
  }, [itemCount]);

  useEffect(() => {
    function close(event: Event) {
      const menu = ref.current;
      if (menu === null || !menu.open) return;
      if (event.type === 'click' && menu.contains(event.target as Node)) return;
      menu.open = false;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close(event);
    }
    // A fixed list would drift away from its button while the page scrolls: move it along.
    function follow() {
      if (ref.current?.open === true) position();
    }
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [position]);

  return (
    <details
      className="row-menu"
      ref={ref}
      onToggle={() => {
        if (ref.current?.open === true) position();
      }}
    >
      <summary aria-label={label}>{strings.moreActionsIcon}</summary>
      <ul className="row-menu__items" style={place}>
        {items.map((item) => (
          <li key={item.label}>
            <button
              type="button"
              className={item.danger === true ? 'row-menu__danger' : undefined}
              onClick={() => {
                if (ref.current !== null) ref.current.open = false;
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
