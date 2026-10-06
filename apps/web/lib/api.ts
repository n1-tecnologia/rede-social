import type { AppType } from '@rede-social/api/types';
import { TENANT_CHOICE_HEADER, TENANT_HOST_HEADER } from '@rede-social/contracts';
import { hc } from 'hono/client';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';
import { createClient } from '@/lib/supabase/server';
import { getHostTenant, type HostShell, TENANT_SLUG_COOKIE } from '@/lib/tenant-host';

/**
 * The `x-tenant-choice` value for this request, or `null` (D-06, D-308). Only a GENERIC host
 * (localhost, Vercel Preview) has a choice to make, so a tenant or platform host never forwards one —
 * there the host alone selects the membership (D-307). The value is the `tenant_slug` cookie the
 * picker or `/cadastro/{slug}` stored: a hint the API validates against the caller's own memberships
 * (`pickGenericMembership`), never authority — a slug naming any other community is ignored.
 */
async function tenantChoice(hostTenant: HostShell): Promise<string | null> {
  if (hostTenant.mode !== 'generic') return null;
  const value = (await cookies()).get(TENANT_SLUG_COOKIE)?.value?.trim() ?? '';
  return value === '' ? null : value;
}

/**
 * Headers every API call carries (D-23):
 * - `Authorization: Bearer <access_token>` — read with `getSession()` ONLY after proxy.ts / the layout
 *   validated the claims; the API re-verifies the token against JWKS, so the session is never trusted here.
 * - `x-tenant-host` — the normalised browser-facing host. On a verified tenant host the API reads the
 *   caller's membership IN THAT TENANT only, so the host selects among the caller's own memberships
 *   (D-307) and never grants one: no membership there is 403 TENANT_HOST_MISMATCH.
 * - `x-tenant-choice` — GENERIC hosts only: the `tenant_slug` cookie, a hint the API validates among
 *   the caller's own memberships (D-06, D-308). Absent on tenant and platform hosts.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const [supabase, hostTenant] = await Promise.all([createClient(), getHostTenant()]);
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers: Record<string, string> = { [TENANT_HOST_HEADER]: hostTenant.host };
  const choice = await tenantChoice(hostTenant);
  if (choice) headers[TENANT_CHOICE_HEADER] = choice;
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
 * `x-tenant-host` and, on a generic host, `x-tenant-choice` (the API re-verifies the token against
 * JWKS; the host and the choice only select among the caller's own memberships). Never cached.
 */
export async function apiFetchWithToken(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const hostTenant = await getHostTenant();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set(TENANT_HOST_HEADER, hostTenant.host);
  const choice = await tenantChoice(hostTenant);
  if (choice) headers.set(TENANT_CHOICE_HEADER, choice);
  return fetch(`${env.API_URL}${path}`, { ...init, headers, cache: 'no-store' });
}

/** Typed Hono RPC client (`hc<AppType>`) bound to the API with the same headers. */
export const api = hc<AppType>(env.API_URL, {
  headers: authHeaders,
  init: { cache: 'no-store' },
});
