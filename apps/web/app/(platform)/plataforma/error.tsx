'use client';

import { Button, EmptyState } from '@rede-social/ui';
import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * Segment error boundary of the panel (E10/error): a failed list or detail fetch that is not a
 * refusal (those redirect) renders "Algo deu errado. Tente novamente." with the outline retry that
 * calls `reset()`. Only the digest is logged.
 */
export default function PlatformError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('platform');

  useEffect(() => {
    console.error('platform.segment_error', { digest: error.digest });
  }, [error]);

  return (
    <EmptyState
      variant="card"
      icon={TriangleAlert}
      title={t('errors.generic')}
      action={
        <Button variant="outline" onClick={reset}>
          {t('errors.retry')}
        </Button>
      }
    />
  );
}
