import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';

// Neutral TRIA chrome. Tenant branding (logo, colors, manifest) is Phase 2 (TENANT-02/PWA).
export const metadata: Metadata = {
  title: 'TRIA',
  description: 'Comunidade TRIA',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
