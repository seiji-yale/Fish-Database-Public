/**
 * A line can have several current ID methods (owner decision 2026-09-30, T-014). Each protocol
 * carries `is_current`; the line's `current_protocol_id` is the "primary" one — the method the Line
 * List filters and sorts by — and is always one of the current methods. Lines that were written
 * before the flag existed have only the pointer, so the pointer counts as current too.
 */
export interface CurrentCandidate {
  id: string;
  sort_order: number;
  is_current: number;
}

/** The current methods: primary first, then the others in their list order. */
export function currentProtocols<T extends CurrentCandidate>(
  primaryId: string | null,
  protocols: readonly T[],
): T[] {
  return protocols
    .filter((protocol) => protocol.is_current === 1 || protocol.id === primaryId)
    .sort(
      (a, b) =>
        Number(b.id === primaryId) - Number(a.id === primaryId) || a.sort_order - b.sort_order,
    );
}

/** The primary pointer after a change: kept while it is still current, else the first current one. */
export function primaryAfter(
  primaryId: string | null,
  current: readonly { id: string }[],
): string | null {
  if (primaryId !== null && current.some((protocol) => protocol.id === primaryId)) return primaryId;
  return current[0]?.id ?? null;
}
