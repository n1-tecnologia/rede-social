'use client';

import { Button, EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * `/configuracoes/denuncias` segment error boundary (UI-D-878, UI E09/error): an UNEXPECTED failure of the route (a
 * failed read is the queue's own card, drawn by `ReportsQueue`, and a refusal redirects or answers `notFound()`)
 * renders the header and the shipped card with "Tentar novamente". Only the digest is logged, never a name or a
 * reported text. Next 16.3's `retry` re-fetches and re-renders the segment's children.
 */
export default function ReportsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const ts = useTranslations('safety');
  const ta = useTranslations('app');
  const tl = useTranslations('moderation.log');

  useEffect(() => {
    console.error('reports.queue_segment_error', { digest: error.digest });
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={ts('queue.title')}
        backHref="/configuracoes"
        backLabel={ta('settings.back')}
        className="md:static md:px-0"
      />
      <div className="px-4 md:px-0">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-reports-error
          title={tl('errors.title')}
          body={tl('errors.generic')}
          action={
            <Button variant="outline" onClick={retry}>
              {tl('errors.retry')}
            </Button>
          }
        />
      </div>
    </div>
  );
}
