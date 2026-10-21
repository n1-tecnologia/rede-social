import { TOGGLEABLE_MODULES } from '@rede-social/contracts';
import { SectionTitle } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { type ModuleRowExtras, ModuleToggles } from '@/components/platform/ModuleToggles';
import { SocialLimitsSheet } from '@/components/platform/SocialLimitsSheet';
import { getSocialSettings, requirePlatformTenantDetail } from '@/lib/platform';
import { saveSocialLimitsAction, setModuleAction } from './actions';

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
 * (the terms, rules and privacy wording for third-party content is pending, D-478). While `social`
 * is on, the row also carries the "Configurar limites" sheet (UI-D-505 c), which opens with the
 * tenant's effective media limits read here from the API (the defaults when nothing is saved).
 *
 * **The `payments` row (09.1-16, UI-D-527, D-501, A-UI-6).** A normal row that requires nothing: when
 * `store` is off it carries the note that only the entrance is controlled, the switch stays enabled,
 * enabling needs no confirmation, and DISABLING opens the danger `ConfirmDialog` naming the tenant and
 * what reopens (`confirmDisable`). The extras exist whether or not the module is on, so the dialog is
 * ready the moment the owner flips the switch.
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

  // The limits sheet exists only while `social` is on, and opens with the values the API holds.
  const socialOn = enabled.get('social') === true;
  const socialSettings = socialOn ? await getSocialSettings(id) : null;

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
      ...(socialSettings
        ? {
            trailing: (
              <SocialLimitsSheet
                tenantId={id}
                saved={socialSettings}
                action={saveSocialLimitsAction}
                labels={{
                  open: t('social.limits.open'),
                  title: t('social.limits.title'),
                  fields: {
                    photos: t('social.limits.fields.photos'),
                    photoMb: t('social.limits.fields.photoMb'),
                    allowVideo: t('social.limits.fields.allowVideo'),
                    videoSeconds: t('social.limits.fields.videoSeconds'),
                    videoMb: t('social.limits.fields.videoMb'),
                  },
                  hint: t.raw('social.limits.hint'),
                  helper: t('social.limits.helper'),
                  save: t('social.limits.save'),
                  saving: t('social.limits.saving'),
                  saved: t('social.limits.saved'),
                  range: t.raw('social.limits.range'),
                  error: t('toasts.error'),
                }}
              />
            ),
          }
        : {}),
    },
    // 09.1-16 (UI-D-527, D-501, A-UI-6): `payments` requires nothing, so there is no lock and enabling is
    // silent. The store-off note explains what the module still does; disabling reopens the wall, so it
    // confirms in the danger tone, naming the tenant and what reopens.
    payments: {
      ...(enabled.get('store') ? {} : { note: tp('payments.noStoreNote') }),
      confirmDisable: {
        title: tp('payments.disableDialog.title', { tenant: detail.tenant.displayName }),
        body: tp('payments.disableDialog.body', { tenant: detail.tenant.displayName }),
        confirm: tp('payments.disableDialog.confirm'),
        cancel: tp('payments.disableDialog.cancel'),
        icon: 'credit-card',
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
