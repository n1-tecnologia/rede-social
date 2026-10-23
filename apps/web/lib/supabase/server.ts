import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { sessionCookieOptions } from '@/lib/supabase/cookie-options';
import {
  coordinatesFromPair,
  getSupabaseCoordinates,
  type SupabaseCoordinates,
} from '@/lib/supabase-coordinates';
import { getHostTenant, resolveHostTenant } from '@/lib/tenant-host';

/**
 * Thrown when the request's host cannot be given a Supabase project to talk to: its by-host answer
 * carries a half or a disallowed project address (`lib/supabase-coordinates.ts`), or the host claims a
 * tenant that the lookup no longer resolves. The tenant is unavailable to the shell; the central
 * project is NEVER substituted for it (D-538, T-09.2-83). `proxy.ts` already routes such a host to
 * `/comunidade-indisponivel`, so a page or action only meets this on a request that raced the proxy.
 */
export class SupabaseCoordinatesUnavailableError extends Error {
  constructor(reason: string) {
    super(`supabase.coordinates_unavailable: ${reason}`);
    this.name = 'SupabaseCoordinatesUnavailableError';
  }
}

/**
 * The coordinates of the project THIS request's host selects (D-538). Resolved per call from the host
 * `proxy.ts` forwarded and the cached by-host answer; nothing is remembered here, so two concurrent
 * requests for two hosts cannot see each other's project.
 */
export async function coordinatesForRequest(): Promise<SupabaseCoordinates> {
  const shell = await getHostTenant();
  let coordinates: SupabaseCoordinates | null;
  if (shell.mode === 'tenant') {
    const resolved = await resolveHostTenant(shell.host);
    // The proxy classified this host as a tenant a moment ago; a lookup that now says otherwise
    // (first-ever failure, or the host was just detached) must not quietly become the central project.
    if (resolved.mode !== 'tenant')
      throw new SupabaseCoordinatesUnavailableError('host_unresolved');
    coordinates = getSupabaseCoordinates(resolved);
  } else {
    coordinates = getSupabaseCoordinates(shell);
  }
  if (!coordinates) throw new SupabaseCoordinatesUnavailableError('coordinates_rejected');
  return coordinates;
}

/**
 * Server-side Supabase Auth client bound to the request cookies (Next 16: `await cookies()`).
 * One of the two sanctioned frontend -> Supabase paths (login / refresh / recovery). Data always goes
 * through the API (`lib/api.ts`), never through this client.
 *
 * 09.2-17: the project is the host's (`coordinatesForRequest`). An explicit `opts` pair wins, but is
 * validated by the same allowed-origin rule and must be given whole; a refused pair throws.
 */
export async function createClient(opts?: { supabaseUrl?: string; publishableKey?: string }) {
  let coordinates: SupabaseCoordinates | null;
  if (opts?.supabaseUrl !== undefined || opts?.publishableKey !== undefined) {
    coordinates =
      opts.supabaseUrl && opts.publishableKey
        ? coordinatesFromPair(opts.supabaseUrl, opts.publishableKey)
        : null;
    if (!coordinates) throw new SupabaseCoordinatesUnavailableError('coordinates_rejected');
  } else {
    coordinates = await coordinatesForRequest();
  }

  const cookieStore = await cookies();
  return createServerClient(coordinates.url, coordinates.publishableKey, {
    cookieOptions: sessionCookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component: cookies are read-only there; proxy.ts refreshes them.
        }
      },
    },
  });
}
