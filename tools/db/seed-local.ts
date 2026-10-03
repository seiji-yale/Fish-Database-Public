/**
 * `npm run db:seed:local`: loads tests/fixtures/lines.small.json into the LOCAL D1 database
 * (the same `.wrangler/state` that `npm run db:migrate:local` and `wrangler dev` use).
 * Local only: it goes through wrangler's local platform proxy and cannot reach Cloudflare.
 * Run `npm run db:reset:local` first for a clean database.
 */
import { readFileSync } from 'node:fs';
import { getPlatformProxy } from 'wrangler';
import type { Db } from '../../worker/db/db';
import { loadFixture } from '../../worker/db/fixtures';
import { hashPassword } from '../../worker/lib/passwords';

/** Every seeded person signs in with this password in the local database and in the e2e suite. */
export const LOCAL_PASSWORD = 'local-password';
const LOCAL_ADMIN = 'Lab Admin';

const fixturePath = new URL('../../tests/fixtures/lines.small.json', import.meta.url);
const usersPath = new URL('../../tests/fixtures/users.sql', import.meta.url);

async function main(): Promise<void> {
  const { env, dispose } = await getPlatformProxy<{ DB: Db }>();
  try {
    const existing = await env.DB.prepare('SELECT count(*) AS n FROM lines').first<{ n: number }>();
    if (existing === null || existing.n > 0) {
      throw new Error('The local database already has lines. Run `npm run db:reset:local` first.');
    }
    // Migrations contain only built-in users in the public box; demo accounts are local-only.
    await env.DB.prepare(readFileSync(usersPath, 'utf8')).run();
    const count = await loadFixture(env.DB, JSON.parse(readFileSync(fixturePath, 'utf8')));
    console.log(`Loaded ${String(count)} lines into the local database.`);
    // Accounts (ADR-0005): the seeded members can sign in locally, and one Admin exists. Local only.
    const hash = await hashPassword(LOCAL_PASSWORD);
    const now = new Date().toISOString();
    await env.DB.prepare(
      "UPDATE users SET password_hash = ? WHERE is_builtin = 0 AND role = 'member' AND is_active = 1",
    )
      .bind(hash)
      .run();
    await env.DB.prepare(
      "INSERT INTO users (id, name, role, is_active, is_builtin, created_at, updated_at, password_hash) VALUES (?, ?, 'admin', 1, 0, ?, ?, ?)",
    )
      .bind('01M3JMZC0ALOCALADMIN00000', LOCAL_ADMIN, now, now, hash)
      .run();
    console.log(`Members and "${LOCAL_ADMIN}" can sign in with the password "${LOCAL_PASSWORD}".`);
  } finally {
    await dispose();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
