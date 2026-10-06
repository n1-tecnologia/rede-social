import { REAL_TENANT_DEFAULT_MODULES } from '@rede-social/contracts';
import { NEUTRAL_BRAND, THEME_COOKIE } from '@rede-social/contracts/branding';
import { ChevronLeft } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { TenantPreviewPanel } from '@/components/platform/preview/TenantPreviewPanel';
import { TenantPreviewProvider } from '@/components/platform/preview/TenantPreviewProvider';
import { WizardSteps } from '@/components/platform/WizardSteps';
import { TenantDraftProvider } from '@/components/platform/wizard/TenantDraftProvider';

/**
 * The tenant wizard frame: header (the tenant page's pattern, not sticky) and step row on the left
 * above the current step, the live app preview (`TenantPreviewPanel`, the phone device) on the right.
 *
 * Every step is a child of THIS layout — `/plataforma/novo` (Dados), `/plataforma/novo/marca`,
 * `/dominio` and `/resumo` before the tenant exists, then `/plataforma/novo/{id}/convite` — and App
 * Router layouts persist across navigations between their children: the draft
 * (`TenantDraftProvider`: everything typed and the picked files, sent only by the summary's
 * confirmation) survives every step change, back and forth, and the device keeps its place and its
 * DOM node, fed through `TenantPreviewProvider`. Steps navigate with `next/link` / the router only;
 * an `<a>` would reload the document and drop the picked files. `novo/error.tsx` and
 * `novo/not-found.tsx` render inside this layout for the same reason.
 *
 * `data-tenant-wizard` reserves the document's scrollbar gutter (`tokens.css`): the long creation
 * form scrolls and the shorter steps do not, and a classic scrollbar coming and going would shift
 * the centred content, the device included, sideways.
 *
 * The device starts in the panel's own theme (the same strict cookie read as the panel layout) and
 * with the creation form's defaults, and shows from `xl` up: below that the column is too narrow for
 * a phone beside the form, and the form's own light/dark `BrandPreview` frames stand in for it (they
 * hide from `xl` up, where the phone is the preview).
 */
export default async function NewTenantLayout({ children }: { children: ReactNode }) {
  const [t, jar] = await Promise.all([getTranslations('platform'), cookies()]);
  const theme = jar.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const initialTenant = {
    displayName: '',
    colors: { primary: NEUTRAL_BRAND.primary, secondary: NEUTRAL_BRAND.secondary },
    logoUrl: null,
    modules: [...REAL_TENANT_DEFAULT_MODULES],
  };

  return (
    <TenantPreviewProvider initialTheme={theme} initialTenant={initialTenant}>
      <TenantDraftProvider moduleKeys={REAL_TENANT_DEFAULT_MODULES}>
        <div
          data-tenant-wizard
          className="flex flex-col gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start xl:gap-8"
        >
          <div className="flex min-w-0 flex-col gap-4">
            {/* The tenant page's header pattern (back + "Tenants" crumb, then the title), in the flow
              of the page: the app's sticky `PageHeader` would float over the long form here. */}
            <div className="flex flex-col">
              <div className="-mx-2 flex items-center gap-1">
                <Link
                  href="/plataforma"
                  aria-label={t('new.back')}
                  className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  <ChevronLeft aria-hidden size={22} />
                </Link>
                <span className="text-base text-text-tertiary">{t('nav.tenants')}</span>
              </div>
              <h1 className="mt-2 text-2xl font-bold tracking-[-0.02em] text-text">
                {t('new.title')}
              </h1>
            </div>
            <WizardSteps />
            {children}
          </div>
          <TenantPreviewPanel className="hidden xl:sticky xl:top-12 xl:flex" />
        </div>
      </TenantDraftProvider>
    </TenantPreviewProvider>
  );
}
