import type { PlatformTenantDetail } from '@rede-social/contracts';
import {
  type BrandColors,
  type BrandIconUrls,
  type ContrastReport,
  iconsUpToDate,
  resolveBranding,
} from '@rede-social/contracts/branding';

/**
 * What the Marca tab renders (02-14): the tenant's brand as the panel needs it — every gap of the
 * stored jsonb filled by `resolveBranding`, plus two derived facts the form's states hinge on:
 * `hasSource` (a logo or a square override exists → the app-icons card is shown) and `iconsReady`
 * (the persisted icon set belongs to the CURRENT `iconVersion` → "Ícones gerados", otherwise the
 * honest "Ícones sendo gerados…" while the worker runs, D-28).
 */
export type BrandingView = {
  displayName: string;
  logoUrl: string | null;
  iconUrl: string | null;
  faviconUrl: string | null;
  iconUrls: BrandIconUrls | null;
  iconVersion: number;
  iconsReady: boolean;
  hasSource: boolean;
  colors: BrandColors;
  contrast: ContrastReport;
};

/**
 * What the mapper reads: the three brand facts. The platform detail (`/v1/platform/tenants/{id}`)
 * and the tenant lane's `adminBrandingSchema` answer (`/v1/admin/branding`, 08-06) both carry them, so
 * ONE mapper feeds the same `BrandingForm` on both lanes (D-342).
 */
export type BrandingSource = {
  tenant: Pick<PlatformTenantDetail['tenant'], 'displayName' | 'branding' | 'contrast'>;
};

/** Pure mapper: the platform detail or the admin brand answer → the Marca screen's view. */
export function toBrandingView(detail: BrandingSource): BrandingView {
  const branding = resolveBranding(detail.tenant.branding);
  return {
    displayName: detail.tenant.displayName,
    logoUrl: branding.logoUrl,
    iconUrl: branding.iconUrl,
    faviconUrl: branding.faviconUrl,
    iconUrls: branding.iconUrls,
    iconVersion: branding.iconVersion,
    iconsReady: iconsUpToDate(branding),
    hasSource: branding.logoUrl !== null || branding.iconUrl !== null,
    colors: branding.colors,
    contrast: detail.tenant.contrast,
  };
}
