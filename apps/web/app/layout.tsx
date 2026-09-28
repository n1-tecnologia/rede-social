import { NEUTRAL_BRAND, THEME_COOKIE } from '@rede-social/contracts/branding';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { OfflineBanner } from '@/components/pwa/OfflineBanner';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { env } from '@/lib/env';
import { getHostBrand } from '@/lib/host-brand';
import { iconsFor, manifestPath, NEUTRAL_DISPLAY_NAME, NEUTRAL_ICONS } from '@/lib/manifest';
import './globals.css';

// Manrope is the design system's only typeface; the variable feeds `--font-sans` in tokens.css.
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });

/**
 * PWA metadata per HOST (PWA-01, D-25/D-28): every route — `/entrar` before login included — links
 * the tenant's own manifest, favicon and apple-touch-icon, and names the installed app after the
 * tenant. Platform and generic hosts get the platform's neutral set. Icons come from the same allow-listed
 * set the manifest route serves (`iconsFor`, T-02-72), so head and manifest never disagree.
 */
export async function generateMetadata(): Promise<Metadata> {
  const brand = await getHostBrand();
  const supabaseOrigin = new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;
  const tenant = brand.mode === 'tenant' ? brand.tenant : null;
  const displayName = tenant?.displayName ?? NEUTRAL_DISPLAY_NAME;
  const icons = tenant ? iconsFor(brand.branding, supabaseOrigin) : NEUTRAL_ICONS;
  return {
    title: { default: displayName, template: `%s · ${displayName}` },
    applicationName: displayName,
    description: displayName,
    manifest: manifestPath(tenant?.slug ?? null),
    icons: {
      icon: [{ url: icons.favicon, type: 'image/png' }],
      apple: [{ url: icons.apple180, sizes: '180x180' }],
    },
    appleWebApp: { capable: true, title: displayName, statusBarStyle: 'default' },
    formatDetection: { telephone: false },
  };
}

/**
 * `theme-color` = the brand primary (light value, UI-SPEC §PWA); 02-07's ThemeToggle rewrites the
 * meta to the dark surface at runtime (D-41) — not duplicated here. `viewportFit: 'cover'` feeds the
 * `--safe-*` insets; no `maximumScale` / `userScalable` (pinch-zoom stays available, WCAG 1.4.4).
 */
export async function generateViewport(): Promise<Viewport> {
  const brand = await getHostBrand();
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor:
      brand.mode === 'tenant' && brand.tenant
        ? brand.branding.colors.primary
        : NEUTRAL_BRAND.primary,
  };
}

/**
 * D-41: the theme is rendered on the FIRST HTML from the per-device `rede_theme` cookie, so there is
 * no light flash before hydration (Pitfall 2). Strict allow-list (T-02-30): only the literal `dark`
 * selects dark; any other value — absent, tampered, stale — renders light and is never echoed.
 * Reading `cookies()` here makes every route dynamic, which is intended (RESEARCH Pattern 11).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang="pt-BR" data-theme={theme} className={manrope.variable} suppressHydrationWarning>
      <body className="bg-bg font-sans text-text antialiased">
        <ServiceWorkerRegister />
        <NextIntlClientProvider>
          <OfflineBanner />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
