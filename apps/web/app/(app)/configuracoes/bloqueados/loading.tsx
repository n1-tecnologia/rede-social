import { PageHeader, Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';

/**
 * `/configuracoes/bloqueados/loading.tsx` (UI-D-635): the `PageHeader` bar and four row skeletons in the list's own
 * geometry (a 40px circle, a name line and the outline button's shape), so nothing shifts when page 1 swaps in.
 */
export default async function BlockedLoading() {
  const [t, ta] = await Promise.all([getTranslations('safety.blocked'), getTranslations('app')]);
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('title')}
        backHref="/configuracoes"
        backLabel={ta('settings.back')}
        className="md:static md:px-0"
      />
      <div aria-hidden data-testid="blocked-skeleton" className="flex flex-col">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-3 px-4 py-3 md:px-0">
            <Skeleton variant="circle" className="h-10 w-10 shrink-0" />
            <Skeleton variant="text" width="45%" className="h-4" />
            <Skeleton variant="rect" width={104} className="ml-auto h-9 shrink-0 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
