import { NEUTRAL_BRAND, THEME_COOKIE } from '@rede-social/contracts/branding';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import { InstallGate } from '@/components/pwa/InstallGate';
import { OfflineBanner } from '@/components/pwa/OfflineBanner';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { brandScope } from '@/lib/brand-scope';
import { env } from '@/lib/env';
import { getHostBrand } from '@/lib/host-brand';
import { LINK_RETURN_COOKIE, parseLinkReturn } from '@/lib/link-return';
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
 *
 * Install gate (quick 261007-kyp): when `INSTALL_GATE` is on, the app's children sit inside
 * `InstallGate`, which swaps them for the full-screen install screen on phones and tablets outside
 * the installed app. The server never gates (it cannot know the device): `<html>` carries
 * `data-install-gate="pending"` until the client decides (globals.css hides the body meanwhile on
 * coarse-pointer browsers), and the gate takes its brand from the host exactly like `(auth)/layout`.
 * The `link_return` cookie `/auth/confirm` writes after a mail link is read here (strict allow-list)
 * and handed to the gate, which shows "abra o app pelo ícone" for it.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const theme = cookieStore.get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const gateEnabled = env.INSTALL_GATE === 'on';
  const brand = gateEnabled ? await getHostBrand() : null;
  const scope = brand ? brandScope(brand.branding) : null;
  return (
    <html
      lang="pt-BR"
      data-theme={theme}
      {...(gateEnabled ? { 'data-install-gate': 'pending' } : {})}
      className={manrope.variable}
      suppressHydrationWarning
    >
      <body className="bg-bg font-sans text-text antialiased">
        <ServiceWorkerRegister />
        <NextIntlClientProvider>
          <OfflineBanner />
          <InstallGate
            enabled={gateEnabled}
            brand={{
              displayName: brand?.tenant?.displayName ?? NEUTRAL_DISPLAY_NAME,
              logoUrl: brand?.tenant ? brand.branding.logoUrl : null,
            }}
            brandStyle={scope?.style ?? {}}
            brandAttributes={scope?.attributes ?? {}}
            linkReturn={
              gateEnabled ? parseLinkReturn(cookieStore.get(LINK_RETURN_COOKIE)?.value) : null
            }
          >
            {children}
          </InstallGate>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
