import { type ReactNode, Suspense } from 'react';
import { FlashToast } from '@/components/platform/FlashToast';
import { PreviewSeed } from '@/components/platform/preview/TenantPreviewProvider';
import { lookFieldsOf } from '@/lib/bg-tone';
import { toBrandingView } from '@/lib/branding-view';
import { requirePlatformTenantDetail } from '@/lib/platform';

/**
 * `/plataforma/novo/{id}` — the wizard step after creation (Convite). The tenant
 * detail comes from `requirePlatformTenantDetail` (non-uuid or unknown id → `novo/not-found.tsx`,
 * refusals redirect; React-cached with each step's own call) and is handed to the preview device as
 * the PERSISTED tenant: its name, colours, logo, enabled modules and (2026-10-03) its saved look,
 * re-published whenever a step's action revalidates the route (an uploaded logo shows up in the
 * device). `FlashToast` announces the creation (`?toast=created`) and strips the parameter with a
 * soft replace.
 */
export default async function NewTenantStepsLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;
  const detail = await requirePlatformTenantDetail(id);
  const view = toBrandingView(detail);

  return (
    <>
      <Suspense fallback={null}>
        <FlashToast />
      </Suspense>
      <PreviewSeed
        tenant={{
          displayName: detail.tenant.displayName,
          colors: view.colors,
          logoUrl: view.logoUrl,
          modules: detail.modules.filter((m) => m.enabled).map((m) => m.key),
          ...lookFieldsOf(view.look),
        }}
      />
      {children}
    </>
  );
}
