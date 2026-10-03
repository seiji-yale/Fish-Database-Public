// The tools project type-checks with Node's types only (Cloudflare's conflict with them). Worker code that
// `tools/db/export-fixture.ts` imports mentions this one Cloudflare type in an optional binding; the fixture
// export never touches it.
declare type R2Bucket = object;
