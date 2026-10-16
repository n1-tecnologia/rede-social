import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { MEMBER_LIVES_HREF } from '@/lib/courses-member-view';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * "Live indisponível" (08.5-09, UI-D-441, planning decision 2): the ONE screen every live miss lands
 * on — an unknown, foreign or crafted id — for the member's live page and the manager's live form
 * alike. A cancelled live is NOT a miss: it keeps its page with the "Cancelada" pill (D-431). The
 * course segment's "Curso indisponível" stays for courses.
 *
 * Takes no props and reads no param, so it cannot echo the id and is never an existence oracle.
 * Sketch 010 frame `live-cancelada-apos-o-fim` (the unknown live): the header back to the Lives tab
 * with the title "Lives", and the alert card with the outline "Ver as lives".
 */
export default async function LiveNotFound() {
  const t = await getTranslations('courses');
  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      <PageHeader
        title={t('hub.tabs.lives')}
        backHref={MEMBER_LIVES_HREF}
        backLabel={t('member.live.back')}
        className="md:static md:px-0"
      />
      <div className="px-4 pt-2">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="live-not-found"
          title={t('notFound.live')}
          body={t('notFound.liveBody')}
          action={
            <a href={MEMBER_LIVES_HREF} data-testid="live-not-found-back" className={LINK_OUTLINE}>
              {t('notFound.liveCta')}
            </a>
          }
        />
      </div>
    </div>
  );
}
