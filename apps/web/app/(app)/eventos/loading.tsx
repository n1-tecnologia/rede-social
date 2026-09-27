import { Chip } from '@tria/ui';
import { getTranslations } from 'next-intl/server';
import { EventsSkeleton } from './EventsList';

/**
 * `/eventos/loading.tsx` (UI-D-216, UI E02/loading): the title row, the two chips and two poster
 * skeletons, in the page's own geometry so nothing shifts when page 1 swaps in. The chips render
 * idle (no `aria-current`): the chosen period is only known once the page itself has rendered.
 */
export default async function EventsLoading() {
  const t = await getTranslations('events');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <div className="px-4 pt-4 pb-3">
        <h1 className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text">
          {t('list.title')}
        </h1>
        <p className="mt-1 text-sm font-normal text-text-secondary">{t('list.subtitle')}</p>
      </div>
      <nav aria-label={t('list.filter.label')} className="flex gap-2 px-4 pb-3">
        <Chip href="/eventos">{t('list.filter.upcoming')}</Chip>
        <Chip href="/eventos?periodo=passados">{t('list.filter.past')}</Chip>
      </nav>
      <EventsSkeleton />
    </div>
  );
}
