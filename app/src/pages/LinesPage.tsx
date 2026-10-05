/**
 * `/lines` (T-008, FR-LIST-01…08): the Active/All/Closed line list, sortable table on desktop /
 * cards on phone, with filter chips, search, a Columns toggle and CSV export. URL state
 * (`?view=&sort=&dir=&q=&idMethod=&cryo=&breedSoon=`) makes the current view bookmarkable and
 * restores on the browser back button (FR-LIST-02); the CSV export uses the same query, so it
 * always matches what is on screen (FR-LIST-05).
 */
import { useEffect, useRef, useState } from 'react';
import {
  DataTable,
  EmptyState,
  SegmentedControl,
  Skeleton,
  StatusBadge,
  type DataColumn,
} from '../components/shared';
import { formatDate, formatDateTime } from '../dateFormat';
import {
  getLines,
  linesCsvUrl,
  type LineListItem,
  type LineListReference,
  type LineListView,
} from '../linesApi';
import { getUsers, type SessionUser } from '../session';
import { strings } from '../strings';
import { visibleSearchInput } from '../slashShortcut';
import { onPageRestore, rememberLinesUrl } from '../linesReturn';

interface UrlState {
  view: LineListView;
  q?: string | undefined;
  sort?: string | undefined;
  dir: 'asc' | 'desc';
  idMethod?: string | undefined;
  cryo?: 'yes' | 'no' | undefined;
  breedSoon?: boolean | undefined;
}

const VIEW_LABELS = [strings.linesViewActive, strings.linesViewAll, strings.closed] as const;
const LABEL_TO_VIEW: Record<(typeof VIEW_LABELS)[number], LineListView> = {
  [strings.linesViewActive]: 'active',
  [strings.linesViewAll]: 'all',
  [strings.closed]: 'closed',
};
const VIEW_TO_LABEL: Record<LineListView, (typeof VIEW_LABELS)[number]> = {
  active: strings.linesViewActive,
  all: strings.linesViewAll,
  closed: strings.closed,
};

const ID_METHOD_LABELS: Record<string, string> = {
  none: strings.idMethodNone,
  tails: strings.idMethodTails,
  pcr: strings.idMethodPcr,
  pcr_sequence: strings.idMethodPcrSequence,
  fluorescence: strings.idMethodFluorescence,
  custom: strings.idMethodCustom,
};

const CRYO_LABELS = [strings.filterCryopreservedAny, strings.yes, strings.no] as const;
const CRYO_LABEL_TO_VALUE: Record<(typeof CRYO_LABELS)[number], 'yes' | 'no' | undefined> = {
  [strings.filterCryopreservedAny]: undefined,
  [strings.yes]: 'yes',
  [strings.no]: 'no',
};
const CRYO_VALUE_TO_LABEL: Record<'any' | 'yes' | 'no', (typeof CRYO_LABELS)[number]> = {
  any: strings.filterCryopreservedAny,
  yes: strings.yes,
  no: strings.no,
};

/** The Sort by menu (owner request, 2026-10): phones have no table headers to click, so the common
 * orders are named here. Each is a `sort:dir` pair; the empty sort is the default (Status, then
 * Line). A header sort that is not listed shows as Custom. */
const SORT_PRESETS: readonly { value: string; label: string }[] = [
  { value: ':asc', label: strings.sortStatusAsc },
  { value: 'status:desc', label: strings.sortStatusDesc },
  { value: 'name:asc', label: strings.sortNameAsc },
  { value: 'dob:desc', label: strings.sortDobDesc },
  { value: 'dob:asc', label: strings.sortDobAsc },
  { value: 'lastUpdateAt:desc', label: strings.sortLastUpdateDesc },
];
const CUSTOM_SORT = 'custom';

function sortPresetValue(state: UrlState): string {
  // `status:asc` is the default order, so it shows as the first preset too.
  const value =
    state.sort === 'status' && state.dir === 'asc' ? ':asc' : `${state.sort ?? ''}:${state.dir}`;
  return SORT_PRESETS.some((preset) => preset.value === value) ? value : CUSTOM_SORT;
}

const COLUMNS_STORAGE_KEY = 'lines-optional-columns';
const OPTIONAL_COLUMN_KEYS = ['lastUpdateAt', 'ageMonths', 'notes'] as const;
type OptionalColumnKey = (typeof OPTIONAL_COLUMN_KEYS)[number];

