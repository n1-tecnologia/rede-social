import { StatusCard } from '@/components/platform/StatusCard';
import { requirePlatformTenantDetail } from '@/lib/platform';
import { setTenantStatusAction } from '../../../actions';

/**
 * Status tab (D-32): the current state and ONE call to action — suspend (confirmed) or reactivate.
 * The detail call is deduplicated with the layout's by React `cache`; the authorisation is still
 * re-proved by this segment.
 */
export default async function TenantStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  return (
    <StatusCard
      tenantId={detail.tenant.id}
      tenantName={detail.tenant.displayName}
      status={detail.tenant.status}
      action={setTenantStatusAction}
    />
  );
}
