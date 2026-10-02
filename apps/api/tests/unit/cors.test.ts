import { describe, expect, it } from 'vitest';
import { app } from '../../src/app';

/**
 * The CORS "lock" (08-08, D-346, RESEARCH finding 4, T-08-45), proven rather than configured.
 *
 * The browser never calls this API: `API_URL` is server-only and the Next app is a BFF that calls it
 * from the server. So the API mounts NO CORS middleware, and a cross-origin page that tries to read
 * a response gets nothing a browser would hand over. This test fails the moment any
 * `Access-Control-Allow-*` header appears on a preflight or a simple request, on the public health
 * route and on a tenant route, so a future `cors()` cannot slip in unnoticed. DEPLOY.md
 * "Content Security Policy (Phase 8)" records the rule for a future browser-facing route: allow
 * only the production origins.
 */
const EVIL = 'https://evil.example';

function allowHeaders(res: Response): string[] {
  return [...res.headers.keys()].filter((name) => name.toLowerCase().startsWith('access-control-'));
}

describe.each(['/v1/health', '/v1/members'])('no CORS on %s', (path) => {
  it('a preflight OPTIONS from a foreign origin gets no Access-Control-Allow-* header', async () => {
    const res = await app.request(path, {
      method: 'OPTIONS',
      headers: {
        Origin: EVIL,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'authorization',
      },
    });
    expect(allowHeaders(res)).toEqual([]);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('a simple GET from a foreign origin gets no Access-Control-Allow-* header', async () => {
    const res = await app.request(path, { headers: { Origin: EVIL } });
    expect(allowHeaders(res)).toEqual([]);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('the tenant route still refuses without a token', () => {
  it('GET /v1/members from a foreign origin with no token is 401, never a readable body', async () => {
    const res = await app.request('/v1/members', { headers: { Origin: EVIL } });
    expect(res.status).toBe(401);
  });
});
