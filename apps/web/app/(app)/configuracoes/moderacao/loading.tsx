import { PageHeader, Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { ModerationLogSkeleton } from '@/components/admin/ModerationLogRow';

/**
 * `/configuracoes/moderacao/loading.tsx` (UI-D-283, UI E09/loading): the `PageHeader` bar, the
 * permanence line, the chip row's SHAPE (five pill placeholders — the chosen filter is only known
 * once the page itself has rendered, so no chip is drawn as selected) and 6 row skeletons with the
 * excerpt block on alternate rows, in the page's own geometry so nothing shifts when page 1 swaps in.
 */
export default async function ModerationLogLoading() {
  const t = await getTranslations('moderation.log');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <div>
        <p className="px-4 text-xs font-normal text-text-tertiary md:px-0">{t('permanent')}</p>
        <div aria-hidden className="mt-3 flex gap-2 overflow-x-auto px-4 md:px-0">
          {[48, 104, 88, 112, 64].map((width) => (
            <Skeleton
              key={width}
              variant="rect"
              width={width}
              className="h-7 shrink-0 rounded-full"
            />
          ))}
        </div>
      </div>
      <ModerationLogSkeleton count={6} />
    </div>
  );
}
