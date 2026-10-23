'use client';

import { buttonClasses, EmptyState } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * Banco tab error boundary (09.2-19, UI-D-544): a failed read of the tenant's database that is not a
 * refusal (those redirect) renders the card `EmptyState` "Algo deu errado" with the outline
 * "Tentar novamente" LINK to the tab's own URL - a route is a link (UI-D-545) - while the tenant
 * frame and the six tabs, which live in the layout, stay usable. Only the digest is logged: the
 * error's own message could quote the API's text.
 */
export default function TenantDatabaseError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('platform.database.errors');
  const pathname = usePathname();

  useEffect(() => {
    console.error('platform.database.segment_error', { digest: error.digest });
  }, [error]);

  return (
    <EmptyState
      variant="card"
      icon={CircleAlert}
      title={t('title')}
      body={t('load')}
      action={
        <Link
          href={pathname}
          onClick={() => reset()}
          className={buttonClasses({ variant: 'outline' })}
        >
          {t('retry')}
        </Link>
      }
    />
  );
}
