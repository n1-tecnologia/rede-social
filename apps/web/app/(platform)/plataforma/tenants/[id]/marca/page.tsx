import { getTranslations } from 'next-intl/server';
import { BrandingForm } from '@/components/platform/BrandingForm';
import { type BrandingView, toBrandingView } from '@/lib/branding-view';
import { requirePlatformTenantDetail } from '@/lib/platform';
import { getBrandingStatusAction, saveBrandColorsAction } from './actions';

/**
 * Marca tab (02-14, ROLE-03, D-31 — mockup `tenant-page-marca`): the tenant's logo / square icon,
 * colours with the live light/dark `BrandPreview` and the both-modes contrast readout, and the
 * app-icons card with the honest derivation status. The page re-proves the authorisation first
 * (`requirePlatformTenantDetail`, React-cached with the layout's call), maps the strict detail to the
 * `BrandingView` and mounts the client form. No cache directive: every read is per request.
 */

/** A refreshed server view remounts the form with fresh state — no effect-driven state sync. */
function formKey(view: BrandingView): string {
  return [
    view.iconVersion,
    view.iconsReady,
    view.logoUrl,
    view.iconUrl,
    view.colors.primary,
    view.colors.secondary,
  ].join('|');
}

export default async function TenantBrandingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  const view = toBrandingView(detail);
  const t = await getTranslations('platformBranding');

  return (
    <BrandingForm
      key={formKey(view)}
      tenantId={id}
      view={view}
      previewLabels={{
        light: t('preview.light'),
        dark: t('preview.dark'),
        lightAria: t('preview.lightAria'),
        darkAria: t('preview.darkAria'),
        login: t('preview.login'),
      }}
      actions={{ saveColors: saveBrandColorsAction, status: getBrandingStatusAction }}
    />
  );
}
