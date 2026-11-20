import { PageHeader, Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { ReportsQueueSkeleton } from './ReportsQueue';

/**
 * `/configuracoes/denuncias/loading.tsx` (UI-D-878, UI E09/loading): the `PageHeader` bar, the three chips' SHAPE (the
 * chosen filter is only known once the page has rendered, so none is drawn as selected) and four row skeletons at the
 * queue's own geometry, the second with the 56px player bar of a voice row, so nothing shifts when page 1 swaps in.
 * "Ver conteúdo" is never drawn while loading.
 */
export default async function ReportsLoading() {
  const [ts, ta] = await Promise.all([getTranslations('safety'), getTranslations('app')]);
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={ts('queue.title')}
        backHref="/configuracoes"
        backLabel={ta('settings.back')}
        className="md:static md:px-0"
      />
      <div
        aria-hidden
        className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {[84, 96, 64].map((width) => (
          <Skeleton
            key={width}
            variant="rect"
            width={width}
            className="h-7 shrink-0 rounded-full"
          />
        ))}
      </div>
      <ReportsQueueSkeleton count={4} />
    </div>
  );
}
