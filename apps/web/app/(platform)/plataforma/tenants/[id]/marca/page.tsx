import { EmptyState } from '@tria/ui';
import { Hourglass } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requirePlatformTenantDetail } from '@/lib/platform';

/**
 * Marca (branding) tab — typed tab-route stub. Plan 02-14 replaces this page with the real tab; until then
 * the tab link never 404s and the segment still re-proves the authorisation per page (D-23).
 */
export default async function TenantTabPendingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [t] = await Promise.all([getTranslations('platform'), requirePlatformTenantDetail(id)]);
  return (
    <EmptyState
      variant="card"
      icon={Hourglass}
      title={t('tenant.tabPendingTitle')}
      body={t('tenant.tabPendingBody')}
    />
  );
}
