import {
  createBoundedTtlCache,
  isRegistrableHost,
  normalizeHost,
  type ResolvedBranding,
  resolveBranding,
  type TenantStatus,
} from '@tria/contracts';
import { and, eq, isNotNull } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains, tenants } from '../../db/schema';

/**
 * Everything the public shell may know about the tenant behind a host (D-20, D-25, D-32, D-35):
 * identity, status (a suspended tenant's host still resolves so its screens stay branded), whether
 * this host is the tenant's primary and which host is, and the resolved brand.
 */
export type TenantHostResolution =
  | {
      kind: 'tenant';
      tenantId: string;
      slug: string;
      displayName: string;
      status: TenantStatus;
      isPrimary: boolean;
      primaryHost: string;
      branding: ResolvedBranding;
    }
  | { kind: 'unknown' };

const TTL_MS = 60_000;
/**
 * Hard bound (WR-06): `GET /v1/public/tenants/by-host` is unauthenticated and the key is whatever
 * host the client sent, negative answers included. 1,000 entries is far above any real number of
 * tenant domains and keeps a random-hostname storm at a fixed memory cost; the LRU eviction means a
 * storm can at worst evict the real hosts' cached answers, never grow the map.
 */
const MAX_ENTRIES = 1_000;
const cache = createBoundedTtlCache<TenantHostResolution>(MAX_ENTRIES);

/**
 * host -> tenant (D-20/D-23). Cached in-process for 60 s for BOTH outcomes: negative caching keeps an
 * unknown-host storm off the database; a domain attached later becomes visible within a minute or at
 * once via `invalidateTenantHost`. Caches the host mapping and the public brand only — never anything
 * about a membership.
 *
 * Only a VERIFIED host resolves (D-36, T-02-02): `verified_at is null` is `unknown` on both tiers,
 * so an attached-but-unproven domain exposes no tenant fact. The tenant's status is NOT a filter —
 * it is returned (D-32) so the shell can show a branded "indisponível" screen; `requireAuth` still
 * refuses members of a suspended tenant on its own.
 *
 * A host that cannot possibly be registered (`isRegistrableHost`, the `tenant_domains_host_chk`
 * predicate) is answered `unknown` before the cache and before the admin-lane query.
 */
export async function resolveTenantHost(rawHost: string): Promise<TenantHostResolution> {
  const host = normalizeHost(rawHost);
  if (!host || !isRegistrableHost(host)) return { kind: 'unknown' };

  const hit = cache.get(host);
  if (hit) return hit;

  const value = await withAdminTx<TenantHostResolution>(async (tx) => {
    const rows = await tx
      .select({
        tenantId: tenants.id,
        slug: tenants.slug,
        displayName: tenants.displayName,
        status: tenants.status,
        branding: tenants.branding,
        isPrimary: tenantDomains.isPrimary,
      })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(and(eq(tenantDomains.host, host), isNotNull(tenantDomains.verifiedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return { kind: 'unknown' };

    // D-35: the alias answer names the primary so proxy.ts can 308 to it. When the tenant has no
    // verified primary (a mid-migration state), the matched host stands in for it.
    let primaryHost = host;
    if (!row.isPrimary) {
      const primaries = await tx
        .select({ host: tenantDomains.host })
        .from(tenantDomains)
        .where(
          and(
            eq(tenantDomains.tenantId, row.tenantId),
            eq(tenantDomains.isPrimary, true),
            isNotNull(tenantDomains.verifiedAt),
          ),
        )
        .limit(1);
      primaryHost = primaries[0]?.host ?? host;
    }

    return {
      kind: 'tenant',
      tenantId: row.tenantId,
      slug: row.slug,
      displayName: row.displayName,
      status: row.status === 'suspended' ? 'suspended' : 'active',
      isPrimary: row.isPrimary,
      primaryHost,
      branding: resolveBranding(row.branding),
    };
  });

  cache.set(host, value, TTL_MS);
  return value;
}

/** Used by the Phase 2 attach flow (TENANT-07) so a freshly registered host resolves immediately. */
export function invalidateTenantHost(rawHost: string): void {
  const host = normalizeHost(rawHost);
  if (host) cache.delete(host);
}

/** Test seam: how many hosts are cached right now (never more than the bound). */
export function cachedTenantHostCount(): number {
  return cache.size;
}
