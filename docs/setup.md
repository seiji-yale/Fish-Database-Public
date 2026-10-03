# Setup and operations

The application uses a Cloudflare Worker, D1, and R2. `wrangler.toml` contains placeholders and
is suitable for local development. Create your own resources before deploying. Put real Worker
names, D1 IDs, and bucket names in a local `wrangler.jsonc`, which is ignored by Git and takes
precedence over `wrangler.toml`. Keep that file in your private operations backup.

Stay on the free plan if a zero-cost deployment is required. Check the current Cloudflare limits
before enabling additional services. This application does not require KV, Durable Objects,
Queues, or a custom domain.

## First hosted deployment

1. Create separate preview and production D1 databases and R2 buckets in your own account.
2. Create your private `wrangler.jsonc` with those resource IDs and unique Worker names, based on
   the structure of `wrangler.toml`. Set `MIRROR_FOLDER` to separate preview and production exports.
   Set `APP_NAME` for the Worker-generated offline copy and `VITE_APP_NAME` when building the SPA
   to give the installation its own title.
3. Set `SESSION_SIGNING_KEY` as a Worker secret in each environment. Set Dropbox secrets only if
   you enable the mirror. Never put secret values in either Wrangler configuration file.
4. Deploy preview, then run the migrations there. Check the app and its data before deploying
   production. Production migration and deployment are owner actions.
5. Run `npm run user:set-admin -- --name <your-name> --env production --yes` from an authenticated
   maintainer terminal. It prompts for a password without showing it on the command line. Sign in
   and invite other people through Settings → Users.

For local work, `npm run db:reset:local` clears only the local D1. `npm run db:seed:local` adds
synthetic users and lines. Never run these local seed commands against hosted environments.

## Backup and recovery

Use the app's Settings → Data & Backup → Export now to write an on-demand Dropbox copy if the
mirror is configured. Keep a separate D1 SQL export before every production migration. To restore,
turn read-only mode on, save the current state, restore into preview first, verify line counts and
attachments, and then follow the same steps in production. The scripts in `tools/import/` and
`tools/mirror/` support this process; inspect their `--help` output and rehearse before use.
Image restoration requires `--bucket` with the exact R2 bucket name from your private deployment
configuration; the script never guesses a hosted bucket from a template name.

The Dropbox export omits password hashes. After rebuilding a database, use `user:set-admin` and
issue new invites. Maintain at least two trusted Cloudflare account members so a future maintainer
can regain operational access. Record private account and mirror details outside this repository.
