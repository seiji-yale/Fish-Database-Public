/**
 * `npm run db:migrate:preview` / `db:migrate:production` (T-021, docs/06-operations.md section 4): saves a
 * full SQL dump of the remote database, THEN applies the pending migrations. A migration is the one routine
 * step that can damage data in place, so there is always a restore point from just before it.
 *
 *   npm run db:migrate:preview
 *   npm run db:migrate:production        (the owner only; an agent session never runs this)
 *
 * The dump goes to `backups/pre-migration/<env>-<UTC time>.sql` (git-ignored; keep it until the release
 * is confirmed good). If the dump fails the migration does not run. `SKIP_PRE_MIGRATION_EXPORT=1` skips it
 * on purpose (an empty database, or a repeat run).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export type MigrateEnv = 'preview' | 'production' | 'rehearsal';

/** The two commands, in order: the dump, then the migration. Pure, so it is tested. */
export function migrationPlan(
  env: MigrateEnv,
  now: Date,
  skipExport = false,
): { dumpPath: string; commands: string[][] } {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const dumpPath = `backups/pre-migration/${env}-${stamp}.sql`;
  const dump = ['wrangler', 'd1', 'export', 'DB', '--remote', '--env', env, '--output', dumpPath];
  const migrate = ['wrangler', 'd1', 'migrations', 'apply', 'DB', '--remote', '--env', env];
  return { dumpPath, commands: skipExport ? [migrate] : [dump, migrate] };
}

function main(): void {
  const env = process.argv[2];
  if (env !== 'preview' && env !== 'production' && env !== 'rehearsal') {
    console.error('Usage: tsx tools/deploy/migrate.ts <preview|production|rehearsal>');
    process.exit(2);
  }
  const plan = migrationPlan(env, new Date(), process.env['SKIP_PRE_MIGRATION_EXPORT'] === '1');
  mkdirSync('backups/pre-migration', { recursive: true });
  for (const command of plan.commands) {
    const result = spawnSync('npx', command, { stdio: 'inherit' });
    if (result.status !== 0) {
      console.error(
        `migrate: "${command.slice(0, 3).join(' ')}" failed; stopping before any change.`,
      );
      process.exit(result.status ?? 1);
    }
    if (command[2] === 'export') console.log(`migrate: restore point saved to ${plan.dumpPath}`);
  }
}

if (process.argv[1]?.endsWith('migrate.ts')) main();
