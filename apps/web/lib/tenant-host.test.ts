import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveHostTenant } from './tenant-host';

/**
 * WR-06: `resolveHostTenant` runs in proxy.ts and in every layout's `generateMetadata`, so the by-host
 * lookup MUST be bounded — a hanging API fails open to `{ mode: 'generic' }` within one perceived beat,
 * the failure is cached for the error TTL, and it never becomes another tenant's brand. The real
 * function is exercised; only `fetch` and the env are stubbed. Unique hosts per case keep the
 * module-level cache from bleeding between tests.
 */
vi.mock('@/lib/env', () => ({
  env: { API_URL: 'http://api.test', PLATFORM_HOST: 'tria.test' },
}));

const fetchMock = vi.fn();
let errorSpy: ReturnType<typeof vi.spyOn>;

/** Settles ONLY when the request's signal aborts — a Cloud Run that never answers. */
const hangingFetch = (_url: string, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // no signal → hangs forever (the pre-fix behaviour)
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

const branding = {
  logoUrl: null,
  faviconUrl: null,
  iconUrls: null,
  colors: {
    primary: '#b91c1c',
    secondary: '#f87171',
    onPrimary: '#ffffff',
    primaryDark: '#e26666',
    onPrimaryDark: '#16233b',
  },
};

const tenantBody = (primaryHost: string) => ({
  slug: 'acme',
  displayName: 'Acme',
  status: 'active' as const,
  isPrimary: true,
  primaryHost,
  branding,
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  errorSpy.mockRestore();
});

describe('resolveHostTenant — bounded by-host lookup (WR-06)', () => {
  const slowHost = `slow-${Date.now()}.example`;

  it('1. a hanging API resolves to generic within the 2 s budget, logs the timeout', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const startedAt = Date.now();
    const result = await resolveHostTenant(slowHost);
    const elapsed = Date.now() - startedAt;

    expect(result).toEqual({ mode: 'generic', host: slowHost });
    expect(elapsed).toBeGreaterThanOrEqual(1_900);
    expect(elapsed).toBeLessThan(3_500);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`http://api.test/v1/public/tenants/by-host?host=${slowHost}`);
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);

    expect(errorSpy).toHaveBeenCalledWith(
      'tenant-host.lookup_failed',
      expect.objectContaining({ host: slowHost, error: expect.stringContaining('TimeoutError') }),
    );
  }, 10_000);

  it('2. the generic answer is served from the error TTL — no second fetch for the same host', async () => {
    fetchMock.mockImplementation(hangingFetch);
    const result = await resolveHostTenant(slowHost);
    expect(result).toEqual({ mode: 'generic', host: slowHost });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it('3. a healthy 200 body still classifies as tenant — and the call carried a signal too', async () => {
    const host = `healthy-${Date.now()}.example`;
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify(tenantBody(host)), { status: 200 }),
    );

    const result = await resolveHostTenant(host);
    expect(result).toEqual({ mode: 'tenant', host, ...tenantBody(host) });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
