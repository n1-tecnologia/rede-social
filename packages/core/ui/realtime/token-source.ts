/**
 * The browser's Realtime token, held in JS memory only (07-03, RESEARCH Pattern 5 and Pitfall 8).
 *
 * realtime-js calls its `accessToken` callback on EVERY heartbeat (25 s) and on every join. Without a
 * cache that would be one `GET /api/realtime/token` per heartbeat per window. The source below keeps
 * the last `{ accessToken, expiresAt }` and asks again only when there is none or the token expires in
 * less than {@link REFRESH_MARGIN_MS}; concurrent callers share the one request in flight.
 *
 * The token is never written to `localStorage`, `sessionStorage` or a cookie: it lives in this closure
 * and dies with the page (T-07-13).
 */

/** What `GET /api/realtime/token` answers: the session's access token and its `exp` in SECONDS. */
export interface RealtimeToken {
  accessToken: string;
  expiresAt: number;
}

/** Refetch this long before expiry, so a heartbeat never pushes a token about to die. */
export const REFRESH_MARGIN_MS = 120_000;

const isToken = (value: unknown): value is RealtimeToken =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RealtimeToken).accessToken === 'string' &&
  (value as RealtimeToken).accessToken.length > 0 &&
  typeof (value as RealtimeToken).expiresAt === 'number' &&
  Number.isFinite((value as RealtimeToken).expiresAt);

/**
 * `fetch(url)` → a token, or `null` for anything else: a non-2xx answer (401 without a session, 403
 * off-origin), a redirect (proxy.ts sends an expired session to `/entrar`; `redirect: 'manual'` keeps
 * that from being parsed as a token), a body of the wrong shape or a network error. Never throws.
 */
export function tokenFetcher(
  url: string,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): () => Promise<RealtimeToken | null> {
  return async () => {
    try {
      const res = await fetchImpl(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        redirect: 'manual',
      });
      if (!res.ok) return null;
      const body: unknown = await res.json();
      return isToken(body) ? { accessToken: body.accessToken, expiresAt: body.expiresAt } : null;
    } catch {
      return null;
    }
  };
}

/**
 * The `accessToken` callback for `RealtimeClient`: the cached token while it has more than
 * {@link REFRESH_MARGIN_MS} left, else one (de-duplicated) refetch. A failed refetch yields `null`,
 * which realtime-js treats as "no user token" — a private join is then refused, never widened.
 */
export function createTokenSource(
  fetchToken: () => Promise<RealtimeToken | null>,
  now: () => number = Date.now,
): () => Promise<string | null> {
  let cached: RealtimeToken | null = null;
  let inflight: Promise<RealtimeToken | null> | null = null;

  return async () => {
    if (cached && cached.expiresAt * 1000 - now() >= REFRESH_MARGIN_MS) return cached.accessToken;
    if (!inflight) {
      inflight = fetchToken()
        .catch(() => null)
        .then((token) => {
          cached = token;
          return token;
        })
        .finally(() => {
          inflight = null;
        });
    }
    const token = await inflight;
    return token?.accessToken ?? null;
  };
}
