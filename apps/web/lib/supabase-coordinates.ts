import { env } from '@/lib/env';
import { isAllowedSupabaseOrigin, storageKeyFor } from '@/lib/supabase-origin';

// The pure rules live in `supabase-origin.ts` (no environment, so a client module such as the upload
// helper can use them); they are re-exported here because this is the module callers think of.
export {
  isAllowedSupabaseOrigin,
  staleAuthCookieNames,
  storageKeyFor,
} from '@/lib/supabase-origin';

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
 * The coordinates for the host brand a public page renders (`getHostBrand()`): the tenant's answer on a
 * tenant host, the central pair otherwise. `null` exactly when `getSupabaseCoordinates` says so.
 */
export function brandCoordinates(brand: {
  mode: string;
  host: string;
  tenant: { supabaseUrl?: string | undefined; publishableKey?: string | undefined } | null;
}): SupabaseCoordinates | null {
  return getSupabaseCoordinates({
    mode: brand.mode,
    host: brand.host,
    supabaseUrl: brand.tenant?.supabaseUrl,
    publishableKey: brand.tenant?.publishableKey,
  });
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
