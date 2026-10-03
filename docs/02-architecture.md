# Architecture

The client is a TypeScript SPA. A Hono API runs in a Cloudflare Worker, stores relational data in D1,
and stores attachments in R2. A scheduled Worker can export a Dropbox mirror when its credentials are
configured. The app also creates an offline HTML snapshot for the mirror.

The `domain/` modules contain pure business rules; `worker/` contains persistence and API routes;
`app/` contains the client; `tools/` contains local import, maintenance, and validation commands.
Keep deployment identifiers and secrets out of Git. See [setup](setup.md).
