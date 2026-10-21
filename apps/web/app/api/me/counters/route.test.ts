import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 09.1-15 (PAY-14, PAY-15, D-497, T-09.1-73) and 08-04 (MODER-02) — the counters BFF twin.
 *
 * Two 403 envelopes carry a body, each with the flow's own path: `MEMBERSHIP_BLOCKED` (the shipped
 * blocked flow, which signs the device out) and `SUBSCRIPTION_PENDING` (the pending screen, which does
 * not). The `location` is built from `bootstrapRedirectPath`, never from anything the API or the caller
 * sends as a path; every other refusal keeps its bare 4xx.
 */

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), claims: { sub: 'u1' } as object | null }));

vi.mock('@/lib/api', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('@/lib/notifications-bff', () => ({ sameOriginGet: () => true }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: mocks.claims } }) },
  }),
}));

const { GET } = await import('./route');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const request = () => new Request('http://localhost/api/me/counters');

beforeEach(() => {
  mocks.apiFetch.mockReset();
  mocks.claims = { sub: 'u1' };
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/me/counters: the payment cut', () => {
  it('answers 403 SUBSCRIPTION_PENDING with the pending screen’s path and no-store', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      json(403, {
        error: { code: 'SUBSCRIPTION_PENDING', details: { tenantName: 'Clínica Ana' } },
      }),
    );
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      error: { code: 'SUBSCRIPTION_PENDING' },
      location: '/assinatura-pendente?t=Cl%C3%ADnica%20Ana',
    });
  });

  it('builds the location from the mapping, never from a path the API body carries', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      json(403, {
        error: { code: 'SUBSCRIPTION_PENDING', details: { tenantName: 'X' } },
        location: 'https://evil.example/',
      }),
    );
    const body = await (await GET(request())).json();
    expect(body.location).toBe('/assinatura-pendente?t=X');
  });
});

describe('GET /api/me/counters: unchanged behaviour', () => {
  it('still answers the blocked flow for 403 MEMBERSHIP_BLOCKED', async () => {
    mocks.apiFetch.mockResolvedValueOnce(
      json(403, { error: { code: 'MEMBERSHIP_BLOCKED', details: { tenantName: 'Rede Demo' } } }),
    );
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'MEMBERSHIP_BLOCKED' },
      location: '/auth/blocked?t=Rede%20Demo',
    });
  });

  it('keeps any other 403 as a bare empty 403', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(403, { error: { code: 'FORBIDDEN' } }));
    const res = await GET(request());
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('');
  });

  it('answers 401 without calling the API when there is no session', async () => {
    mocks.claims = null;
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('answers 502 for a 5xx and for a transport failure', async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(500, {}));
    expect((await GET(request())).status).toBe(502);
    mocks.apiFetch.mockRejectedValueOnce(new Error('network'));
    expect((await GET(request())).status).toBe(502);
  });
});
