import { PageHeader, Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';

/**
 * `/configuracoes/marca/loading.tsx` (UI-D-279, UI-D-283): the `PageHeader` bar, the freshness note's
 * line and one rect skeleton per card at its own height — the name card, the assets card (the logo
 * zone and, below it since 2026-10-09, the app icon's closed editor with its home screen preview),
 * the colours card (fields, both preview frames, the CTA) and the derived-icons card — in the page's
 * 680px column, so nothing shifts when the screen swaps in.
 */
export default async function AdminBrandLoading() {
  const t = await getTranslations('admin');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('brand.title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <div aria-hidden className="flex flex-col gap-4">
        <div className="px-4 md:px-0">
          <Skeleton variant="text" className="h-3 w-4/5" />
        </div>
        <Skeleton variant="rect" className="h-56 md:h-60" />
        <div className="flex flex-col gap-6">
          <Skeleton variant="rect" className="h-[50rem] md:h-[47rem]" />
          <Skeleton variant="rect" className="h-[36rem] md:h-[30rem]" />
          <Skeleton variant="rect" className="h-40" />
        </div>
      </div>
    </div>
  );
}
