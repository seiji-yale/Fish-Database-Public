import type { InviteRow } from '../types';
import { define } from './shared';

/** Invite URLs (ADR-0005); reads and writes are in `worker/lib/accounts.ts`. */
export const INVITES = define<InviteRow>('invites', {
  id: true,
  user_id: true,
  token_hash: true,
  created_by: true,
  created_at: true,
  expires_at: true,
  used_at: true,
});
