import { PageHeader, Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { CaseCardSkeleton } from './CaseCard';

/**
 * `/suporte/chamados` loading (UI-D-832, UC M13 loading): the shipped header with its back control and
 * title, the "Chamado atual" section-title bar and THREE card skeletons at the new card's geometry, so
 * the swap to the cards does not move anything.
 */
export default async function MyCasesLoading() {
  const t = await getTranslations('chat');
  return (
    <div aria-busy data-my-cases-loading>
      <PageHeader title={t('mine.title')} backHref="/suporte" backLabel={t('member.back')} />
      <div className="flex flex-col gap-2 px-4 pb-6 pt-2">
        <Skeleton variant="text" width={112} className="h-3" />
        <CaseCardSkeleton count={3} />
      </div>
    </div>
  );
}
