/**
 * The search box in the header on desktop (T-026, FR-GLB-05, OQ-33). Enter opens `/lines?q=…`; on the
 * Lines page typing filters live. The URL `q` parameter is the single source of truth, shared with the
 * Lines page's own box (shown on phone and tablet). `/` focuses it from anywhere (`slashShortcut.ts`).
 * With `placement="page"` the same box sits on the Dashboard below desktop width, where the header has none.
 */
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { strings } from '../strings';

const onLinesPage = () => window.location.pathname === '/lines';
const currentQuery = () =>
  onLinesPage() ? (new URLSearchParams(window.location.search).get('q') ?? '') : '';

export function HeaderSearch({ placement = 'header' }: { placement?: 'header' | 'page' }) {
  const [value, setValue] = useState(currentQuery);
  const timer = useRef<number | undefined>(undefined);

  // Back/forward on the Lines page changes `q`: follow it.
  useEffect(() => {
    const follow = () => {
      setValue(currentQuery());
    };
    window.addEventListener('popstate', follow);
    return () => {
      window.removeEventListener('popstate', follow);
    };
  }, []);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
    },
    [],
  );

  function go(text: string) {
    const trimmed = text.trim();
    const params = new URLSearchParams(onLinesPage() ? window.location.search : '');
    if (trimmed === '') params.delete('q');
    else params.set('q', trimmed);
    const url = `/lines${params.toString() === '' ? '' : `?${params.toString()}`}`;
    if (onLinesPage()) {
      // The Lines page listens to `popstate`: it re-reads the URL and filters without a reload.
      window.history.pushState(null, '', url);
      window.dispatchEvent(new PopStateEvent('popstate'));
    } else window.location.assign(url);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    window.clearTimeout(timer.current);
    go(value);
  }

  return (
    <form className={`header-search header-search--${placement}`} role="search" onSubmit={submit}>
      <input
        type="search"
        data-search-input=""
        aria-label={strings.searchLabel}
        aria-keyshortcuts="/"
        placeholder={strings.headerSearchPlaceholder}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (!onLinesPage()) return;
          window.clearTimeout(timer.current);
          const next = event.target.value;
          timer.current = window.setTimeout(() => {
            go(next);
          }, 300);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') event.currentTarget.blur();
        }}
      />
      <kbd className="header-search__key" aria-hidden="true">
        {strings.headerSearchKey}
      </kbd>
    </form>
  );
}
