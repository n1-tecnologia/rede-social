import { brandStyleVars } from '@tria/contracts';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getHostBrand } from '@/lib/host-brand';

/**
 * Public auth pages, branded per HOST before any session exists (TENANT-02, roadmap criterion 1):
 * the `--brand-*` variables and the tenant's logo/display name are server-rendered on the first HTML,
 * so there is no default-brand flash (Pitfall 2). Platform and generic hosts keep the neutral TRIA
 * wordmark and the neutral variables.
 *
 * Phase 1 inline styles stay for now — 02-08 ports the prototype visuals; this layout's job is the
 * variables and the identity, not the look.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const [t, brand] = await Promise.all([getTranslations('common'), getHostBrand()]);
  const logoUrl = brand.tenant?.branding.logoUrl ?? null;

  return (
    <main
      style={{
        ...brandStyleVars(brand.branding),
        maxWidth: 420,
        margin: '0 auto',
        padding: '2rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
      }}
    >
      {brand.mode === 'tenant' && brand.displayName ? (
        logoUrl ? (
          // D-26: the logo is rendered as-is (never tinted); the auth pages show it larger than the shell.
          // biome-ignore lint/performance/noImgElement: tenant logos are arbitrary hosts (uploads), next/image would need per-tenant remotePatterns.
          <img
            src={logoUrl}
            alt={brand.displayName}
            style={{ height: 64, maxWidth: '100%', objectFit: 'contain', alignSelf: 'flex-start' }}
          />
        ) : (
          // D-26: without a logo, the display name stands in its place — verbatim, no normalisation.
          <p style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--brand-primary)' }}>
            {brand.displayName}
          </p>
        )
      ) : (
        <p style={{ fontWeight: 700, letterSpacing: '0.1em' }}>{t('appName')}</p>
      )}
      {children}
    </main>
  );
}
