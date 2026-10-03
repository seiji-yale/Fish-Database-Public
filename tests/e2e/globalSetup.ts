import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { request } from '@playwright/test';
import { DEFAULT_MEMBER, signInRequest, STORAGE_STATE } from './auth';

/** Signs in once as a member and saves the browser state: specs start signed in (ADR-0005). */
export default async function globalSetup(): Promise<void> {
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  const context = await request.newContext({ baseURL: 'http://localhost:8788' });
  await signInRequest(context, DEFAULT_MEMBER);
  await context.storageState({ path: STORAGE_STATE });
  await context.dispose();
}
