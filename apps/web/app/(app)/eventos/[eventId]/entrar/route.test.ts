import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 06-06 — `GET /eventos/{id}/entrar` without a server (D-207, D-217, D-218, T-06-35..T-06-37,
 * T-06-40). `enterEvent` (the API call) is the seam; the handler under test is the real one.
 *
 *  1. a prefetch or a framework data fetch (`Sec-Purpose`, `Purpose`, `Next-Router-Prefetch`, `RSC`)
 *     is `204 no-store` and never reaches the API;
 *  2. a passing outcome is a 303 to EXACTLY the stored https URL, with `no-store` and `no-referrer`;
 *  3. a stored URL that is not https (or not a URL) answers like not-found: the detail;
 *  4. each refusal lands on its aviso reason; not-found and failures on the detail; a bootstrap
 *     refusal on its own path; a malformed id never reaches the API;
 *  5. nothing in the request steers the destination (no open redirect): a `next`/`url` query
 *     parameter, a `Referer` or a `Location`-looking header is ignored.
 */

const { enter } = vi.hoisted(() => ({ enter: vi.fn() }));
vi.mock('@/lib/events', () => ({ enterEvent: enter }));

const { GET } = await import('./route');

const ID = '0e000000-0000-4000-8000-000000000e02';
const MEETING = 'https://meet.example.test/sala?pwd=abc';

function call({
  headers = {},
  query = '',
  id = ID,
}: {
  headers?: Record<string, string>;
  query?: string;
  id?: string;
} = {}) {
  const request = new Request(`http://rede-demo.localhost:3000/eventos/${id}/entrar${query}`, {
    headers,
  });
  return GET(request, { params: Promise.resolve({ eventId: id }) });
}

const ok = (outcome: string, meetingUrl: string | null) => ({
  status: 'ok',
  result: { outcome, meetingUrl },
});

beforeEach(() => {
  enter.mockReset();
});

describe('/entrar — prefetches and framework fetches record nothing (D-218)', () => {
  it.each([
    [{ 'Sec-Purpose': 'prefetch' }],
    [{ 'Sec-Purpose': 'prefetch;prerender' }],
    [{ Purpose: 'prefetch' }],
    [{ 'Next-Router-Prefetch': '1' }],
    [{ RSC: '1' }],
  ])('%j is 204 no-store and never calls the API', async (headers) => {
    const res = await call({ headers });
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('location')).toBeNull();
    expect(enter).not.toHaveBeenCalled();
  });
});

describe('/entrar — the gate’s answer becomes a 303', () => {
  it.each([['forward'], ['recorded'], ['already']])(
    '%s: 303 to EXACTLY the stored https URL, no-store and no-referrer',
    async (outcome) => {
      enter.mockResolvedValue(ok(outcome, MEETING));
      const res = await call();
      expect(enter).toHaveBeenCalledWith(ID);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(MEETING);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    },
  );

  it.each([['http://meet.example.test/sala'], ['javascript:alert(1)'], ['nao e uma url'], [null]])(
    'a stored %j is never followed: the detail answers',
    async (url) => {
      enter.mockResolvedValue(ok('recorded', url));
      const res = await call();
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`/eventos/${ID}`);
    },
  );

  it.each([
    ['ended', 'encerrado'],
    ['cancelled', 'cancelado'],
    ['confirm_first', 'confirmar'],
  ])('%s lands on the aviso reason %s', async (outcome, reason) => {
    enter.mockResolvedValue(ok(outcome, null));
    const res = await call();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`/eventos/${ID}/entrar/aviso?motivo=${reason}`);
  });

  it('not-found and an error land on the detail; a bootstrap refusal on its own path', async () => {
    enter.mockResolvedValue({ status: 'not-found' });
    expect((await call()).headers.get('location')).toBe(`/eventos/${ID}`);
    enter.mockResolvedValue({ status: 'error' });
    expect((await call()).headers.get('location')).toBe(`/eventos/${ID}`);
    enter.mockResolvedValue({ status: 'redirect', path: '/entrar' });
    expect((await call()).headers.get('location')).toBe('/entrar');
  });

  it('a malformed id never reaches the API; an uppercase id is sent lowercased', async () => {
    const res = await call({ id: 'nao-e-um-id' });
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/eventos/nao-e-um-id');
    expect(enter).not.toHaveBeenCalled();

    enter.mockResolvedValue({ status: 'not-found' });
    await call({ id: ID.toUpperCase() });
    expect(enter).toHaveBeenCalledWith(ID);
  });
});

describe('/entrar — no open redirect (D-217, T-06-36)', () => {
  it('a destination in the query, the Referer or a forged header is ignored', async () => {
    enter.mockResolvedValue(ok('recorded', MEETING));
    const res = await call({
      query: '?next=https://evil.example/&url=https://evil.example/&redirect=//evil.example',
      headers: {
        Referer: 'https://evil.example/',
        'X-Forwarded-Location': 'https://evil.example/',
      },
    });
    expect(res.headers.get('location')).toBe(MEETING);

    enter.mockResolvedValue({ status: 'not-found' });
    const miss = await call({ query: '?next=https://evil.example/' });
    expect(miss.headers.get('location')).toBe(`/eventos/${ID}`);
  });
});
