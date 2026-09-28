import { REAL_TENANT_DEFAULT_MODULES } from '@rede-social/contracts';
import { SectionTitle } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { ModuleToggles } from '@/components/platform/ModuleToggles';
import { requirePlatformTenantDetail } from '@/lib/platform';
import { setModuleAction } from './actions';

/**
 * Módulos tab (ROLE-04, MOD-04, D-16/D-17/D-19, mockup `tenant-page-modulos`): the six toggleable
 * modules in contracts order (`REAL_TENANT_DEFAULT_MODULES` — the seven-key registry constant is
 * never iterated, so the reference module is never listed), joined with the tenant's enabled set:
 * a key absent from it renders off (E15/partial) and every one of the six rows is always present.
 * Names and descriptions come from 02-12's `platform.moduleNames` / `moduleDescriptions`; the tab's
 * own strings from `platformModules.json`. The segment re-proves the authorisation first.
 */
export default async function TenantModulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  const [t, tp] = await Promise.all([
    getTranslations('platformModules'),
    getTranslations('platform'),
  ]);

  const enabled = new Map(detail.modules.map((m) => [m.key, m.enabled]));
  const rows = REAL_TENANT_DEFAULT_MODULES.map((key) => ({
    key,
    name: tp(`moduleNames.${key}`),
    description: tp(`moduleDescriptions.${key}`),
    enabled: enabled.get(key) ?? false,
  }));

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle variant="micro">{t('title')}</SectionTitle>
      <ModuleToggles
        tenantId={id}
        rows={rows}
        labels={{
          helper: t('helper'),
          enabled: t('enabled'),
          disabled: t('disabled'),
          toggle: t.raw('toggle'),
          saved: t('toasts.saved'),
          error: t('toasts.error'),
        }}
        action={setModuleAction}
      />
    </div>
  );
}
