import { PageHeader } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { ConversationsSkeleton } from './ConversationsList';

/**
 * `/conversas` loading (UI-D-863, UC E1 loading): the shipped header renders AT ONCE with its back control and title,
 * then THREE skeleton rows at the row's own geometry (a 40px circle, two bars, the time bar) in the same 680px
 * column, `aria-busy`, so the swap to the rows moves nothing. The skeleton is the list's own, shared with the
 * retry after a failed first read and the load-more sentinel.
 */
export default async function ConversationsLoading() {
  const t = await getTranslations('chat');
  return (
    <div aria-busy data-conversations-loading>
      <PageHeader
        title={t('conversations.title')}
        backHref="/inicio"
        backLabel={t('member.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <div className="mx-auto w-full max-w-[680px]">
        <ConversationsSkeleton count={3} />
      </div>
    </div>
  );
}
