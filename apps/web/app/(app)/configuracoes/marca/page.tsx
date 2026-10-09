import { type AdminBranding, adminBrandingSchema } from '@rede-social/contracts/branding';
import { KERNEL_PERMISSIONS } from '@rede-social/contracts/moderation';
import { PageHeader } from '@rede-social/ui';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DisplayNameCard } from '@/components/admin/DisplayNameCard';
import { BrandingForm } from '@/components/platform/BrandingForm';
import { apiFetch } from '@/lib/api';
import { ApiClientError, bootstrapRedirectPath, requireBootstrap } from '@/lib/bootstrap';
import { toBrandingView } from '@/lib/branding-view';
import { getHostTenant } from '@/lib/tenant-host';
import {
  completeBrandingUploadAction,
  getBrandingStatusAction,
  removeIconOverrideAction,
  saveBrandColorsAction,
  saveDisplayNameAction,
  startBrandingUploadAction,
} from './actions';

/**
 * `GET /v1/admin/branding`, mapped like every admin loader (UI-D-284): session and membership
 * refusals follow the shipped `(app)` navigation, a 403 `FORBIDDEN` (the permission was lost since the
 * bootstrap was read) is `notFound()`, and anything else is a real render error. `redirect` and
 * `notFound` throw, so both sit OUTSIDE the try/catch (Next 16).
 */
async function loadAdminBranding(): Promise<AdminBranding> {
  let path: string | null = null;
  let forbidden = false;
  let failure: unknown = null;
  try {
    const res = await apiFetch('/v1/admin/branding');
    if (res.ok) return adminBrandingSchema.parse(await res.json());
    let code = 'HTTP_ERROR';
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await res.json()) as {
        error?: { code?: string; details?: Record<string, unknown> };
      };
      if (typeof body?.error?.code === 'string') code = body.error.code;
      details = body?.error?.details;
    } catch {
      // A non-JSON body keeps the generic code.
    }
    failure = new ApiClientError(res.status, code, details);
  } catch (error) {
    failure = error;
  }
  if (failure instanceof ApiClientError) {
    path = bootstrapRedirectPath(failure);
    forbidden = failure.status === 403 && failure.code === 'FORBIDDEN';
  }
  if (path) redirect(path);
  if (forbidden) notFound();
  throw failure;
}

/**
 * The form is keyed on the tenant alone, as on the platform page (08-02, WINDOWS #71): a refreshed
 * view — the icon poll's `router.refresh()`, an action's `revalidatePath`, a saved display name — is
 * adopted by `BrandingForm` in place (its `applyView` rule), so a colour being typed survives it and
 * the preview still follows the new name. Keying on the name as well would remount the form on every
 * name save and drop that colour.
 */
function formKey(tenantId: string): string {
  return tenantId;
}

/**
 * `/configuracoes/marca` (ADMIN-01, D-339, D-342, UI-D-270, UI-D-279) — the admin edits their own
 * community's brand with the super_admin's editor, unchanged. Top to bottom: the freshness note (the
 * shell shows a change on the next request; the login screen and the installed manifest go through
 * the 60 s host cache), the name card (`DisplayNameCard`, `BrandingForm` has no name field), then the
 * same `BrandingForm` (assets, colours with the live light/dark `BrandPreview` and `ContrastFeedback`,
 * the derived icons) with all five tenant-lane actions, none of which sends a tenant id.
 *
 * **`notFound()`, never a 403 screen** (UI-D-270): without `tenant.manage` in `bootstrap.permissions`
 * — the SAME composed value the API's `requirePermission` reads — and on the platform host. No cache
 * directive: every read is per request.
 */
export default async function AdminBrandPage() {
  const hostTenant = await getHostTenant();
  if (hostTenant.mode === 'platform') notFound();

  const bootstrap = await requireBootstrap();
  if (!bootstrap.permissions.includes(KERNEL_PERMISSIONS.tenantManage)) notFound();

  const [t, tb, brand] = await Promise.all([
    getTranslations('admin'),
    getTranslations('platformBranding'),
    loadAdminBranding(),
  ]);
  const view = toBrandingView(brand);
  const tenantId = bootstrap.tenant.id;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('brand.title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <p className="px-4 text-xs text-text-tertiary md:px-0">{t('brand.freshness')}</p>
      <DisplayNameCard initialName={view.displayName} action={saveDisplayNameAction} />
      <BrandingForm
        key={formKey(tenantId)}
        tenantId={tenantId}
        view={view}
        previewLabels={{
          light: tb('preview.light'),
          dark: tb('preview.dark'),
          lightAria: tb('preview.lightAria'),
          darkAria: tb('preview.darkAria'),
          login: tb('preview.login'),
        }}
        actions={{
          saveColors: saveBrandColorsAction,
          status: getBrandingStatusAction,
          start: startBrandingUploadAction,
          complete: completeBrandingUploadAction,
          removeIcon: removeIconOverrideAction,
        }}
      />
    </div>
  );
}
