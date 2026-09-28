import { REAL_TENANT_DEFAULT_MODULES } from '@rede-social/contracts';
import { PageHeader } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { NewTenantForm } from '@/components/platform/NewTenantForm';
import { requirePlatformAccess } from '@/lib/platform';
import { createTenantAction } from '../actions';

/**
 * `/plataforma/novo` — the single "Novo tenant" form of D-31 (ROLE-03). The six real module keys are
 * passed from the server so the client form never imports the contracts barrel, and the seventh
 * registry key (`example`, D-19) is never in the list. The authorisation is re-proved here even
 * though the layout already did (every segment ends with its own NEXT_REDIRECT on refusal).
 */
export default async function NewTenantPage() {
  const [t] = await Promise.all([getTranslations('platform'), requirePlatformAccess()]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('new.title')}
        backHref="/plataforma"
        backLabel={t('new.back')}
        className="-mx-2"
      />
      <NewTenantForm moduleKeys={[...REAL_TENANT_DEFAULT_MODULES]} action={createTenantAction} />
    </div>
  );
}
