import { EmptyState } from '@tria/ui';
import { SearchX } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { LinkButton } from '@/app/(auth)/LinkButton';

/**
 * "Tenant não encontrado" (D-33 `feedback`): reached by `notFound()` from
 * `requirePlatformTenantDetail` (non-uuid or unknown id, T-02-61) and rendered INSIDE the panel rail.
 * The host gate's `notFound()` in `plataforma/layout.tsx` bubbles to Next's default 404 instead — no
 * panel chrome on a tenant host, by design. Carries no data.
 */
export default async function PlatformNotFound() {
  const t = await getTranslations('platform');
  return (
    <EmptyState
      variant="card"
      icon={SearchX}
      title={t('tenant.notFoundTitle')}
      body={t('tenant.notFoundBody')}
      action={
        <LinkButton href="/plataforma" variant="outline">
          {t('tenant.notFoundCta')}
        </LinkButton>
      }
    />
  );
}
