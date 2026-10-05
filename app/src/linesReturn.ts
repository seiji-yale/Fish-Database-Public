/**
 * The Line Detail page's "Back to Lines" link returns to the list the person came from, with its
 * view, search, filters and sort, instead of a bare `/lines`. The Lines page remembers its URL here
 * on every change. Storage failures fall back to `/lines`: the remembered view is a courtesy.
 */
const KEY = 'lines-return-url';

export function rememberLinesUrl(url: string): void {
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    /* Private mode or blocked storage: Back to Lines opens the default list. */
  }
}

/** Only a `/lines` list URL is accepted, so a bad stored value can never send the link elsewhere. */
export function linesReturnUrl(): string {
  try {
    const url = sessionStorage.getItem(KEY);
    return url !== null && /^\/lines(\?[^#]*)?$/.test(url) ? url : '/lines';
  } catch {
    return '/lines';
  }
}

/**
 * Runs `refresh` when the browser shows this page again from its back/forward cache. Such a page
 * comes back exactly as it was left, so data changed on another page (an edit on Line Detail) would
 * otherwise stay stale until a manual reload.
 */
export function onPageRestore(refresh: () => void): () => void {
  const listener = (event: PageTransitionEvent) => {
    if (event.persisted) refresh();
  };
  window.addEventListener('pageshow', listener);
  return () => {
    window.removeEventListener('pageshow', listener);
  };
}
