import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

/**
 * 07-03 — `GET /api/realtime/token` (RESEARCH Pattern 5; T-07-12, T-07-13): the one route that hands
 * a raw access token to page JavaScript. The claims worth a test are its gates, each answered with an
 * empty `no-store` body and without touching the session:
 *
 *  - T1: `Sec-Fetch-Site` other than `same-origin` (absent, `cross-site`, `same-site`, `none`) is 403;
 *  - T2: no verified claims is 401 (and `getSession` is never read);
 *  - T3: otherwise 200 `{ accessToken, expiresAt }`, `cache-control: no-store`, and nothing logged.
 *
 * What is stubbed: `lib/env` and the Supabase server client. What is real: the route.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

const getClaims = vi.fn();
const getSession = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims, getSession } })),
}));

const TOKEN = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1In0.sig';
const EXPIRES_AT = 1_900_000_000;

function request(site: string | null): Request {
  const headers: Record<string, string> = { host: 'rede-demo.localhost:3000' };
  if (site !== null) headers['sec-fetch-site'] = site;
  return new Request('http://rede-demo.localhost:3000/api/realtime/token', { headers });
}

beforeEach(() => {
  vi.mocked(createClient).mockClear();
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: 'u' } }, error: null });
  getSession.mockReset().mockResolvedValue({
    data: { session: { access_token: TOKEN, expires_at: EXPIRES_AT } },
    error: null,
  });
});

describe('GET /api/realtime/token', () => {
  it.each([[null], ['cross-site'], ['same-site'], ['none']])(
    'T1: Sec-Fetch-Site %s is 403 with an empty no-store body and no session read',
    async (site) => {
      const res = await GET(request(site));
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('');
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it('T2: without verified claims it is 401, empty, and the session is never read', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('no session') });
    const res = await GET(request('same-origin'));
    expect(res.status).toBe(401);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toBe('');
    expect(getSession).not.toHaveBeenCalled();
  });

  it('T2: claims but no session token is 401 too', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    const res = await GET(request('same-origin'));
    expect(res.status).toBe(401);
  });

  it('T3: same-origin with a session answers { accessToken, expiresAt } with no-store, logging nothing', async () => {
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'info').mockImplementation(() => {}),
      vi.spyOn(console, 'error').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}),
    ];
    try {
      const res = await GET(request('same-origin'));
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ accessToken: TOKEN, expiresAt: EXPIRES_AT });
      expect(getClaims).toHaveBeenCalledTimes(1);
      for (const spy of logs) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of logs) spy.mockRestore();
    }
  });
});
