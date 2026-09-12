import { describe, expect, it } from 'vitest';
import { app } from '../../src/app';

describe('GET /v1/health', () => {
  it('answers 200 in-process without touching the database', async () => {
    const res = await app.request('/v1/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; service: string; role: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('api');
    expect(body.role).toBe('api');
  });
});
