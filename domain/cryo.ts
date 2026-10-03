/** BR-6: a line is Cryopreserved iff it has at least one live (not soft-deleted) cryo record. */
export function isCryopreserved(liveCryoRecordCount: number): boolean {
  return liveCryoRecordCount > 0;
}

/**
 * FR-CRYO-01: "Count (derived from range or entered)". IDs look like `C0548`; the count of a range
 * is `end - start + 1`. Returns null when either end is not `<letters><digits>` with the same
 * letters, or the range runs backwards, so the caller falls back to the number that was entered.
 */
export function cryoRangeCount(start: string | null, end: string | null): number | null {
  if (start === null || end === null) return null;
  const first = /^([A-Za-z]*)(\d+)$/.exec(start.trim());
  const last = /^([A-Za-z]*)(\d+)$/.exec(end.trim());
  if (first === null || last === null) return null;
  if (String(first[1]).toUpperCase() !== String(last[1]).toUpperCase()) return null;
  const count = Number(last[2]) - Number(first[2]) + 1;
  return count >= 1 ? count : null;
}
