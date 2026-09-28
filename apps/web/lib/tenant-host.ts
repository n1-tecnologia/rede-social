import {
  createBoundedTtlCache,
  type HostTenant as HostTenantFacts,
  hostTenantSchema,
  isRegistrableHost,
  normalizeHost,
} from '@rede-social/contracts';
import { headers } from 'next/headers';
import { env } from '@/lib/env';

export type HostMode = 'tenant' | 'platform' | 'generic';

/**
 * How the browser-facing host classifies the request (D-20/D-21):
 * - `tenant`   — the host is a VERIFIED `tenant_domains` row (D-36); the public shell shows that tenant.
 * - `platform` — the host equals `PLATFORM_HOST`; the platform's `super_admin` entry, no member sign-up.
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
// Interactive path (proxy + every layout); the API-side adapters use 10 s — a hanging Cloud Run must
// fail open to generic within one perceived beat (WR-06). A timeout is a lookup failure: generic for
// TTL_ERROR_MS, never another tenant's brand.
const HOST_LOOKUP_TIMEOUT_MS = 2_000;

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
 * Bounded by `HOST_LOOKUP_TIMEOUT_MS`; a timeout is a lookup failure — generic for `TTL_ERROR_MS`,
 * never another tenant's brand.
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
      { cache: 'no-store', signal: AbortSignal.timeout(HOST_LOOKUP_TIMEOUT_MS) },
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

/**
 * The name to interpolate into a `{tenant}` string when the only thing in scope is the host shell
 * (UI-D-46). On a tenant host that is the display name proxy.ts resolved from `tenant_domains`; on
 * the platform or a generic host there is no tenant to name, so the honest answer is the host
 * itself — a value the browser already has, never an empty string and never a stray brace.
 *
 * Surfaces that hold the BOOTSTRAP use `bootstrap.tenant.displayName` instead: that is the tenant
 * of record (the membership's), and the host only selects the shell. The two agree by construction
 * — a session whose membership does not match the host is refused with `TENANT_HOST_MISMATCH`
 * before any page renders — so this helper is for the surfaces that have no bootstrap in hand.
 */
export function tenantDisplayName(shell: HostShell): string {
  return shell.mode === 'tenant' ? shell.displayName : shell.host;
}

/**
 * The ONE origin a link that LEAVES this app may carry (FEED-07, D-35, T-04-51).
 *
 * `https://{primaryHost}`, composed on the SERVER from the verified `tenant_domains` row the
 * by-host lookup answered with — never from the browser's own location. The difference matters
 * because a member can legitimately be ON an alias host at the moment they tap share: 02-08 folds
 * an alias to the primary with a 308, but a link built from `location.origin` in the browser would
 * have been minted BEFORE that fold and would travel, in a message to another member, carrying a
 * host that may be retired tomorrow. The same reasoning is why the share helper takes its surfaces
 * injected and cannot reach for a location of its own.
 *
 * `null` on the platform and generic shells, and on any host whose lookup did not resolve: there is
 * no verified primary host to name, and the honest answer is to offer no link at all rather than
 * one pointing at the wrong origin. `isRegistrableHost` re-checks the value the API returned — the
 * loop guard `primaryHostRedirect` already applies to the same field (T-02-40/45).
 *
 * The scheme is `https` unconditionally, per UI-SPEC §Post page contract: a shared link is for
 * another device, and every host that can be REGISTERED is served over TLS. On the local stack the
 * copied value is therefore `https://rede-demo.localhost/post/{id}` while the tab is on `:3000`,
 * which is correct about the tenant and deliberately not a dev convenience.
 */
export async function primaryHostOrigin(): Promise<string | null> {
  const shell = await getHostTenant();
  if (shell.mode !== 'tenant') return null;

  const resolved = await resolveHostTenant(shell.host);
  if (resolved.mode !== 'tenant') return null;

  const primaryHost = normalizeHost(resolved.primaryHost);
  if (!primaryHost || !isRegistrableHost(primaryHost)) return null;
  return `https://${primaryHost}`;
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
