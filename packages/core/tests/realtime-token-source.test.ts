import { describe, expect, it, vi } from 'vitest';
import { createTokenSource, type RealtimeToken, tokenFetcher } from '../ui/realtime/token-source';

/**
 * 07-03 (RESEARCH Pattern 5, Pitfall 8; T-07-18): realtime-js calls the `accessToken` callback on
 * EVERY 25 s heartbeat, so the source must answer from memory until the token is near expiry, and
 * concurrent callers must share one request. The fetcher turns anything but a well-formed 2xx answer
 * into `null`, and never throws.
 */

const NOW_S = 1_900_000_000;

function answer(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('createTokenSource over tokenFetcher', () => {
  it('20 simulated heartbeats with an hour of validity cost ONE fetch', async () => {
    const fetchImpl = vi.fn(async () =>
      answer(200, { accessToken: 'jwt-1', expiresAt: NOW_S + 3600 }),
    );
    const source = createTokenSource(
      tokenFetcher('/api/realtime/token', fetchImpl as unknown as typeof fetch),
      () => NOW_S * 1000,
    );
    for (let beat = 0; beat < 20; beat++) expect(await source()).toBe('jwt-1');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('/api/realtime/token', {
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'manual',
    });
  });

  it('a token expiring in less than 120 s is fetched again on the next call', async () => {
    const tokens: RealtimeToken[] = [
      { accessToken: 'short', expiresAt: NOW_S + 100 },
      { accessToken: 'fresh', expiresAt: NOW_S + 3600 },
    ];
    const fetchToken = vi.fn(async () => tokens.shift() ?? null);
    const source = createTokenSource(fetchToken, () => NOW_S * 1000);
    expect(await source()).toBe('short');
    expect(await source()).toBe('fresh');
    expect(await source()).toBe('fresh');
    expect(fetchToken).toHaveBeenCalledTimes(2);
  });

  it('two concurrent calls share one request', async () => {
    let release: (value: RealtimeToken) => void = () => {};
    const fetchToken = vi.fn(
      () =>
        new Promise<RealtimeToken | null>((resolve) => {
          release = resolve;
        }),
    );
    const source = createTokenSource(fetchToken, () => NOW_S * 1000);
    const first = source();
    const second = source();
    release({ accessToken: 'shared', expiresAt: NOW_S + 3600 });
    expect(await Promise.all([first, second])).toEqual(['shared', 'shared']);
    expect(fetchToken).toHaveBeenCalledTimes(1);
  });

  it('a 401 answer yields null (and the next call asks again)', async () => {
    const fetchImpl = vi.fn(async () => answer(401, undefined));
    const source = createTokenSource(
      tokenFetcher('/api/realtime/token', fetchImpl as unknown as typeof fetch),
      () => NOW_S * 1000,
    );
    expect(await source()).toBeNull();
    expect(await source()).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('a redirect, a wrong shape or a network error yields null, never a throw', async () => {
    const cases: Array<() => Promise<Response>> = [
      async () => new Response(null, { status: 307, headers: { location: '/entrar' } }),
      async () => answer(200, { accessToken: '', expiresAt: NOW_S + 3600 }),
      async () => answer(200, { token: 'x' }),
      async () => new Response('<html></html>', { status: 200 }),
      async () => {
        throw new TypeError('network down');
      },
    ];
    for (const impl of cases) {
      const fetchToken = tokenFetcher('/api/realtime/token', impl as unknown as typeof fetch);
      await expect(fetchToken()).resolves.toBeNull();
    }
  });
});
