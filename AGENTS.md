# Agent instructions

- Use English for code, comments, UI text, documentation, tests, and commits.
- Never commit credentials, real lab data, personal details, account identifiers, or deployment
  configuration. Run `npm run check:public` before every PR.
- Develop with local or preview resources. Do not write to production databases or storage from a
  development session.
- Keep migrations additive when possible. Use soft deletion in application code so history remains
  available.
- Put user-visible text in the messages modules. Keep business rules in named modules with tests.
- Run `npm run check` and the relevant browser tests before proposing a release.
- Keep this repository reusable: demo people and lines belong only in `tests/fixtures/` and local
  seed scripts, while real people are added through app invites.
