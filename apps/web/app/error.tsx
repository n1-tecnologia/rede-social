'use client';

import { Button, EmptyState } from '@rede-social/ui';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * Root error boundary (UI consideration E01/E03 error): a non-redirecting failure in a nested layout
 * — e.g. the tenant bootstrap failing after login — renders this neutral-token page instead of a
 * half-branded shell. Strings come from the catalog through `NextIntlClientProvider`; no brand, no
 * tenant name, no literals.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('app');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[var(--screen-h)] w-full max-w-sm flex-col justify-center px-4">
      <EmptyState
        icon={TriangleAlert}
        title={t('error.title')}
        body={t('error.body')}
        action={
          <Button variant="outline" onClick={reset}>
            {t('error.retry')}
          </Button>
        }
      />
    </main>
  );
}
