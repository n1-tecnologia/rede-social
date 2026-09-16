import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import './globals.css';

// Manrope is the design system's only typeface; the variable feeds `--font-sans` in tokens.css.
const manrope = Manrope({ subsets: ['latin'], variable: '--font-manrope', display: 'swap' });

// Neutral TRIA chrome. Tenant branding (logo, colors, manifest) is applied by the (auth)/(app)
// layouts (TENANT-02); the theme cookie and the service worker are wired by later plans.
export const metadata: Metadata = {
  title: 'TRIA',
  description: 'Comunidade TRIA',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={manrope.variable}>
      <body className="bg-bg font-sans text-text antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
