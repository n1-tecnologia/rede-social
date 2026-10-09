import { PageHeader, Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { AdminMemberSkeleton } from '@/components/admin/AdminMemberRow';

/**
 * `/configuracoes/membros/loading.tsx` (UI-D-283, UI E02/loading): the `PageHeader` bar, the
 * toolbar's SHAPE (the search pill and four chip placeholders — the chosen filter is only known once
 * the page itself has rendered, so no chip is drawn as selected) and 8 row skeletons, in the page's
 * own geometry so nothing shifts when page 1 swaps in.
 */
export default async function AdminMembersLoading() {
  const t = await getTranslations('admin');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('members.title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <div className="flex flex-col gap-2">
        <div aria-hidden className="px-4 pt-2 pb-3 md:px-0">
          <Skeleton variant="rect" className="h-11 w-full rounded-full" />
          <div className="mt-3 flex gap-2 overflow-x-auto">
            {[56, 56, 88, 88].map((width, index) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
                key={index}
                variant="rect"
                width={width}
                className="h-7 shrink-0 rounded-full"
              />
            ))}
          </div>
        </div>
        <AdminMemberSkeleton count={8} />
      </div>
    </div>
  );
}
