import { StatusCard } from '@/components/platform/StatusCard';
import { getTenantDatabase, requirePlatformTenantDetail } from '@/lib/platform';
import { setTenantStatusAction } from '../../../actions';

/**
 * Status tab (D-32): the current state and ONE call to action — suspend (confirmed) or reactivate.
 * The detail call is deduplicated with the layout's by React `cache`; the authorisation is still
 * re-proved by this segment. The overview's `moving` fact (the same React-cached read as the header
 * pill and the Banco tab, 09.2-20 UI-D-541) disables "Reativar tenant" while the tenant is being moved
 * to a project of its own; an unreadable overview never blocks the tab (the server refuses the change
 * during a move anyway, plan 23).
 */
export default async function TenantStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  const moving = await getTenantDatabase(detail.tenant.id).then(
    (overview) => overview.moving,
    () => false,
  );
  return (
    <StatusCard
      tenantId={detail.tenant.id}
      tenantName={detail.tenant.displayName}
      status={detail.tenant.status}
      moving={moving}
      action={setTenantStatusAction}
    />
  );
}
