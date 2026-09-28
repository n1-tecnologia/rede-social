import { brandStyleVars } from '@rede-social/contracts';
import type { Metadata, Viewport } from 'next';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getHostBrand } from '@/lib/host-brand';
import { AuthBrand } from './AuthBrand';

/**
 * Public pages, branded per HOST before any session exists (TENANT-02, roadmap criterion 1, UI-SPEC
 * Auth Pages Contract): the five `--brand-*` variables sit on `<main>` and the tenant's logo (or its
 * display name, D-26) is server-rendered on the first HTML, so there is no default-brand flash
 * (Pitfall 2). Platform and generic hosts keep the neutral platform wordmark and the neutral variables.
 *
 * Only token utilities are used (D-41 consumer): under `<html data-theme="dark">` the ground becomes
 * the dark `--theme-bg` and the brand CTA switches to `--brand-primary-dark` without any change here.
 *
 * The "Comunidade: {tenant}" line is NOT rendered by the layout: it belongs to `/entrar` only, so the
 * host tenant's name never enters `/endereco-invalido`'s body text (D-23 contract).
 */
export async function generateMetadata(): Promise<Metadata> {
  const [tc, brand] = await Promise.all([getTranslations('common'), getHostBrand()]);
  return { title: brand.tenant?.displayName ?? tc('appName') };
}

// No `maximumScale` / `userScalable`: pinch-zoom stays available (WCAG 1.4.4, UI-SPEC).
export async function generateViewport(): Promise<Viewport> {
  const brand = await getHostBrand();
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: brand.branding.colors.primary,
  };
}

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const [tc, brand] = await Promise.all([getTranslations('common'), getHostBrand()]);

  return (
    <main
      style={brandStyleVars(brand.branding)}
      className="flex min-h-[var(--screen-h)] flex-col items-center justify-center bg-bg p-4"
    >
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <header className="flex w-full flex-col items-center gap-3">
          <AuthBrand
            logoUrl={brand.tenant ? brand.branding.logoUrl : null}
            displayName={brand.tenant?.displayName ?? tc('appName')}
          />
        </header>
        <div className="flex w-full flex-col gap-6">{children}</div>
      </div>
    </main>
  );
}
