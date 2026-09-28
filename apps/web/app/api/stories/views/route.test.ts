import { STORY_SEEN_BATCH_MAX } from '@rede-social/module-stories/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { POST } from './route';

/**
 * quick 260926-d8f — `POST /api/stories/views`, the page-hide twin of `markStoriesSeenAction`
 * (review WR-07; T-05.2-57).
 *
 * `StoriesSurface` sends its last seen batch here with `navigator.sendBeacon` (or `fetch` with
 * `keepalive`) when the page hides, because a server action is a plain fetch the browser may abort
 * on unload. A route handler gets NONE of the Origin check Next gives Server Actions, so the claims
 * worth a test are the handler's own gates, each answering with ZERO API calls:
 *
 *  - R1/R2: same origin only — a missing, `null` or foreign Origin is 403, and the browser-facing
 *    host is `x-forwarded-host` first, `host` second (the proxy.ts precedence);
 *  - R3: a verified session (`getClaims`) or 401;
 *  - R4: a declared body over 4 KiB is 413; malformed JSON, a non-object, a non-uuid or more than
 *    the contract cap of unique ids is 400 (the same `parseSeenBatch` the action uses);
 *  - R5: a valid batch is deduplicated and forwarded ONCE through `markStoriesSeen` → 204;
 *  - R6: an API refusal keeps its 4xx, a transport failure is 502, and the log never holds an id.
 *
 * What is stubbed: `lib/api`'s `apiFetch` (the transport), `lib/env` and the Supabase server client.
 * What is real: the route, `parseSeenBatch` and `lib/stories`' `markStoriesSeen`.
 */

vi.mock('@/lib/env', () => ({
  env: {
    API_URL: 'http://api.test',
    PLATFORM_HOST: 'rede-social.test',
    NEXT_PUBLIC_SUPABASE_URL: 'http://supabase.test',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key',
  },
}));

vi.mock('@/lib/api', () => ({ apiFetch: vi.fn() }));

const getClaims = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({ auth: { getClaims } })),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
}));

const ORIGIN = 'http://rede-demo.localhost:3000';
const A = '0d000000-0000-4000-8000-0000000000d1';
const B = '0d000000-0000-4000-8000-0000000000d2';

function uuid(n: number): string {
  return `0d000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

function beacon(body: string, headers: Record<string, string | null> = {}): Request {
  const all: Record<string, string> = {
    host: 'rede-demo.localhost:3000',
    origin: ORIGIN,
    'content-type': 'text/plain;charset=UTF-8',
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete all[key];
    else all[key] = value;
  }
  return new Request('http://rede-demo.localhost:3000/api/stories/views', {
    method: 'POST',
    headers: all,
    body,
  });
}

const valid = JSON.stringify({ storyIds: [A] });

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }));
  vi.mocked(createClient).mockClear();
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/stories/views — the page-hide seen write (WR-07)', () => {
  it('R1. a foreign, a missing and a `null` Origin are 403 — no session read, no API call', async () => {
    for (const origin of ['http://evil.example', null, 'null', 'not a url']) {
      const res = await POST(beacon(valid, { origin }));
      expect(res.status, String(origin)).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('');
    }
    // Same host, another port or scheme-less trickery is still another origin.
    expect((await POST(beacon(valid, { origin: 'http://rede-demo.localhost:4000' }))).status).toBe(
      403,
    );
    expect(getClaims).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('R2. x-forwarded-host wins over host (the proxy.ts precedence)', async () => {
    const forwarded = { host: 'localhost:3000', 'x-forwarded-host': 'rede-demo.localhost:3000' };

    const ok = await POST(beacon(valid, { ...forwarded, origin: ORIGIN }));
    expect(ok.status).toBe(204);
    expect(apiFetch).toHaveBeenCalledTimes(1);

    vi.mocked(apiFetch).mockClear();
    const refused = await POST(beacon(valid, { ...forwarded, origin: 'http://localhost:3000' }));
    expect(refused.status).toBe(403);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('R3. same origin without a verified session is 401 — no API call', async () => {
    getClaims.mockResolvedValueOnce({ data: null, error: new Error('no session') });
    const res = await POST(beacon(valid));
    expect(res.status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('R4. oversized and malformed bodies are 413 / 400 — none reaches the API', async () => {
    expect((await POST(beacon(valid, { 'content-length': '5000' }))).status).toBe(413);
    expect((await POST(beacon('x'.repeat(5000)))).status).toBe(413);

    const over = Array.from({ length: STORY_SEEN_BATCH_MAX + 1 }, (_, n) => uuid(n + 1));
    for (const body of [
      '{not json',
      JSON.stringify([A]),
      JSON.stringify('texto'),
      JSON.stringify(null),
      JSON.stringify({ storyIds: [] }),
      JSON.stringify({ storyIds: [A, 'nao-e-um-uuid'] }),
      JSON.stringify({ storyIds: over }),
    ]) {
      const res = await POST(beacon(body));
      expect(res.status, body.slice(0, 40)).toBe(400);
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('R5. a valid batch is deduplicated and forwarded ONCE through markStoriesSeen → 204', async () => {
    const res = await POST(beacon(JSON.stringify({ storyIds: [A, B, A], extra: 'ignored' })));
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/stories/views');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({ storyIds: [A, B] });
  });

  it('R6. an API 401 stays 401, a transport failure is 502, and the log never holds an id', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'UNAUTHENTICATED' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect((await POST(beacon(valid))).status).toBe(401);

    vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await POST(beacon(valid))).status).toBe(502);

    expect(log).toHaveBeenCalledWith('stories.seen_beacon_failed', expect.anything());
    expect(JSON.stringify(log.mock.calls)).not.toContain(A);
  });
});
