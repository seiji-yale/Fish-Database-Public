import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const QUERIES_DIR = new URL('./queries/', import.meta.url);

/**
 * Guards the "parameterised SQL only" rule for the query layer: inside a `prepare(...)` template
 * literal the only allowed `${...}` interpolations are the compile-time identifiers and fragments
 * named below. Anything else (for example a value from a request) fails this test.
 */
const ALLOWED_INTERPOLATIONS = new Set([
  'spec.table',
  'columns',
  'placeholders',
  'column',
  'liveFilter(spec, options)',
  'orderBy',
  'filter',
]);

function interpolationsIn(source: string): string[] {
  const found: string[] = [];
  for (const call of source.matchAll(/prepare\(\s*`([^`]*)`/g)) {
    for (const part of (call[1] ?? '').matchAll(/\$\{([^}]*)\}/g)) found.push(part[1] ?? '');
  }
  return found;
}

describe('query layer SQL', () => {
  const files = readdirSync(QUERIES_DIR).filter((file) => file.endsWith('.ts'));

  it('finds the query modules', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(files)('%s interpolates only whitelisted identifiers', (file) => {
    const source = readFileSync(new URL(file, QUERIES_DIR), 'utf8');
    for (const expression of interpolationsIn(source)) {
      expect(ALLOWED_INTERPOLATIONS.has(expression.trim())).toBe(true);
    }
  });

  it.each(files)('%s has no hard delete of domain rows', (file) => {
    const source = readFileSync(new URL(file, QUERIES_DIR), 'utf8');
    expect(source).not.toMatch(/DELETE\s+FROM/i);
  });

  it('detects an unsafe interpolation (the check itself works)', () => {
    expect(interpolationsIn('db.prepare(`SELECT * FROM lines WHERE name = ${name}`)')).toEqual([
      'name',
    ]);
  });
});
