'use client';

import { Button, EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect } from 'react';

/**
 * `/conversas` segment error boundary (UI-D-863, UC E1 error): an UNEXPECTED failure of the route (a failed read is
 * the list's own card, drawn by `ConversationsList`, and a refusal redirects) renders the header and the same card
 * the list uses, "Não foi possível carregar suas conversas." with "Tentar novamente", and NEVER the support row
 * (a failed read draws none). Only the digest is logged, never a message or a name. Next 16.3's `retry` re-fetches
 * and re-renders the segment's children.
 */
export default function ConversationsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations('chat');

  useEffect(() => {
    console.error('chat.conversations_segment_error', { digest: error.digest });
  }, [error]);

  return (
    <div data-conversations-page>
      <PageHeader
        title={t('conversations.title')}
        backHref="/inicio"
        backLabel={t('member.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <div className="mx-auto w-full max-w-[680px] px-4 pt-4">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-conversations-error
          title={t('conversations.error.title')}
          body={t('conversations.error.body')}
          action={
            <Button variant="outline" onClick={retry}>
              {t('conversations.error.retry')}
            </Button>
          }
        />
      </div>
    </div>
  );
}