function loadOptionalColumns(): Set<OptionalColumnKey> {
  try {
    const raw = localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    const known: readonly string[] = OPTIONAL_COLUMN_KEYS;
    const keys = parsed.filter(
      (key: unknown): key is OptionalColumnKey => typeof key === 'string' && known.includes(key),
    );
    return new Set(keys);
  } catch {
    return new Set();
  }
}

function saveOptionalColumns(keys: ReadonlySet<OptionalColumnKey>): void {
  try {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify([...keys]));
  } catch {
    /* Private browsing / storage disabled: the toggle still works for this page view. */
  }
}

function stateFromLocation(): UrlState {
  const params = new URLSearchParams(window.location.search);
  const view = params.get('view');
  const dir = params.get('dir');
  const cryo = params.get('cryo');
  return {
    view: view === 'all' || view === 'closed' ? view : 'active',
    q: params.get('q') ?? undefined,
    sort: params.get('sort') ?? undefined,
    dir: dir === 'desc' ? 'desc' : 'asc',
    idMethod: params.get('idMethod') ?? undefined,
    cryo: cryo === 'yes' || cryo === 'no' ? cryo : undefined,
    breedSoon: params.get('breedSoon') === '1' ? true : undefined,
  };
}

function urlFor(state: UrlState): string {
  const params = new URLSearchParams();
  if (state.view !== 'active') params.set('view', state.view);
  if (state.q !== undefined && state.q !== '') params.set('q', state.q);
  if (state.sort !== undefined) {
    params.set('sort', state.sort);
    if (state.dir === 'desc') params.set('dir', state.dir);
  }
  if (state.idMethod !== undefined) params.set('idMethod', state.idMethod);
  if (state.cryo !== undefined) params.set('cryo', state.cryo);
  if (state.breedSoon === true) params.set('breedSoon', '1');
  const query = params.toString();
  return query === '' ? '/lines' : `/lines?${query}`;
}

function hasActiveFilter(state: UrlState): boolean {
  return (
    (state.q !== undefined && state.q !== '') ||
    state.idMethod !== undefined ||
    state.cryo !== undefined ||
    state.breedSoon === true
  );
}

function ReferenceCell({ references }: { references: readonly LineListReference[] }) {
  if (references.length === 0) return <span>{strings.emptyValue}</span>;
  const shown = references.slice(0, 2);
  const extra = references.length - shown.length;
  return (
    <span className="reference-cell">
      {shown.map((reference, index) => (
        <span className="reference-cell__item" key={reference.id}>
          {index > 0 ? '; ' : ''}
          {reference.url !== null ? (
            <a
              href={reference.url}
              target="_blank"
              rel="noreferrer"
              // The whole row/card is also clickable (opens the Line Detail page); without this the
              // link's own navigation and the row's onClick would both fire on the same tap.
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              {reference.title}
            </a>
          ) : reference.hasAttachment ? (
            reference.title
          ) : (
            <span
              className="reference-cell__missing"
              title={strings.referenceMissingLink}
              aria-label={`${reference.title}: ${strings.referenceMissingLink}`}
            >
              <span aria-hidden="true">{strings.referenceMissingIcon}</span>
              {reference.title}
            </span>
          )}
        </span>
      ))}
      {extra > 0 ? <span> {strings.moreReferences(extra)}</span> : null}
    </span>
  );
}

function DobCell({ item }: { item: LineListItem }) {
  if (item.dob === null) return <span>{strings.emptyValue}</span>;
  return (
    <span>
      <span className="nowrap">
        {formatDate(item.dob)}
        {item.ageMonths !== null ? ` (${strings.ageMonths(item.ageMonths)})` : ''}
      </span>
      {/* A break opportunity, so a narrow column puts "Breed soon" on its own line. */}
      <wbr />
      {item.needsBreeding ? (
        <span className="breed-soon">
          <span aria-hidden="true">{strings.breedSoonIcon}</span>
          {` ${strings.breedSoon}`}
        </span>
      ) : null}
    </span>
  );
}

