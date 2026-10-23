import { DatabaseOverviewCard } from '@/components/platform/DatabaseOverviewCard';
import { requirePlatformTenantDatabase, requirePlatformTenantDetail } from '@/lib/platform';
import { relativeFrom } from '@/lib/relative-time';
import { verifyDatabaseAction } from './actions';

/**
 * Banco tab (09.2-19, UI-D-536, DBT-51, DBT-24, DBT-27): where an operator sees whether a tenant's
 * database is up, what and where it is, how far it has been prepared, and replaces its access when it
 * changes upstream. Three cards in `flex flex-col gap-6`: the overview (this task), the Preparação
 * steps and the Credenciais card (tasks 2 and 3).
 *
 * The tenant detail comes from `requirePlatformTenantDetail` (the segment re-proves the authorisation,
 * deduplicated with the layout's call by React `cache`; an unknown id is the segment's not-found
 * screen); the database from `GET …/database` through `requirePlatformTenantDatabase` (401/403
 * navigate, anything else reaches `error.tsx` while the tenant frame and the six tabs stay usable).
 * "When" is computed here, on the server, so no card calls a clock in render.
 */
export default async function TenantDatabasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  const overview = await requirePlatformTenantDatabase(id);
  const now = Date.now();

  return (
    <div className="flex flex-col gap-6">
      <DatabaseOverviewCard
        tenantId={detail.tenant.id}
        overview={overview}
        verifiedWhen={overview.lastCheckedAt ? relativeFrom(overview.lastCheckedAt, now) : null}
        verifyAction={verifyDatabaseAction}
      />
    </div>
  );
}
