/**
 * Signing in for the e2e specs (ADR-0005). The local database is seeded with a known password
 * (`tools/db/seed-local.ts`): members and the Admin "Lab Admin" sign in with it; "Guest" enters
 * through the Guest link, whose token any signed-in member can read.
 */
import type { APIRequestContext, Page } from '@playwright/test';

export const E2E_PASSWORD = 'local-password';
export const E2E_ADMIN = 'Lab Admin';
/** Where `globalSetup` saves the signed-in browser state every spec starts from (a member). */
export const STORAGE_STATE = 'tests/e2e/.auth/member.json';
export const DEFAULT_MEMBER = 'Bob';

/** Signs `request`'s cookie jar in as `name` ("Admin" means the e2e Admin person). */
export async function signInRequest(request: APIRequestContext, name: string): Promise<void> {
  if (name === 'Guest') {
    const member = await request.post('/api/session/login', {
      data: { name: DEFAULT_MEMBER, password: E2E_PASSWORD },
    });
    if (!member.ok())
      throw new Error(`sign-in as ${DEFAULT_MEMBER} failed: ${String(member.status())}`);
    const { token } = (await (await request.get('/api/guest-link')).json()) as { token: string };
    const guest = await request.post(`/api/guest/${token}`);
    if (!guest.ok()) throw new Error(`guest link failed: ${String(guest.status())}`);
    return;
  }
  const person = name === 'Admin' ? E2E_ADMIN : name;
  const response = await request.post('/api/session/login', {
    data: { name: person, password: E2E_PASSWORD },
  });
  if (!response.ok()) throw new Error(`sign-in as ${person} failed: ${String(response.status())}`);
}

/** Replaces the browser's session with `name`'s. Call before `page.goto`, or reload afterwards. */
export async function actAs(page: Page, name: string): Promise<void> {
  await signInRequest(page.request, name);
}
