/**
 * The pure rules about a Supabase project address (09.2-17, DBT-39). No environment and no I/O, so
 * client modules (`lib/upload.ts`) can use the SAME predicate the server uses for the by-host answer.
 * Re-exported from `lib/supabase-coordinates.ts`.
 */

/** A hosted project's origin: a single label under `supabase.co`, no port. */
const HOSTED_HOST = /^[a-z0-9-]+\.supabase\.co$/;
/** The local stack and the shim, non-production only. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/**
 * True when `raw` is a bare project origin the web may talk to (T-09.2-84).
 *
 * Production: `https:` and `<label>.supabase.co`, no port. Non-production additionally admits
 * `http(s)://127.0.0.1` and `localhost` (the local stack answers on a port). Always refused: userinfo
 * (`https://x@evil.com`), a path, a query or a fragment, a look-alike such as `x.supabase.co.evil.com`,
 * and anything `new URL` cannot parse.
 *
 * `allowLoopback` exists only for the production-build PWA e2e, which runs against the local http stack
 * (T-09.2-84 keeps every real deploy on https and the hosted host). It defaults to the build-time flag
 * `NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS` being exactly `'1'`, read as a DIRECT property access so Next
 * inlines it at `next build`. The flag is set in one place, `apps/web/playwright.pwa.config.ts`, and
 * `docs/DEPLOY.md` forbids it on Vercel. When on, a production build admits the same loopback hosts as
 * a non-production one, after every structural check above, and nothing more.
 */
export function isAllowedSupabaseOrigin(
  raw: unknown,
  {
    production = process.env.NODE_ENV === 'production',
    allowLoopback = process.env.NEXT_PUBLIC_E2E_LOOPBACK_ORIGINS === '1',
  }: { production?: boolean; allowLoopback?: boolean } = {},
): boolean {
  if (typeof raw !== 'string') return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username !== '' || url.password !== '') return false;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return false;
  // `new URL('https://x.supabase.co/')` and `('https://x.supabase.co')` share an origin; a trailing
  // `?` or `#` with nothing after it leaves `search`/`hash` empty, so the raw text is checked too.
  if (/[?#]/.test(raw)) return false;

  if (url.protocol === 'https:' && HOSTED_HOST.test(url.hostname) && url.port === '') return true;
  if (production && !allowLoopback) return false;
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)
  );
}

/**
 * The cookie name `@supabase/ssr` uses when no `cookieOptions.name` is given:
 * `sb-<first label of the project hostname>-auth-token` (supabase-js 2.116.0 `defaultStorageKey`).
 * Two projects therefore never share a name; `127.0.0.1` gives `sb-127-auth-token`.
 */
export function storageKeyFor(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
}

const AUTH_COOKIE = /^sb-.+-auth-token(\.\d+)?$/;

/**
 * Session cookies of OTHER projects on this request (D-535): every `sb-*-auth-token` cookie (and its
 * `.0`, `.1` chunks) that is not the current project's. After a move, or a coordinates change, the old
 * HttpOnly session would otherwise linger on the host. The match is exact on the key or on
 * `<key>.<digits>`, so a project whose ref happens to extend another's is not mistaken for it.
 */
export function staleAuthCookieNames(
  requestCookieNames: readonly string[],
  currentKey: string,
): string[] {
  return requestCookieNames.filter((name) => {
    if (!AUTH_COOKIE.test(name)) return false;
    if (name === currentKey) return false;
    return !(name.startsWith(`${currentKey}.`) && /^\d+$/.test(name.slice(currentKey.length + 1)));
  });
}
