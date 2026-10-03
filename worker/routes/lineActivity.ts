/**
 * Change Activity endpoints (T-013, FR-ACT-02…08, BR-1, BR-2, BR-4):
 * `POST /api/lines/:id/start-breeding | genotyping | close | reopen`.
 * Every one goes through `withLineWrite` (one version, one activity, optimistic locking) and the
 * pure rules of `domain/breeding.ts`; a rule violation is a 409 (transition) or 400 (input) answer.
 */
import { Hono } from 'hono';
import {
  validateClose,
  validateGenotyping,
  validateReopen,
  validateStartBreeding,
  type ActivityValidation,
} from '../../domain/activity';
import { labToday } from '../../domain/dates';
import { nowIso } from '../db/ids';
import { requireAuthor } from '../lib/attribution';
import { findStaged } from '../lib/attachmentWrite';
import { ApiError } from '../lib/errors';
import {
  activityError,
  closeChange,
  genotypingChange,
  reopenChange,
  startBreedingChange,
} from '../lib/lineActivity';
import { withLineWrite, type LineWriteInput } from '../lib/lineWrite';
import { messages } from '../lib/messages';
import type { Bindings } from '../middleware/session';

export const lineActivityRoutes = new Hono<{ Bindings: Bindings }>();

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body !== null && typeof body === 'object' && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
}

function valid<T>(result: ActivityValidation<T>): T {
  if (!result.ok)
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, {
      fields: result.errors,
    });
  return result.value;
}

/** The body without the attribution answer, and who is recorded as the author (BR-5). */
async function authorAndForm(c: Parameters<typeof requireAuthor>[0]) {
  const body = await readBody(c.req.raw);
  const author = await requireAuthor(c, 'data');
  const form = { ...body };
  delete form['chosenUserId'];
  return { author, form };
}

async function write(
  c: Parameters<typeof requireAuthor>[0],
  input: Omit<LineWriteInput, 'lineId' | 'author'> & { author: LineWriteInput['author'] },
) {
  const lineId = c.req.param('id') ?? '';
  try {
    const result = await withLineWrite(c.env.DB, { ...input, lineId });
    return c.json({ id: lineId, version: result.versionNo, summary: result.summary });
  } catch (error) {
    throw activityError(error);
  }
}

lineActivityRoutes.post('/lines/:id/start-breeding', async (c) => {
  const { author, form } = await authorAndForm(c);
  const today = labToday();
  const input = valid(validateStartBreeding(form, today));
  const now = nowIso();
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: 'breeding_started',
    note: input.note,
    now,
    mutate: (before) => startBreedingChange(before, input.crossDate, today),
  });
});

lineActivityRoutes.post('/lines/:id/genotyping', async (c) => {
  const { author, form } = await authorAndForm(c);
  const today = labToday();
  const input = valid(validateGenotyping(form, today));
  if (input.attachmentId !== null)
    await findStaged(c.env.DB, c.req.param('id'), input.attachmentId, 'attachmentId');
  const now = nowIso();
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: input.isNewGeneration ? 'genotyping_new_gen' : 'genotyping_same_gen',
    note: input.note,
    now,
    mutate: (before) => genotypingChange(c.env.DB, before, input, author, today, now),
  });
});

lineActivityRoutes.post('/lines/:id/close', async (c) => {
  const { author, form } = await authorAndForm(c);
  const today = labToday();
  const input = valid(validateClose(form));
  const now = nowIso();
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: 'closed',
    note: input.reason,
    now,
    mutate: (before) => closeChange(before, today, input.reason),
  });
});

lineActivityRoutes.post('/lines/:id/reopen', async (c) => {
  const { author, form } = await authorAndForm(c);
  const input = valid(validateReopen(form));
  const now = nowIso();
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: 'reopened',
    note: input.note,
    now,
    mutate: reopenChange,
  });
});
