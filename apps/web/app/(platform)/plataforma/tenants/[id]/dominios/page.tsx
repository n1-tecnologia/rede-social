import { DomainsPanel } from '@/components/platform/DomainsPanel';
import { requirePlatformTenantDetail } from '@/lib/platform';

/**
 * Domínios tab (TENANT-07 UI half, D-34/D-35/D-36, mockup `tenant-page-dominios`): the shared
 * `DomainsPanel` — the attach form, then one card per host or the empty state. The detail comes from
 * `requirePlatformTenantDetail` (the segment re-proves the authorisation, deduplicated with the
 * layout's call by React `cache`). The tenant wizard's Domínio step renders the same panel.
 */
export default async function TenantDomainsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  return <DomainsPanel tenantId={id} detail={detail} />;
}
