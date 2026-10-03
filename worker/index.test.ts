import { describe, expect, it } from 'vitest';
import app from './index';

describe('GET /api/health', () => {
  it('reports ok and the package version', async () => {
    const response = await app.request('/api/health');
    expect(response.status).toBe(200);
    const body = await response.json<{ ok: boolean; version: string }>();
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
