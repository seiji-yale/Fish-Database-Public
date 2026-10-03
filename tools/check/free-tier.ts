import { parse } from 'smol-toml';

/** Paid-only or budget-risk Cloudflare features (NFR-08, docs/06-operations.md section 7). */
export const FORBIDDEN_KEYS = [
  'kv_namespaces',
  'durable_objects',
  'queues',
  'routes',
  'route',
] as const;

type Table = Record<string, unknown>;

function isTable(value: unknown): value is Table {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scan(table: Table, path: string, problems: string[]): void {
  for (const key of FORBIDDEN_KEYS) {
    if (key in table) problems.push(`${path}${key}`);
  }
  for (const [name, value] of Object.entries(table)) {
    if (name === 'env' && isTable(value)) {
      for (const [envName, envValue] of Object.entries(value)) {
        if (isTable(envValue)) scan(envValue, `env.${envName}.`, problems);
      }
    }
  }
}

/** Returns the forbidden declarations found in a wrangler.toml document (empty = compliant). */
export function findFreeTierProblems(toml: string): string[] {
  const problems: string[] = [];
  scan(parse(toml), '', problems);
  return problems;
}
