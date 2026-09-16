import {
  createBoundedTtlCache,
  type HostTenant as HostTenantFacts,
  hostTenantSchema,
  isRegistrableHost,
  normalizeHost,
} from '@tria/contracts';
import { headers } from 'next/headers';
import { env } from '@/lib/env';

export type HostMode = 'tenant' | 'platform' | 'generic';

/**
 * How the browser-facing host classifies the request (D-20/D-21):
 * - `tenant`   — the host is a VERIFIED `tenant_domains` row (D-36); the public shell shows that tenant.
 * - `platform` — the host equals `PLATFORM_HOST`; TRIA's `super_admin` entry, no member sign-up.
 * - `generic`  — localhost, `*.vercel.app`, any unregistered host; the slug/cookie fallback applies.
 *
 * The host only selects the PUBLIC SHELL. The tenant of record is always the membership: the API
 * re-resolves `x-tenant-host` from `tenant_domains` solely to REJECT a mismatched session (D-23).
 *
 * The `tenant` variant carries the WHOLE by-host answer (`status`, `isPrimary`, `primaryHost`,
 * `branding` — D-25/D-32/D-35) as resolved by `resolveHostTenant`. Pages that only have the proxy
 * headers get the narrower `HostShell` from `getHostTenant()`.
 */
export type HostTenant =
  | ({ mode: 'tenant'; host: string } & HostTenantFacts)
  | { mode: 'platform'; host: string }
  | { mode: 'generic'; host: string };

/**
 * What the four `x-tenant-*` headers can carry (they are size-limited and never widened): the mode,
 * the host and — on a tenant host — slug and display name. The brand comes from the cached lookup
 * (`getHostBrand()`), never from a header.
 */
export type HostShell =
  | { mode: 'tenant'; host: string; slug: string; displayName: string }
  | { mode: 'platform'; host: string }
  | { mode: 'generic'; host: string };

export const TENANT_MODE_HEADER = 'x-tenant-mode';
export const TENANT_HOST_REQUEST_HEADER = 'x-tenant-host';
export const TENANT_SLUG_HEADER = 'x-tenant-slug';
export const TENANT_NAME_HEADER = 'x-tenant-name';

// 60 s (was 300 s): on Vercel proxy.ts and the layouts run in different functions, so there is no
// cross-instance invalidation — this TTL IS the cache bust for a new logo or color (RESEARCH Pattern 1:
// ≤ 60 s web + 60 s API before the public pages show a brand change).
const TTL_HIT_MS = 60_000; // registered host
const TTL_MISS_MS = 60_000; // 404 TENANT_NOT_FOUND
const TTL_ERROR_MS = 10_000; // network error / 5xx (fail-open to generic, logged)

// Module-level, per instance, keyed by the normalised host. Recorded discretion (plan 01-02 truths).
// Bounded LRU (WR-06): on Vercel the Host is constrained to project domains, but on any other
// runtime it is client-supplied, and negative answers are cached too — the bound keeps a
// random-hostname storm at a fixed memory cost.
const MAX_ENTRIES = 1_000;
const cache = createBoundedTtlCache<HostTenant>(MAX_ENTRIES);

function isGenericFastPath(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.vercel.app');
}

/**
 * proxy.ts and `getHostBrand()`. Classifies the raw `Host` header through the cached public lookup
 * `GET /v1/public/tenants/by-host` (D-20). Never throws: a lookup failure yields `generic`.
 */
export async function resolveHostTenant(rawHost: string | null | undefined): Promise<HostTenant> {
  const host = normalizeHost(rawHost) ?? 'localhost';

  if (env.PLATFORM_HOST && host === normalizeHost(env.PLATFORM_HOST)) {
    return { mode: 'platform', host };
  }
  if (isGenericFastPath(host)) return { mode: 'generic', host };
  // A host that cannot be registered (`tenant_domains_host_chk` shape) is generic without a lookup
  // and without occupying a cache slot.
  if (!isRegistrableHost(host)) return { mode: 'generic', host };

  const hit = cache.get(host);
  if (hit) return hit;

  let value: HostTenant = { mode: 'generic', host };
  let ttl = TTL_ERROR_MS;
  try {
    const res = await fetch(
      `${env.API_URL}/v1/public/tenants/by-host?host=${encodeURIComponent(host)}`,
      { cache: 'no-store' },
    );
    if (res.ok) {
      const parsed = hostTenantSchema.safeParse(await res.json());
      if (parsed.success) {
        value = { mode: 'tenant', host, ...parsed.data };
        ttl = TTL_HIT_MS;
      } else {
        console.error('tenant-host.lookup_failed', { host, reason: 'invalid_body' });
      }
    } else if (res.status === 404) {
      ttl = TTL_MISS_MS;
    } else {
      console.error('tenant-host.lookup_failed', { host, status: res.status });
    }
  } catch (error) {
    console.error('tenant-host.lookup_failed', { host, error: String(error) });
  }

  cache.set(host, value, ttl);
  return value;
}

/**
 * Pages and server actions: rebuilds the classification from the request headers proxy.ts wrote
 * (it overwrites them on every request, so a browser can never claim a mode). Never fetches.
 */
export async function getHostTenant(): Promise<HostShell> {
  const h = await headers();
  const host = normalizeHost(h.get(TENANT_HOST_REQUEST_HEADER)) ?? 'localhost';
  const mode = h.get(TENANT_MODE_HEADER);
  if (mode === 'platform') return { mode: 'platform', host };
  if (mode === 'tenant') {
    const slug = h.get(TENANT_SLUG_HEADER) ?? '';
    const displayName = decodeURIComponent(h.get(TENANT_NAME_HEADER) ?? '');
    if (slug && displayName) return { mode: 'tenant', host, slug, displayName };
  }
  return { mode: 'generic', host };
}

/** Where "Criar nova conta" points (D-22 on tenant hosts, D-01/D-06 fallback on generic hosts, D-21). */
export function signupPath(t: Pick<HostShell, 'mode'>, slug: string): string {
  switch (t.mode) {
    case 'tenant':
      return '/cadastro';
    case 'platform':
      return '/entrar';
    default:
      return `/cadastro/${slug}`;
  }
}
