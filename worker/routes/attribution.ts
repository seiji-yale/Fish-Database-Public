import { Hono } from 'hono';
import { z } from 'zod';
import { getUserById } from '../db/queries/users';
import { requireAuthor } from '../lib/attribution';
import type { Bindings } from '../middleware/session';

/**
 * `POST /api/attribution/check` — answers "who would be recorded as the author of this change?"
 * without writing anything. It returns exactly the errors a real write would (403 FORBIDDEN for
 * a Guest, 401 LOGIN_REQUIRED without a session). The signed-in person is always the author (ADR-0005).
 */
export const attributionRoutes = new Hono<{ Bindings: Bindings }>();

const checkBody = z.object({
  action: z.enum(['data', 'chat']),
  chosenUserId: z.string().min(1).nullish(),
});

attributionRoutes.post('/attribution/check', async (c) => {
  const input = checkBody.parse(await c.req.json());
  const author = await requireAuthor(c, input.action);
  const user = await getUserById(c.env.DB, author.authorId);
  return c.json({
    authorId: author.authorId,
    authorName: user?.name ?? null,
    viaAdmin: author.viaAdmin,
  });
});
