import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api';
import { createClient } from '@/lib/supabase/server';
import { DELETE, POST } from './route';

/**
 * 07-07: `POST` / `DELETE /api/push/subscriptions`, the BFF door for this device's Web Push
 * subscription (T-07-44). The claims worth a test are the handler's own gates, each answering with
 * ZERO API calls, and the single forward:
 *
 *  - S1: same origin only (a missing, `null`, foreign or other-port Origin is 403);
 *  - S2: a verified session or 401;
 *  - S3: a declared or real body over 4 KiB is 413; malformed JSON, a non-object, an unknown key,
 *    bad keys or a non-URL endpoint is 400 (the strict contract schema);
 *  - S4: a valid body is forwarded ONCE, parsed (never raw), and answers 204 `no-store`;
 *  - S5: an API refusal keeps its 4xx, a failure is 502, and the log never holds the endpoint.
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

const ORIGIN = 'http://rede-demo.localhost:3000';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/secret-capability-token';
// A 65-byte uncompressed point (0x04 first) and a 16-byte auth secret, base64url.
const P256DH = `BA${'A'.repeat(85)}`;
const AUTH = 'AAAAAAAAAAAAAAAAAAAAAA';

const validSave = { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, userAgent: 'UA' };
const validDelete = { endpoint: ENDPOINT };

function req(
  method: 'POST' | 'DELETE',
  body: unknown,
  headers: Record<string, string | null> = {},
): Request {
  const all: Record<string, string> = {
    host: 'rede-demo.localhost:3000',
    origin: ORIGIN,
    'content-type': 'application/json',
  };
  for (const [key, value] of Object.entries(headers)) {
    if (value === null) delete all[key];
    else all[key] = value;
  }
  return new Request('http://rede-demo.localhost:3000/api/push/subscriptions', {
    method,
    headers: all,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockResolvedValue(new Response(null, { status: 204 }));
  vi.mocked(createClient).mockClear();
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('/api/push/subscriptions — the device subscription BFF (T-07-44)', () => {
  it('S1. a foreign, missing, `null`, malformed or other-port Origin is 403 on both verbs', async () => {
    for (const handler of [POST, DELETE] as const) {
      const method = handler === POST ? 'POST' : 'DELETE';
      for (const origin of [
        'http://evil.example',
        null,
        'null',
        'not a url',
        'http://rede-demo.localhost:4000',
      ]) {
        const res = await handler(req(method, validSave, { origin }));
        expect(res.status, `${method} ${origin}`).toBe(403);
        expect(res.headers.get('cache-control')).toBe('no-store');
      }
    }
    // x-forwarded-host wins over host (the proxy.ts precedence).
    const forwarded = { host: 'localhost:3000', 'x-forwarded-host': 'rede-demo.localhost:3000' };
    expect((await POST(req('POST', validSave, forwarded))).status).toBe(204);
    vi.mocked(apiFetch).mockClear();
    expect(
      (await POST(req('POST', validSave, { ...forwarded, origin: 'http://localhost:3000' })))
        .status,
    ).toBe(403);
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('S2. same origin without a verified session is 401, with no API call', async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error('no session') });
    expect((await POST(req('POST', validSave))).status).toBe(401);
    expect((await DELETE(req('DELETE', validDelete))).status).toBe(401);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('S3. oversized and malformed bodies are 413 / 400, and none reaches the API', async () => {
    expect((await POST(req('POST', validSave, { 'content-length': '5000' }))).status).toBe(413);
    expect((await POST(req('POST', 'x'.repeat(5000)))).status).toBe(413);

    for (const body of [
      '{not json',
      JSON.stringify([validSave]),
      JSON.stringify('texto'),
      JSON.stringify(null),
      JSON.stringify({ ...validSave, expirationTime: null }),
      JSON.stringify({ ...validSave, endpoint: 'not a url' }),
      JSON.stringify({ ...validSave, keys: { p256dh: 'short', auth: AUTH } }),
      JSON.stringify({ ...validSave, keys: { p256dh: P256DH, auth: 'short' } }),
      JSON.stringify({ endpoint: ENDPOINT }),
    ]) {
      const res = await POST(req('POST', body));
      expect(res.status, body.slice(0, 50)).toBe(400);
    }
    for (const body of ['{', JSON.stringify({}), JSON.stringify({ endpoint: '', extra: 1 })]) {
      expect((await DELETE(req('DELETE', body))).status, body).toBe(400);
    }
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('S4. a valid save and a valid forget are forwarded ONCE, parsed, and answer 204', async () => {
    const saved = await POST(req('POST', validSave));
    expect(saved.status).toBe(204);
    expect(saved.headers.get('cache-control')).toBe('no-store');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(path).toBe('/v1/notifications/push-subscriptions');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual(validSave);

    vi.mocked(apiFetch).mockClear();
    const forgotten = await DELETE(req('DELETE', validDelete));
    expect(forgotten.status).toBe(204);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [deletePath, deleteInit] = vi.mocked(apiFetch).mock.calls[0] ?? [];
    expect(deletePath).toBe('/v1/notifications/push-subscriptions');
    expect(deleteInit?.method).toBe('DELETE');
    expect(JSON.parse(String(deleteInit?.body))).toEqual(validDelete);
  });

  it('S5. an API 4xx is kept, a 5xx or transport failure is 502, and logs hold no endpoint', async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 400 }));
    expect((await POST(req('POST', validSave))).status).toBe(400);
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
    expect((await POST(req('POST', validSave))).status).toBe(502);
    vi.mocked(apiFetch).mockRejectedValueOnce(new TypeError('fetch failed'));
    expect((await DELETE(req('DELETE', validDelete))).status).toBe(502);

    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).toContain('push.subscription_forward_failed');
    expect(logged).not.toContain('secret-capability-token');
  });
});
