import type { Db } from './db/db';

/** Compile-time proof that the real D1 binding can be handed to the query layer unchanged. */
export function asDb(binding: D1Database): Db {
  return binding;
}
