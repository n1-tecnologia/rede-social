import { TOGGLEABLE_MODULES } from '@rede-social/contracts';
import { SectionTitle } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { type ModuleRowExtras, ModuleToggles } from '@/components/platform/ModuleToggles';
import { requirePlatformTenantDetail } from '@/lib/platform';
import { setModuleAction } from './actions';

/**
 * Módulos tab (ROLE-04, MOD-04, D-16/D-17/D-19, mockup `tenant-page-modulos`): EVERY toggleable
 * module in contracts order (`TOGGLEABLE_MODULES`, eight keys since 08.2's `store`; the reference
 * module is not a key, so it is never listed), joined with the tenant's enabled set: a key absent
 * from it renders off (E15/partial) and every row is always present. Which keys a NEW tenant starts
 * with is `REAL_TENANT_DEFAULT_MODULES` (without `store`), decided at creation, never here: `store`
 * is listed here and starts off (STORE-01, UI-D-382).
 * Names and descriptions come from 02-12's `platform.moduleNames` / `moduleDescriptions`; the tab's
 * own strings from `platformModules.json`. The segment re-proves the authorisation first.
 *
 * **The `social` row (09-12, UI-D-505, D-478, D-482).** `ModuleToggles` knows no module, so the
 * row's extras are built here from facts and catalog strings: while `feed` is off the switch is
 * locked with the requires note (`social` needs Feed), and switching it ON confirms first, with
 * the tenant's display name in the title and a pointer to the go-live item in `docs/DEPLOY.md`
 * (the terms, rules and privacy wording for third-party content is pending, D-478).
 */
export default async function TenantModulesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  const [t, tp] = await Promise.all([
    getTranslations('platformModules'),
    getTranslations('platform'),
  ]);

  const enabled = new Map(detail.modules.map((m) => [m.key, m.enabled]));
  const rows = TOGGLEABLE_MODULES.map((key) => ({
    key,
    name: tp(`moduleNames.${key}`),
    description: tp(`moduleDescriptions.${key}`),
    enabled: enabled.get(key) ?? false,
  }));

  const extras: Record<string, ModuleRowExtras> = {
    social: {
      // Feed off: the note always explains it; the switch is locked only while it would TURN ON, so a
      // tenant that already has `social` on (Feed switched off later) can still turn it off.
      ...(enabled.get('feed') ? {} : { note: t('requiresFeed'), disabled: !enabled.get('social') }),
      confirmEnable: {
        title: t('social.confirm.title', { tenant: detail.tenant.displayName }),
        body: t('social.confirm.body'),
        confirm: t('social.confirm.confirm'),
        cancel: t('social.confirm.cancel'),
      },
    },
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionTitle variant="micro">{t('title')}</SectionTitle>
      <ModuleToggles
        tenantId={id}
        rows={rows}
        extras={extras}
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
