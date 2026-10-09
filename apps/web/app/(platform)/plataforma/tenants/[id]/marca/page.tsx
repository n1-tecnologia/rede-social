import { THEME_COOKIE } from '@rede-social/contracts/branding';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { BrandingForm } from '@/components/platform/BrandingForm';
import { BrandLookForm, BrandLookProvider } from '@/components/platform/BrandLookEditor';
import { DarkLogoProvider } from '@/components/platform/DarkLogoDraft';
import { TenantPreviewProvider } from '@/components/platform/preview/TenantPreviewProvider';
import { brandLookKey, toBrandingView } from '@/lib/branding-view';
import { requirePlatformTenantDetail } from '@/lib/platform';
import {
  completeBrandingUploadAction,
  getBrandingStatusAction,
  removeIconOverrideAction,
  saveBrandColorsAction,
  saveBrandLookAction,
  startBrandingUploadAction,
} from './actions';

/**
 * Marca tab (02-14, ROLE-03, D-31 — mockup `tenant-page-marca`): the tenant's logo / app icon (the
 * square override, composed by `AppIconEditor` since 2026-10-09), the colours with the live
 * light/dark `BrandPreview` and the both-modes contrast readout, and the
 * app-icons card with the honest derivation status. The page re-proves the authorisation first
 * (`requirePlatformTenantDetail`, React-cached with the layout's call), maps the strict detail to the
 * `BrandingView` and mounts the client form, keyed on the tenant alone (`formKey`: a refreshed server view
 * is adopted in place, never remounted). No cache directive: every read is per request.
 *
 * The look beyond the pair (2026-10-03): the wizard's own cards, right after the colours card
 * (`BrandLookForm`), with their state in `BrandLookProvider` around the whole tab, keyed by the SAVED
 * look alone (`brandLookKey`), so the colours card's frames show the look being edited and a pair
 * save never loses it. The cards turn a preview theme as in the wizard (`TenantPreviewProvider`,
 * here with no phone: the title font's sample follows it), starting in the panel's own theme.
 *
 * The dark mode's logo (2026-10-05) is picked for the previews only (`DarkLogoProvider`, outside
 * both keyed providers so a save or an upload never drops it): the API has no field for it.
 */

/**
 * The form is keyed on the tenant alone (08-02, WINDOWS #71). It used to be keyed on the whole view
 * (icon version, icons ready, logo/icon URLs, colours), so the poll's `router.refresh()` once the
 * icons were ready, and every action's `revalidatePath`, remounted it: a colour typed while the
 * refresh was in flight was dropped and "Salvar alterações" came back disabled (07-15 desktop red).
 * Keying on the persisted colours too would bring the same remount back one save later, because the
 * refresh after a colour save carries the new colours. A refreshed view is adopted by the form in
 * place instead (`BrandingForm`, the `applyView` rule: follow the server colours only when the user
 * has not touched them).
 */
function formKey(tenantId: string): string {
  return tenantId;
}

export default async function TenantBrandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, t, jar] = await Promise.all([
    requirePlatformTenantDetail(id),
    getTranslations('platformBranding'),
    cookies(),
  ]);
  const view = toBrandingView(detail);
  const theme = jar.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';

  return (
    <TenantPreviewProvider initialTheme={theme}>
      <DarkLogoProvider>
        <BrandLookProvider
          key={brandLookKey(view)}
          tenantId={id}
          view={view}
          save={saveBrandLookAction}
        >
          <BrandingForm
            key={formKey(id)}
            tenantId={id}
            view={view}
            previewLabels={{
              light: t('preview.light'),
              dark: t('preview.dark'),
              lightAria: t('preview.lightAria'),
              darkAria: t('preview.darkAria'),
              login: t('preview.login'),
            }}
            actions={{
              saveColors: saveBrandColorsAction,
              status: getBrandingStatusAction,
              start: startBrandingUploadAction,
              complete: completeBrandingUploadAction,
              removeIcon: removeIconOverrideAction,
            }}
            lookSlot={<BrandLookForm />}
          />
        </BrandLookProvider>
      </DarkLogoProvider>
    </TenantPreviewProvider>
  );
}
