import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

// Neutral TRIA chrome for the public auth pages: centered column, no tenant branding (Phase 2).
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('common');
  return (
    <main
      style={{
        maxWidth: 420,
        margin: '0 auto',
        padding: '2rem 1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
      }}
    >
      <p style={{ fontWeight: 700, letterSpacing: '0.1em' }}>{t('appName')}</p>
      {children}
    </main>
  );
}
