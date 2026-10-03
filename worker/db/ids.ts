/** Ids and timestamps for new rows. Callers pass the results in; the query helpers never call these. */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** A ULID: 48-bit millisecond timestamp + 80 random bits, 26 Crockford base-32 characters. */
export function newId(nowMs: number = Date.now()): string {
  let time = '';
  let remaining = nowMs;
  for (let i = 0; i < 10; i += 1) {
    time = (CROCKFORD[remaining % 32] ?? '0') + time;
    remaining = Math.floor(remaining / 32);
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  let suffix = '';
  for (const byte of random) suffix += CROCKFORD[byte % 32] ?? '0';
  return time + suffix;
}

/** ISO-8601 UTC timestamp without milliseconds, e.g. `2026-09-25T19:12:00Z`. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
