import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { POST } from './route';

/**
 * 08.5-08 — `POST /api/courses/progress`, the page-hide twin of `saveProgressAction` (D-427,
 * UI-D-433; threat T-08.5-08). A clone of the `/api/stories/views` cases (T-05.2-57).
 *
 * `LessonPlayer` sends the member's last position here with `navigator.sendBeacon` when the page
 * hides, because a server action is a plain fetch the browser may abort on unload. A route handler
 * gets NONE of the Origin check Next gives Server Actions, so the claims worth a test are the
 * handler's own gates, each answering with ZERO API calls:
 *
 *  - R1/R2: same origin only — a missing, `null` or foreign Origin is 403, and the browser-facing
 *    host is `x-forwarded-host` first, `host` second (the proxy.ts precedence);
 *  - R3: a verified session (`getClaims`) or 401;
 *  - R4: a declared body over 4 KiB is 413; malformed JSON, a non-object, a non-uuid `lessonId` or a
 *    `positionSeconds` that is not an integer 0–14400 is 400;
 *  - R5: a valid body forwards ONLY `{ positionSeconds }` ONCE to the PUT → 204 (a `completed` key
 *    in the beacon never reaches the API);
 *  - R6: the lock answers keep 403 / 409, a removed lesson is 404, a transport failure is 502, and
 *    the log never holds an id or a position.
 *
 * What is stubbed: `lib/api`'s `apiFetch` (the transport), `lib/env` and the Supabase server client.
 * What is real: the route and `lib/courses-learn`'s `putLessonProgress`.
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
const L = '0d000000-0000-4000-8000-0000000000d1';

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
  return new Request('http://rede-demo.localhost:3000/api/courses/progress', {
    method: 'POST',
    headers: all,
    body,
  });
}

const valid = JSON.stringify({ lessonId: L, positionSeconds: 42 });

function apiAnswer(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue(
    apiAnswer(200, { completedAt: null, lastPositionSeconds: 42 }),
  );
  vi.mocked(createClient).mockClear();
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/courses/progress — the page-hide progress write (D-427, T-08.5-08)', () => {
  it('R1. a foreign, a missing and a `null` Origin are 403 — no session read, no API call', async () => {
    for (const origin of ['http://evil.example', null, 'null', 'not a url']) {
      const res = await POST(beacon(valid, { origin }));
      expect(res.status, String(origin)).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).toBe('');
    }
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

    for (const body of [
      '{not json',
      JSON.stringify([L]),
      JSON.stringify('texto'),
      JSON.stringify(null),
      JSON.stringify({}),
      JSON.stringify({ lessonId: 'nao-e-um-uuid', positionSeconds: 1 }),
      JSON.stringify({ lessonId: L }),
      JSON.stringify({ lessonId: L, positionSeconds: -1 }),
      JSON.stringify({ lessonId: L, positionSeconds: 1.5 }),
      JSON.stringify({ lessonId: L, positionSeconds: '42' }),
      JSON.stringify({ lessonId: L, positionSeconds: 14401 }),
    ]) {
      const res = await POST(beacon(body));
      expect(res.status, body.slice(0, 60)).toBe(400);
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('R5. a valid body forwards ONLY { positionSeconds } ONCE to the PUT → 204', async () => {
    const res = await POST(
      beacon(JSON.stringify({ lessonId: L, positionSeconds: 42, completed: true, userId: 'x' })),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe(`/v1/courses/learn/lessons/${L}/progress`);
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toEqual({ positionSeconds: 42 });
  });

  it("R5b. the admin's 204 (D-422) is a 204 too", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(apiAnswer(204));
    expect((await POST(beacon(valid))).status).toBe(204);
  });

  it('R6. locks keep 403 / 409, a removed lesson is 404, transport is 502; the log has no id', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(apiFetch).mockResolvedValueOnce(
      apiAnswer(403, { error: { code: 'FORBIDDEN', details: { courses: 'lesson_locked' } } }),
    );
    expect((await POST(beacon(valid))).status).toBe(403);

    vi.mocked(apiFetch).mockResolvedValueOnce(
      apiAnswer(409, {
        error: { code: 'CONFLICT', details: { courses: 'lesson_sequence_locked' } },
      }),
    );
    expect((await POST(beacon(valid))).status).toBe(409);

    vi.mocked(apiFetch).mockResolvedValueOnce(apiAnswer(404, { error: { code: 'NOT_FOUND' } }));
    expect((await POST(beacon(valid))).status).toBe(404);

    vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await POST(beacon(valid))).status).toBe(502);

    expect(log).toHaveBeenCalledWith('courses.progress_beacon_failed', expect.anything());
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(L);
    expect(logged).not.toContain('"42"');
  });
});