/** The line's name as a real link to its detail page: it looks and behaves like one (underline on
 * hover, open in a new tab with Ctrl/Cmd-click), and the row/card around it opens the same page. */
function LineLink({ item }: { item: LineListItem }) {
  return (
    <a
      className="line-link"
      href={`/lines/${encodeURIComponent(item.id)}`}
      title={strings.openLineDetails(item.name)}
      // The row/card is clickable too; without this the link and the row would both navigate.
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {item.name}
    </a>
  );
}

/** The phone card: only what is needed to pick a line at a glance (owner request, 2026-10): the
 * name and status, the gene as a quiet subtitle, then the latest generation's DOB (age, Breed soon)
 * and the ID Method as two labelled facts. Everything else is one tap away on the detail page. */
function LineCard({ item }: { item: LineListItem }) {
  return (
    <>
      <div className="line-card__head">
        <LineLink item={item} />
        <StatusBadge status={item.status} />
      </div>
      {item.gene === null ? null : <p className="line-card__gene">{item.gene}</p>}
      <dl className="line-card__facts">
        <div>
          <dt>{strings.dob}</dt>
          <dd>
            {item.dob === null ? (
              strings.emptyValue
            ) : (
              <>
                {formatDate(item.dob)}
                {item.ageMonths !== null ? (
                  <span className="line-card__age">{` (${strings.ageMonths(item.ageMonths)})`}</span>
                ) : null}
              </>
            )}
            {item.needsBreeding ? (
              <span className="breed-soon line-card__breed-soon">
                <span aria-hidden="true">{strings.breedSoonIcon}</span>
                {` ${strings.breedSoon}`}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>{strings.idMethod}</dt>
          <dd>{item.idMethod}</dd>
        </div>
      </dl>
    </>
  );
}

const BASE_COLUMNS: readonly DataColumn<LineListItem>[] = [
  {
    key: 'name',
    label: strings.line,
    render: (item) => (
      <span className="nowrap">
        <LineLink item={item} />
      </span>
    ),
  },
  { key: 'gene', label: strings.gene, render: (item) => item.gene ?? strings.emptyValue },
  {
    key: 'phenotypes',
    label: strings.phenotypes,
    render: (item) =>
      item.phenotypes.length > 0 ? item.phenotypes.join('; ') : strings.emptyValue,
  },
  { key: 'dob', label: strings.dob, render: (item) => <DobCell item={item} /> },
  { key: 'status', label: strings.status, render: (item) => <StatusBadge status={item.status} /> },
  {
    key: 'idMethod',
    label: strings.idMethod,
    render: (item) => <span className="nowrap">{item.idMethod}</span>,
  },
  {
    key: 'lastIdDate',
    label: strings.lastIdDate,
    render: (item) => (item.lastIdDate === null ? strings.emptyValue : formatDate(item.lastIdDate)),
  },
  { key: 'idedNumber', label: strings.idedNumber },
  {
    key: 'isCryopreserved',
    label: strings.cryopreserved,
    render: (item) => (item.isCryopreserved ? strings.yes : strings.no),
  },
  {
    key: 'references',
    label: strings.references,
    render: (item) => <ReferenceCell references={item.references} />,
  },
];

function optionalColumns(
  enabled: ReadonlySet<OptionalColumnKey>,
  userNames: Readonly<Record<string, string>>,
): DataColumn<LineListItem>[] {
  const columns: DataColumn<LineListItem>[] = [];
  if (enabled.has('lastUpdateAt'))
    columns.push({
      key: 'lastUpdateAt',
      label: strings.columnLastUpdate,
      render: (item) =>
        `${formatDateTime(item.lastUpdateAt)} (${userNames[item.lastUpdateBy] ?? item.lastUpdateBy})`,
    });
  if (enabled.has('ageMonths'))
    columns.push({
      key: 'ageMonths',
      label: strings.columnAgeMonths,
      render: (item) => (item.ageMonths === null ? strings.emptyValue : String(item.ageMonths)),
    });
  if (enabled.has('notes'))
    columns.push({
      key: 'notes',
      label: strings.columnNotes,
      render: (item) => item.notes ?? strings.emptyValue,
    });
  return columns;
}

const SORTABLE_KEYS = new Set([
  'name',
  'gene',
  'phenotypes',
  'dob',
  'status',
  'idMethod',
  'lastIdDate',
  'idedNumber',
  'isCryopreserved',
  'references',
  'lastUpdateAt',
  'ageMonths',
  'notes',
]);

export function LinesPage() {
  const [state, setState] = useState<UrlState>(() => stateFromLocation());
  const [searchInput, setSearchInput] = useState(() => stateFromLocation().q ?? '');
  const [items, setItems] = useState<LineListItem[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [optionalColumnKeys, setOptionalColumnKeys] = useState<Set<OptionalColumnKey>>(() =>
    loadOptionalColumns(),
  );
  // Lets the debounce effect below read the latest `state` without listing it as a dependency
  // (which would restart the debounce timer on every navigation, not just every keystroke).
  const stateRef = useRef(state);
  stateRef.current = state;

  // The phone tab bar's Search opens `/lines#search`: put the cursor in the search box.
  useEffect(() => {
    if (window.location.hash === '#search') visibleSearchInput()?.focus();
  }, []);

  useEffect(() => {
    function onPopState() {
      const next = stateFromLocation();
      setItems(null);
      setError(null);
      setState(next);
      setSearchInput(next.q ?? '');
    }
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  // Line Detail's Back to Lines link returns to this exact view.
  useEffect(() => {
    rememberLinesUrl(urlFor(state));
  }, [state]);

  // Back from a line restores this page from the browser's cache as it was: fetch the list again
  // so an edit made on the detail page shows up (owner request, 2026-10).
  useEffect(
    () =>
      onPageRestore(() => {
        setReloadKey((key) => key + 1);
      }),
    [],
  );

  useEffect(() => {
    getUsers()
      .then((list) => {
        setUsers(list);
      })
      .catch(() => undefined);
  }, []);

  // Fetches whenever the (URL-driven) query changes. `items`/`error` are reset by whatever
  // triggered the change (`navigate`, the popstate handler, or the initial `useState`), not here:
  // an effect body should only talk to the external system, not set state synchronously itself.
  useEffect(() => {
    let cancelled = false;
    getLines({
      view: state.view,
      q: state.q,
      sort: state.sort,
      dir: state.dir,
      idMethod: state.idMethod,
      cryo: state.cryo,
      breedSoon: state.breedSoon,
    })
      .then((response) => {
        if (!cancelled) setItems(response.items);
      })
      .catch(() => {
        if (!cancelled) setError(strings.requestFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [
    state.view,
    state.q,
    state.sort,
    state.dir,
    state.idMethod,
    state.cryo,
    state.breedSoon,
    reloadKey,
  ]);

  // Debounces the search box: typing updates `searchInput` immediately, but the URL/fetch only
  // follow after a short pause, so a fetch is not fired on every keystroke.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === (stateRef.current.q ?? '')) return;
    const timeout = window.setTimeout(() => {
      navigate({ ...stateRef.current, q: trimmed === '' ? undefined : trimmed });
    }, 300);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchInput]);

  function navigate(next: UrlState) {
    window.history.pushState(null, '', urlFor(next));
    setItems(null);
    setError(null);
    setState(next);
  }

  function onViewChange(label: string) {
    const view = LABEL_TO_VIEW[label as (typeof VIEW_LABELS)[number]];
    navigate({ ...state, view });
  }

  function onSort(key: string) {
    if (!SORTABLE_KEYS.has(key)) return;
    const dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
    navigate({ ...state, sort: key, dir });
  }

  function onRowClick(item: LineListItem) {
    window.location.href = `/lines/${item.id}`;
  }

  function onSortPresetChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const [sort = '', dir] = event.target.value.split(':');
    navigate({
      ...state,
      sort: sort === '' ? undefined : sort,
      dir: dir === 'desc' ? 'desc' : 'asc',
    });
  }

  function onIdMethodChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    navigate({ ...state, idMethod: value === '' ? undefined : value });
  }

  function onCryoChange(label: string) {
    const value = CRYO_LABEL_TO_VALUE[label as (typeof CRYO_LABELS)[number]];
    navigate({ ...state, cryo: value });
  }

  function onBreedSoonToggle() {
    navigate({ ...state, breedSoon: state.breedSoon === true ? undefined : true });
  }

  function toggleColumn(key: OptionalColumnKey) {
    setOptionalColumnKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveOptionalColumns(next);
      return next;
    });
  }

  const userNames = Object.fromEntries(users.map((user) => [user.id, user.name]));
  const columns = [...BASE_COLUMNS, ...optionalColumns(optionalColumnKeys, userNames)];

  return (
    <section className="lines-page">
      <h1>{strings.lines}</h1>
      <div className="lines-toolbar">
        <SegmentedControl
          label={strings.lines}
          options={VIEW_LABELS}
          value={VIEW_TO_LABEL[state.view]}
          onChange={onViewChange}
        />
        <label className="lines-search">
          <svg
            className="lines-search__icon"
            aria-hidden="true"
            viewBox="0 0 24 24"
            focusable="false"
          >
            <circle cx="10.8" cy="10.8" r="6.3" />
            <path d="m15.5 15.5 5 5" />
          </svg>
          <input
            type="search"
            data-search-input=""
            aria-label={strings.searchLabel}
            placeholder={strings.searchPlaceholder}
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
            }}
          />
        </label>
      </div>
      {/* Every filter is a caption above its control, bottom-aligned in one tinted panel, so it is
          clear what each set of buttons filters (owner feedback on PR #13). */}
      <div className="lines-filters" role="group" aria-label={strings.filters}>
        <label className="filter-field">
          <span className="filter-field__label">{strings.sortBy}</span>
          <select value={sortPresetValue(state)} onChange={onSortPresetChange}>
            {SORT_PRESETS.map((preset) => (
              <option key={preset.value} value={preset.value}>
                {preset.label}
              </option>
            ))}
            {sortPresetValue(state) === CUSTOM_SORT ? (
              <option value={CUSTOM_SORT} disabled>
                {strings.sortCustom}
              </option>
            ) : null}
          </select>
        </label>
        <label className="filter-field">
          <span className="filter-field__label">{strings.filterIdMethod}</span>
          <select value={state.idMethod ?? ''} onChange={onIdMethodChange}>
            <option value="">{strings.filterIdMethodAny}</option>
            {Object.entries(ID_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-field">
          <span className="filter-field__label" aria-hidden="true">
            {strings.filterCryopreserved}
          </span>
          <SegmentedControl
            label={strings.filterCryopreserved}
            options={CRYO_LABELS}
            value={CRYO_VALUE_TO_LABEL[state.cryo ?? 'any']}
            onChange={onCryoChange}
          />
        </div>
        <div className="filter-field">
          <span className="filter-field__label" aria-hidden="true">
            {strings.filterUpcomingBreeding}
          </span>
          <button
            type="button"
            aria-pressed={state.breedSoon === true}
            className={state.breedSoon === true ? 'is-selected' : ''}
            onClick={onBreedSoonToggle}
          >
            <span aria-hidden="true">{strings.breedSoonIcon}</span> {strings.filterBreedSoonOnly}
          </button>
        </div>
      </div>
      <div className="lines-toolbar">
        <details className="lines-columns">
          <summary>{strings.columnsToggle}</summary>
          {OPTIONAL_COLUMN_KEYS.map((key) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={optionalColumnKeys.has(key)}
                onChange={() => {
                  toggleColumn(key);
                }}
              />
              {key === 'lastUpdateAt'
                ? strings.columnLastUpdate
                : key === 'ageMonths'
                  ? strings.columnAgeMonths
                  : strings.columnNotes}
            </label>
          ))}
        </details>
        <a className="button--primary" href={linesCsvUrl(state)}>
          {strings.exportCsv}
        </a>
      </div>
      {error !== null ? (
        <p role="alert">{error}</p>
      ) : items === null ? (
        <Skeleton lines={6} />
      ) : items.length === 0 ? (
        <EmptyState message={hasActiveFilter(state) ? strings.linesNoMatch : strings.linesEmpty} />
      ) : (
        <>
          <p className="lines-open-hint">{strings.linesOpenHint}</p>
          <DataTable
            columns={columns}
            rows={items}
            sort={state.sort === undefined ? undefined : { key: state.sort, dir: state.dir }}
            onSort={onSort}
            onRowClick={onRowClick}
            renderCard={(item) => <LineCard item={item} />}
          />
        </>
      )}
    </section>
  );
}
