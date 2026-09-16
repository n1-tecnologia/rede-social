import { THEME_COOKIE } from '@tria/contracts/branding';
import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import './globals.css';

// Manrope is the design system's only typeface; the variable feeds `--font-sans` in tokens.css.
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });

// Neutral TRIA chrome. Tenant branding (logo, colors, manifest) is applied by the (auth)/(app)
// layouts (TENANT-02); the service worker and per-tenant metadata are wired by 02-11.
export const metadata: Metadata = {
  title: 'TRIA',
  description: 'Comunidade TRIA',
};

/**
 * D-41: the theme is rendered on the FIRST HTML from the per-device `tria_theme` cookie, so there is
 * no light flash before hydration (Pitfall 2). Strict allow-list (T-02-30): only the literal `dark`
 * selects dark; any other value — absent, tampered, stale — renders light and is never echoed.
 * Reading `cookies()` here makes every route dynamic, which is intended (RESEARCH Pattern 11).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  return (
    <html lang="pt-BR" data-theme={theme} className={manrope.variable} suppressHydrationWarning>
      <body className="bg-bg font-sans text-text antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
