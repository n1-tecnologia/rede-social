import { getTranslations } from 'next-intl/server';
import { EventsSkeleton } from './EventsSections';

/**
 * `/eventos/loading.tsx` (UI-D-216, UI E02/loading): the two galleries' headers and two poster
 * skeletons each, in the page's own geometry so nothing shifts when the cards swap in.
 */
export default async function EventsLoading() {
  const t = await getTranslations('events');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <h1 className="sr-only">{t('list.title')}</h1>
      <EventsSkeleton
        headers={[
          { title: t('sections.mine.title'), subtitle: t('sections.mine.subtitle') },
          { title: t('sections.others.title'), subtitle: t('sections.others.subtitle') },
        ]}
      />
    </div>
  );
}
