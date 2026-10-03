-- 0004_seed_settings.sql
-- Seed settings (docs/03-data-model.md 2.2).
-- admin_password_hash: the built-in Admin login is `admin` / `admin` until changed (requirements, roles table).
--   Format: pbkdf2-sha256$<iterations>$<salt base64>$<derived key base64>. PBKDF2-HMAC-SHA256 through
--   WebCrypto, 100000 iterations (the Workers maximum), 16-byte salt, 32-byte key. The seed uses a fixed
--   salt because the default password is public by design; every password set through the app gets a
--   fresh random salt (T-006).
-- lab_passphrase_hash: NULL = the optional lab passphrase gate is off (ADR-0002).
-- The mirror_* keys and import_report_md are written by later tickets (T-020, T-004) and are not seeded.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('upcoming_breeding_months', '11'),
  ('default_annealing_c', '60'),
  ('default_cycles', '35'),
  ('admin_password_hash', 'pbkdf2-sha256$100000$q0VPgQ1/kEzt33Q6uxzj/Q==$4pF+ho9aUwIuNieLjq3zNef4iNDCKykiu0USkK8nTsw='),
  ('lab_passphrase_hash', NULL);
