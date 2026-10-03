/**
 * `GET /api/lines` and `GET /api/lines.csv` (T-008, FR-LIST-01…08): the Line List's data source.
 * Child tables are fetched once per request (not once per line, `worker/db/queries/*ByLines`) and
 * assembled, searched, filtered and sorted by the pure functions in `worker/lib/lineList.ts`.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { getSetting } from '../db/queries/settings';
import { listCryoRecordsByLines } from '../db/queries/cryoRecords';
import { listCurrentIdProtocols } from '../db/queries/idProtocols';
import { listLineAttributesByLines } from '../db/queries/lineAttributes';
import { listLinePhenotypesByLines } from '../db/queries/linePhenotypes';
import { listLineReferencesByLines } from '../db/queries/lineReferences';
import { listChatMessagesByLines } from '../db/queries/chatMessages';
import { getLineByName, listLinesForView } from '../db/queries/lines';
import { listUsers } from '../db/queries/users';
import {
  LINE_LIST_SORT_KEYS,
  buildLineList,
  buildLineListCsv,
  lineListCsvFileName,
  matchesFilters,
  matchesSearch,
  sortLineList,
  type LineListItem,
} from '../lib/lineList';
import { labToday } from '../../domain/dates';
import { validateNewLine } from '../../domain/newLine';
import { requireAuthor } from '../lib/attribution';
import { ApiError } from '../lib/errors';
import { protocolDefaultsFrom } from '../lib/protocolWrite';
import { createLine } from '../lib/lineCreate';
import { messages } from '../lib/messages';
import type { Db } from '../db/db';
import type { Bindings } from '../middleware/session';

const PROTOCOL_TYPES = ['none', 'tails', 'pcr', 'pcr_sequence', 'fluorescence', 'custom'] as const;

const listQuery = z.object({
  view: z.enum(['active', 'all', 'closed']).default('active'),
  q: z.string().trim().optional(),
  sort: z.enum(LINE_LIST_SORT_KEYS).optional(),
  dir: z.enum(['asc', 'desc']).default('asc'),
  idMethod: z.enum(PROTOCOL_TYPES).optional(),
  cryo: z.enum(['yes', 'no']).optional(),
  breedSoon: z.literal('1').optional(),
});

export function parseQuery(raw: Record<string, string | undefined>) {
  const result = listQuery.safeParse(raw);
  if (!result.success) throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  return result.data;
}

function todayInLabTimeZone(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
}

export async function loadLineListItems(
  db: Db,
  view: 'active' | 'all' | 'closed',
): Promise<LineListItem[]> {
  const lines = await listLinesForView(db, view);
  const lineIds = lines.map((line) => line.id);
  const protocolIds = [
    ...new Set(
      lines.map((line) => line.current_protocol_id).filter((id): id is string => id !== null),
    ),
  ];
  const [
    phenotypes,
    attributes,
    currentProtocols,
    cryoRecords,
    references,
    chatMessages,
    thresholdRaw,
  ] = await Promise.all([
    listLinePhenotypesByLines(db, lineIds),
    listLineAttributesByLines(db, lineIds),
    listCurrentIdProtocols(db, protocolIds),
    listCryoRecordsByLines(db, lineIds),
    listLineReferencesByLines(db, lineIds),
    listChatMessagesByLines(db, lineIds),
    getSetting(db, 'upcoming_breeding_months'),
  ]);
  const thresholdMonths = Number(thresholdRaw ?? '11');
  return buildLineList({
    lines,
    phenotypes,
    attributes,
    currentProtocols,
    cryoRecords,
    references,
    chatMessages,
    thresholdMonths,
  });
}

export function filterAndSort(
  items: LineListItem[],
  input: ReturnType<typeof listQuery.parse>,
): LineListItem[] {
  const filters = {
    idMethodType: input.idMethod,
    cryopreserved: input.cryo === undefined ? undefined : input.cryo === 'yes',
    breedSoon: input.breedSoon === undefined ? undefined : true,
  };
  const filtered = items
    .filter((item) => matchesFilters(item, filters))
    .filter((item) => matchesSearch(item, input.q ?? ''));
  return sortLineList(filtered, input.sort, input.dir);
}

export const linesRoutes = new Hono<{ Bindings: Bindings }>();

linesRoutes.get('/lines', async (c) => {
  const input = parseQuery(c.req.query());
  const items = await loadLineListItems(c.env.DB, input.view);
  const rows = filterAndSort(items, input);
  return c.json({ view: input.view, total: rows.length, items: rows });
});

linesRoutes.get('/lines.csv', async (c) => {
  const input = parseQuery(c.req.query());
  const [items, users] = await Promise.all([
    loadLineListItems(c.env.DB, input.view),
    listUsers(c.env.DB),
  ]);
  const rows = filterAndSort(items, input);
  const userNames = Object.fromEntries(users.map((user) => [user.id, user.name]));
  const csv = buildLineListCsv(rows, userNames);
  const fileName = lineListCsvFileName(input.view, todayInLabTimeZone());
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${fileName}"`);
  return c.body(csv);
});

/**
 * `GET /api/lines/check-name?name=` (FR-NEW-02, BR-8): the form asks on blur whether a name is
 * free. Registered before `/lines/:id` (lineDetail routes) so `check-name` is never read as an id.
 */
linesRoutes.get('/lines/check-name', async (c) => {
  const name = (c.req.query('name') ?? '').trim();
  if (name === '') return c.json({ available: true });
  const existing = await getLineByName(c.env.DB, name);
  return c.json(
    existing === null
      ? { available: true }
      : { available: false, existing: { id: existing.id, name: existing.name } },
  );
});

const createBody = z.looseObject({ chosenUserId: z.string().min(1).nullish() });

/**
 * `POST /api/lines` (T-011, FR-NEW-01…03): creates a line with version 1 and a `created` activity.
 * The body is the New Line form (`domain/newLine.ts`); the signed-in person is the author
 * (BR-5, ADR-0005). Validation problems come back as 400 INVALID_INPUT
 * with `details.fields` keyed by form field, so the form can show each message inline.
 */
linesRoutes.post('/lines', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  }
  const envelope = createBody.safeParse(body);
  if (!envelope.success) throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  const author = await requireAuthor(c, 'data');

  const formValues: Record<string, unknown> = { ...envelope.data };
  delete formValues.chosenUserId;
  const today = labToday();
  const validation = validateNewLine(formValues, today, await protocolDefaultsFrom(c.env.DB));
  if (!validation.ok)
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, {
      fields: validation.errors,
    });

  const { document, summary } = await createLine(c.env.DB, {
    input: validation.value,
    author,
    today,
  });
  return c.json(
    {
      id: document.line.id,
      name: document.line.name,
      version: 1,
      summary,
      warnings: validation.warnings,
    },
    201,
  );
});
