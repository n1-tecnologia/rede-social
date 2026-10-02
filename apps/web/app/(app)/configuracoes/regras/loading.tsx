import { PageHeader, Skeleton } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';

/**
 * `/configuracoes/regras/loading.tsx` (UI-D-280, UI-D-283): the `PageHeader` bar and one rect skeleton
 * at the Regras card's height — the intro, the 12-row editor with its counter and helper, the version
 * line and the footer buttons (stacked on a phone, one row from `md`) — in the page's 680px column,
 * so nothing shifts when the screen swaps in.
 */
export default async function AdminRulesLoading() {
  const t = await getTranslations('admin');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col gap-4">
      <PageHeader
        title={t('rules.title')}
        backHref="/configuracoes"
        backLabel={t('back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      <div aria-hidden>
        <Skeleton variant="rect" className="h-[34rem] md:h-[30rem]" />
      </div>
    </div>
  );
}
