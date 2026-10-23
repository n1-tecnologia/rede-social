import { env } from '@/lib/env';

/**
 * Which Supabase project a request talks to (09.2-17, DBT-39, D-538).
 *
 * With a project per tenant the Auth client, the Realtime client, the Content-Security-Policy origin,
 * the icon allow-list and the upload endpoint can no longer come from one build-time pair of variables.
 * The by-host answer (plan 08) carries the PUBLIC `supabaseUrl` and `publishableKey` of a tenant that
 * lives outside the central project; this module turns that answer into the values the web needs. The
 * web is TOLD which project, it never decides (D-538):
 *
 * - A pure function of the request's own host answer and the environment. There is no module-level
 *   "current project": two requests for two hosts, interleaved at every await, can never see each
 *   other's coordinates (T-09.2-83, P76).
 * - Platform, generic hosts and tenants of the central project (no coordinates in the answer) use the
 *   central pair from `lib/env.ts` exactly as before, so a project-0 tenant is byte-identical.
 * - A tenant answer with ONE of the two fields, or with a project URL that is not an allowed Supabase
 *   origin, yields `null`: the caller treats the tenant as unavailable. The central project is NEVER
 *   substituted for that tenant: serving tenant B's sign-in against the central Auth would be exactly
 *   the single-database behaviour this phase removes (T-09.2-84).
 *
 * This file and `lib/env.ts` are the only readers of the build-time Supabase variables
 * (`lib/no-build-time-supabase.test.ts` enforces it, Pitfall 12): every per-tenant value reaches a client
 * component as a prop from a server component, never from `process.env`.
 */

export interface SupabaseCoordinates {
  /** The project's public API/Auth URL. */
  url: string;
  /** The project's publishable key (public by design). */
  publishableKey: string;
  /** `url`'s origin, for the CSP `img-src`/`media-src`/`connect-src` and the icon allow-list. */
  origin: string;
  /** The Realtime twin: `wss:` for an https project, `ws:` for the local http stack. */
  wsOrigin: string;
  /** The name `@supabase/ssr` gives the session cookie for this project. */
  cookieKey: string;
  source: 'central' | 'tenant';
}

/** What `getSupabaseCoordinates` reads from a resolved host: nothing outside these four fields. */
export type CoordinateSubject =
  | {
      mode: string;
      host?: string;
      supabaseUrl?: string | undefined;
      publishableKey?: string | undefined;
    }
  | null
  | undefined;

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
 */
export function isAllowedSupabaseOrigin(
  raw: unknown,
  { production = process.env.NODE_ENV === 'production' }: { production?: boolean } = {},
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
  if (production) return false;
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

function build(
  url: string,
  publishableKey: string,
  source: SupabaseCoordinates['source'],
): SupabaseCoordinates {
  const parsed = new URL(url);
  return {
    url,
    publishableKey,
    origin: parsed.origin,
    wsOrigin: `${parsed.protocol === 'https:' ? 'wss:' : 'ws:'}//${parsed.host}`,
    cookieKey: storageKeyFor(url),
    source,
  };
}

/** The central project's coordinates, from the build-time pair. */
function central(): SupabaseCoordinates {
  return build(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, 'central');
}

/**
 * The coordinates for a resolved host (or an explicit pair): the tenant's own project when the by-host
 * answer carries BOTH fields and the URL is an allowed origin, `null` when it carries one of them or a
 * disallowed URL (logged, host only), the central pair for everything else.
 */
export function getSupabaseCoordinates(subject: CoordinateSubject): SupabaseCoordinates | null {
  const url = subject?.supabaseUrl;
  const key = subject?.publishableKey;
  if (subject?.mode !== 'tenant' || (url === undefined && key === undefined)) return central();

  if (!url || !key || !isAllowedSupabaseOrigin(url)) {
    console.error('tenant-host.coordinates_rejected', { host: subject.host ?? null });
    return null;
  }
  return build(new URL(url).origin, key, 'tenant');
}

/**
 * An explicit pair (a caller that already holds the coordinates, e.g. a test or a server action that
 * was handed them), validated by the SAME rule. `null` for a disallowed URL or an empty key.
 */
export function coordinatesFromPair(
  url: string,
  publishableKey: string,
): SupabaseCoordinates | null {
  if (!publishableKey || !isAllowedSupabaseOrigin(url)) return null;
  return build(new URL(url).origin, publishableKey, 'tenant');
}
