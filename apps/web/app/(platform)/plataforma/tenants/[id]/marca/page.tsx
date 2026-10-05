import { THEME_COOKIE } from '@rede-social/contracts/branding';
import { cookies } from 'next/headers';
import { getTranslations } from 'next-intl/server';
import { BrandingForm } from '@/components/platform/BrandingForm';
import { BrandLookForm, BrandLookProvider } from '@/components/platform/BrandLookEditor';
import { TenantPreviewProvider } from '@/components/platform/preview/TenantPreviewProvider';
import { brandingViewKey, brandLookKey, toBrandingView } from '@/lib/branding-view';
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
 * Marca tab (02-14, ROLE-03, D-31 — mockup `tenant-page-marca`): the tenant's logo / square icon,
 * colours with the live light/dark `BrandPreview` and the both-modes contrast readout, and the
 * app-icons card with the honest derivation status. The page re-proves the authorisation first
 * (`requirePlatformTenantDetail`, React-cached with the layout's call), maps the strict detail to the
 * `BrandingView` and mounts the client form, keyed by `brandingViewKey` (a refreshed server view
 * remounts it with fresh state). No cache directive: every read is per request.
 *
 * The look beyond the pair (2026-10-03): the wizard's own cards, right after the colours card
 * (`BrandLookForm`), with their state in `BrandLookProvider` around the whole tab, keyed by the SAVED
 * look alone (`brandLookKey`), so the colours card's frames show the look being edited and a pair
 * save never loses it. The cards turn a preview theme as in the wizard (`TenantPreviewProvider`,
 * here with no phone: the title font's sample follows it), starting in the panel's own theme.
 */
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
      <BrandLookProvider
        key={brandLookKey(view)}
        tenantId={id}
        view={view}
        save={saveBrandLookAction}
      >
        <BrandingForm
          key={brandingViewKey(view)}
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
    </TenantPreviewProvider>
  );
}
