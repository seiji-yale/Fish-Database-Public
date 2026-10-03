import { describe, expect, it } from 'vitest';
import { migrationPlan } from './migrate';

describe('migrationPlan', () => {
  const now = new Date('2026-10-05T15:30:00.123Z');

  it('dumps the remote database first, then migrates the same environment', () => {
    const { dumpPath, commands } = migrationPlan('production', now);
    expect(dumpPath).toBe('backups/pre-migration/production-2026-10-05T15-30-00-123Z.sql');
    expect(commands).toHaveLength(2);
    expect(commands[0]).toEqual([
      'wrangler',
      'd1',
      'export',
      'DB',
      '--remote',
      '--env',
      'production',
      '--output',
      dumpPath,
    ]);
    expect(commands[1]).toEqual([
      'wrangler',
      'd1',
      'migrations',
      'apply',
      'DB',
      '--remote',
      '--env',
      'production',
    ]);
  });

  it('also serves the rehearsal environment', () => {
    const { commands } = migrationPlan('rehearsal', now, true);
    expect(commands).toEqual([
      ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--env', 'rehearsal'],
    ]);
  });

  it('can skip the dump on purpose, and never targets another environment', () => {
    const { commands } = migrationPlan('preview', now, true);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('preview');
    expect(commands.flat()).not.toContain('production');
  });
});
