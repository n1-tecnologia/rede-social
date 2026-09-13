import type { ModuleKey } from '@tria/contracts';
import { asc, eq } from 'drizzle-orm';
import { withAdminTx } from '../../db/admin-tx';
import { tenantModules, tenants } from '../../db/schema';

export type PlatformTenantRow = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  createdAt: Date;
  enabledModules: ModuleKey[];
};

/**
 * ROLE-01: the cross-tenant read behind `GET /v1/platform/tenants`. It lives in the kernel's platform
 * lane because that is where the admin lane may be opened at all (Biome `noRestrictedImports`
 * confines `@tria/core/db/admin-tx` to `server/tenancy`, `server/platform` and `scripts/`) — a route
 * file in `apps/api` must never reach past RLS on its own.
 *
 * Two queries instead of a join so a tenant with no enabled module still appears, with an empty list.
 */
export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  const { tenantRows, moduleRows } = await withAdminTx(async (tx) => {
    const tenantRows = await tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        displayName: tenants.displayName,
        status: tenants.status,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .orderBy(asc(tenants.slug));

    const moduleRows = await tx
      .select({ tenantId: tenantModules.tenantId, moduleKey: tenantModules.moduleKey })
      .from(tenantModules)
      .where(eq(tenantModules.enabled, true))
      .orderBy(asc(tenantModules.moduleKey));

    return { tenantRows, moduleRows };
  });

  const byTenant = new Map<string, ModuleKey[]>();
  for (const row of moduleRows) {
    const list = byTenant.get(row.tenantId) ?? [];
    list.push(row.moduleKey as ModuleKey);
    byTenant.set(row.tenantId, list);
  }

  return tenantRows.map((t) => ({ ...t, enabledModules: byTenant.get(t.id) ?? [] }));
}
