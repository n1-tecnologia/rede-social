import { normalizeHost } from '@tria/contracts';
import { and, eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantDomains, tenants } from '../../db/schema';

export type TenantHostResolution =
  | { kind: 'tenant'; tenantId: string; slug: string; displayName: string }
  | { kind: 'unknown' };

const TTL_MS = 60_000;
const cache = new Map<string, { value: TenantHostResolution; expiresAt: number }>();

/**
 * host -> tenant (D-20/D-23). Cached in-process for 60 s for BOTH outcomes: negative caching keeps an
 * unknown-host storm off the database; a domain attached later becomes visible within a minute or at
 * once via `invalidateTenantHost`. Caches the host mapping only — never anything about a membership.
 */
export async function resolveTenantHost(rawHost: string): Promise<TenantHostResolution> {
  const host = normalizeHost(rawHost);
  if (!host) return { kind: 'unknown' };

  const now = Date.now();
  const hit = cache.get(host);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await withAdminTx<TenantHostResolution>(async (tx) => {
    const rows = await tx
      .select({ tenantId: tenants.id, slug: tenants.slug, displayName: tenants.displayName })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(and(eq(tenantDomains.host, host), eq(tenants.status, 'active')))
      .limit(1);
    const row = rows[0];
    return row ? { kind: 'tenant', ...row } : { kind: 'unknown' };
  });

  cache.set(host, { value, expiresAt: now + TTL_MS });
  return value;
}

/** Used by the Phase 2 attach flow (TENANT-07) so a freshly registered host resolves immediately. */
export function invalidateTenantHost(rawHost: string): void {
  const host = normalizeHost(rawHost);
  if (host) cache.delete(host);
}
