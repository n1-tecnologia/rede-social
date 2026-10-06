import { AdminsPanel } from '@/components/platform/AdminsPanel';
import { requirePlatformTenantDetail } from '@/lib/platform';

/**
 * Admins tab (D-29/D-30): the shared `AdminsPanel` — the first-admin invite and the `admin_tenant`
 * memberships, with the send/resend control. The tenant wizard's Pronto step renders the same panel.
 */
export default async function TenantAdminsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  return <AdminsPanel tenantId={id} detail={detail} />;
}
