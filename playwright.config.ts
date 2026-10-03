import { defineConfig } from '@playwright/test';

const viewports = [
  { name: 'phone-375', width: 375, height: 812 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1280', width: 1280, height: 800 },
];

// The smoke tests run against the built app served by `wrangler dev` (Worker + assets), like production.
export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './tests/e2e/globalSetup.ts',
  // Every spec starts signed in as a member (ADR-0005); a spec that needs another person calls `actAs`.
  use: { baseURL: 'http://localhost:8788', storageState: 'tests/e2e/.auth/member.json' },
  // Specs that create lines (T-011 onward, `*.write.spec.ts`) run after every read-only spec has
  // finished, in their own `<viewport>-writes` projects: read-only specs count rows and compare
  // list/CSV totals, which a line created at the same moment would change.
  projects: [
    ...viewports.map(({ name, width, height }) => ({
      name,
      testIgnore: /\.(write|rotate)\.spec\.ts$/,
      use: { browserName: 'chromium' as const, viewport: { width, height } },
    })),
    ...viewports.map(({ name, width, height }) => ({
      name: `${name}-writes`,
      testMatch: /\.write\.spec\.ts$/,
      dependencies: viewports.map((viewport) => viewport.name),
      use: { browserName: 'chromium' as const, viewport: { width, height } },
    })),
    // Replacing the Guest link ends every Guest session, so that spec runs alone, last.
    {
      name: 'guest-link-rotation',
      testMatch: /\.rotate\.spec\.ts$/,
      dependencies: viewports.map(({ name }) => `${name}-writes`),
      use: { browserName: 'chromium' as const, viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // Reset, migrate and reseed the local D1 first so every run starts from the same known state
    // (`tests/fixtures/lines.small.json`, T-008) and the shell talks to the real API, not the
    // offline fallback. This is the same local D1 `npm run dev` uses; running the e2e suite
    // replaces whatever was in it, by design (`tools/db/seed-local.ts`'s own precondition).
    // SESSION_SIGNING_KEY is a Cloudflare secret in preview/production and `.dev.vars` locally;
    // the smoke run passes a throwaway test-only value so it never depends on either.
    command:
      'npm run build && npm run db:reset:local && npm run db:seed:local && wrangler dev --port 8788 --var SESSION_SIGNING_KEY:e2e-only-not-a-secret',
    url: 'http://localhost:8788/api/health',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
  },
});
