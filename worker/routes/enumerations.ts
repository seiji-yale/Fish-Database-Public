/**
 * `GET /api/enumerations?kind=` (T-011): the active values of one Admin-editable list, in display
 * order, for pickers (attribute-name suggestions, fluorophores, cryo places). Read-only.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { listEnumerations } from '../db/queries/enumerations';
import { getSetting } from '../db/queries/settings';
import { protocolDefaultsFrom } from '../lib/protocolWrite';
import { ApiError } from '../lib/errors';
import { messages } from '../lib/messages';
import type { Bindings } from '../middleware/session';

const query = z.object({
  kind: z.enum(['id_method_type', 'fluorophore', 'cryo_place', 'request_type', 'attribute_key']),
});

export const enumerationRoutes = new Hono<{ Bindings: Bindings }>();

enumerationRoutes.get('/enumerations', async (c) => {
  const parsed = query.safeParse(c.req.query());
  if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  const rows = await listEnumerations(c.env.DB, parsed.data.kind);
  return c.json({ kind: parsed.data.kind, values: rows.map((row) => row.value) });
});

/**
 * `GET /api/settings/public`: the Admin-set values every form needs — the defaults of a new PCR
 * protocol and the Upcoming Breeding threshold. Read-only, no secrets.
 */
enumerationRoutes.get('/settings/public', async (c) => {
  const defaults = await protocolDefaultsFrom(c.env.DB);
  return c.json({
    defaultAnnealingC: defaults.annealing_c ?? 60,
    defaultCycles: defaults.cycles ?? 35,
    upcomingBreedingMonths: Number(
      (await getSetting(c.env.DB, 'upcoming_breeding_months')) ?? '11',
    ),
  });
});
