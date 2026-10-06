import type { AppType } from '@rede-social/api/types';
import { TENANT_HOST_HEADER } from '@rede-social/contracts';
import { hc } from 'hono/client';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant } from '@/lib/tenant-host';

/**
 * Headers every API call carries (D-23):
 * - `Authorization: Bearer <access_token>` — read with `getSession()` ONLY after proxy.ts / the layout
 *   validated the claims; the API re-verifies the token against JWKS, so the session is never trusted here.
 * - `x-tenant-host` — the normalised browser-facing host so the API can compare it with the membership.
 *   It can only DENY (403 TENANT_HOST_MISMATCH); it never selects data.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const [supabase, hostTenant] = await Promise.all([createClient(), getHostTenant()]);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { [TENANT_HOST_HEADER]: hostTenant.host };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return headers;
}

/** Plain fetch against `${API_URL}${path}` with the auth + host headers. Never cached. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  for (const [key, value] of Object.entries(await authHeaders())) headers.set(key, value);
  return fetch(`${env.API_URL}${path}`, { ...init, headers, cache: 'no-store' });
}

/**
 * Fetch with an EXPLICIT access token (08.1, RESEARCH Pitfall 5): for a session minted earlier in the
 * SAME server action (`signInWithPassword` on the "já tem conta" form). `apiFetch` re-reads the session
 * from `cookies()`, which inside that action is fragile, and it overwrites any `Authorization` passed in
 * `init` when an older session exists — so the join could run as nobody, or as a stale identity.
 *
 * This helper never reads the cookie session: it sends exactly the token it is given plus
 * `x-tenant-host` (the API re-verifies the token against JWKS; the host can only deny). Never cached.
 */
export async function apiFetchWithToken(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set(TENANT_HOST_HEADER, (await getHostTenant()).host);
  return fetch(`${env.API_URL}${path}`, { ...init, headers, cache: 'no-store' });
}

/** Typed Hono RPC client (`hc<AppType>`) bound to the API with the same headers. */
export const api = hc<AppType>(env.API_URL, {
  headers: authHeaders,
  init: { cache: 'no-store' },
});
