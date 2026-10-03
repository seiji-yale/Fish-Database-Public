/**
 * The SQL behind `npm run user:set-admin` (ADR-0005; runbook docs/06-operations.md §2.3): makes the
 * named person an active Admin with the given password hash, creating them if needed. Used for the
 * first Admin of a new database and when the last Admin forgot the password. Sessions of that user
 * end (epoch + 1). The values are SQL-quoted here because wrangler runs the text as is.
 */
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

export function setAdminSql(name: string, passwordHash: string, id: string, now: string): string {
  const n = quote(name.trim());
  const h = quote(passwordHash);
  const t = quote(now);
  return [
    `UPDATE users SET role = 'admin', is_active = 1, password_hash = ${h}, must_change_password = 0,` +
      ` failed_logins = 0, locked_until = NULL, session_epoch = session_epoch + 1, updated_at = ${t}` +
      ` WHERE name = ${n} COLLATE NOCASE AND is_builtin = 0;`,
    `INSERT INTO users (id, name, role, is_active, is_builtin, created_at, updated_at, password_hash)` +
      ` SELECT ${quote(id)}, ${n}, 'admin', 1, 0, ${t}, ${t}, ${h}` +
      ` WHERE NOT EXISTS (SELECT 1 FROM users WHERE name = ${n} COLLATE NOCASE);`,
  ].join('\n');
}
