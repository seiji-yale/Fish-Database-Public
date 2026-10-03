/**
 * Make a person an Admin with a new password (ADR-0005; runbook docs/06-operations.md §2.3):
 * the first Admin of a new database, or the last Admin who forgot the password. It needs the
 * Cloudflare login (wrangler), so only the owner of the Cloudflare account can run it.
 *
 *   npm run user:set-admin -- --name <Name> --env local|preview|production [--yes]
 *
 * The password is typed at a hidden prompt (never on the command line, so it stays out of the shell
 * history). `production` changes the real database, so it only runs with `--yes`.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newPasswordProblem } from '../../domain/accounts';
import { newId } from '../../worker/db/ids';
import { hashPassword } from '../../worker/lib/passwords';
import { setAdminSql } from '../../worker/lib/setAdmin';

const args = process.argv.slice(2);
const option = (flag: string) => {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
};
const name = option('--name');
const env = option('--env');
const usage =
  'Usage: npm run user:set-admin -- --name <Name> --env <local|preview|production> [--yes]';

function hiddenPrompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const input = process.stdin;
    input.setRawMode(true);
    input.resume();
    let text = '';
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\r' || char === '\n') {
          input.setRawMode(false);
          input.pause();
          input.off('data', onData);
          process.stdout.write('\n');
          resolve(text);
          return;
        }
        if (char === '\u0003') process.exit(130);
        if (char === '\u007f') text = text.slice(0, -1);
        else text += char;
      }
    };
    input.on('data', onData);
  });
}

async function main(): Promise<number> {
  if (
    name === undefined ||
    name.trim() === '' ||
    (env !== 'local' && env !== 'preview' && env !== 'production')
  ) {
    console.error(usage);
    return 2;
  }
  if (env === 'production' && !args.includes('--yes')) {
    console.error(
      `This changes the PRODUCTION database (Admin: ${name}). Run it again with --yes to confirm.`,
    );
    return 2;
  }
  if (!process.stdin.isTTY) {
    console.error('Run this in a terminal: the password is typed at a hidden prompt.');
    return 2;
  }
  const password = await hiddenPrompt(`New password for ${name}: `);
  if (newPasswordProblem(password) !== null) {
    console.error('Use at least 8 characters.');
    return 2;
  }
  if ((await hiddenPrompt('Type it again: ')) !== password) {
    console.error('The two passwords are different. Nothing was changed.');
    return 2;
  }
  const sql = setAdminSql(name, await hashPassword(password), newId(), new Date().toISOString());
  const dir = mkdtempSync(join(tmpdir(), 'fish-set-admin-'));
  const file = join(dir, 'set-admin.sql');
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    const target = env === 'local' ? ['--local'] : ['--remote', '--env', env];
    const result = spawnSync(
      'npx',
      ['wrangler', 'd1', 'execute', 'DB', ...target, '--file', file],
      { stdio: 'inherit' },
    );
    if (result.status === 0)
      console.log(`${name.trim()} is an Admin. Sign in with that name and the new password.`);
    return result.status ?? 1;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
