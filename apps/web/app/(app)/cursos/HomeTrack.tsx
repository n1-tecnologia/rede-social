import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProgressBar } from '@rede-social/module-courses/ui';
import { Card, chipBase, cn } from '@rede-social/ui';
import { Lock } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import type { HomeTrackView } from '@/lib/courses-member-view';
import { CoverGradient, HomeSectionHeader } from './HomeShelf';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The course name inside the dashed hook: 12/700 secondary (UI-D-451). */
const lockedCourse = (chunks: ReactNode) => (
  <span className="font-bold text-text-secondary">{chunks}</span>
);

/**
 * "Sua trilha" (08.6-09, D-438, UI-D-451, COURSE-31), ported from the prototype's track card
 * (`app/membros/page.tsx` § 5). The section title stays "Sua trilha" (D-438's word is the pill
 * "Sugerido", not a switched title). The host renders this only when the overview carries `track`.
 *
 *  - ONE link card to the course to do now (`resumeCourseId`): the 16:7 cover (or the gradient)
 *    under the `from-black/85` veil, the "Sugerido" over-media pill when `suggested`, then the
 *    eyebrow "Etapa n de N" and the title (`line-clamp-2`) at the bottom; the body holds the `h-1`
 *    bar above 0% and the line by state ("agora: {course}" wraps);
 *  - the dashed static row "Última etapa exclusiva: {course}" under it, ONLY when the server names
 *    one. It is not a link (the steps are links in Trilhas) and it never pressures (PR-5): the 12px
 *    `Lock`, neutral ink, the course in colour on its own page.
 *
 * Every word arrives finished from `homeTrackView` (the rich hook alone is formatted here, for its
 * bold course name) and renders as React text (UI-D-463, T-08.6-25). No motion.
 */
export async function HomeTrack({
  view,
  title,
  seeAllLabel,
  seeAllAriaLabel,
}: {
  view: HomeTrackView;
  title: string;
  seeAllLabel: string;
  seeAllAriaLabel: string;
}) {
  const t = await getTranslations('courses.member.home.track');

  return (
    <section data-testid="courses-home-track" data-state={view.state} className="flex flex-col">
      <HomeSectionHeader
        id="courses-home-track-title"
        title={title}
        seeAll={{ href: view.seeAllHref, label: seeAllLabel, ariaLabel: seeAllAriaLabel }}
      />
      <Card className="mx-4 p-0">
        <a
          href={view.href}
          data-testid="courses-home-track-card"
          className={`block transition-opacity active:opacity-80 ${FOCUS} focus-visible:ring-inset focus-visible:ring-offset-0`}
        >
          <span className="relative block aspect-[16/7] bg-bg-tertiary">
            {view.coverAssetId ? (
              <MediaImage
                assetId={view.coverAssetId}
                widths={PURPOSE_WIDTHS.cover}
                alt=""
                sizes="(min-width: 680px) 648px, 100vw"
                ratio=""
                className="absolute inset-0 h-full w-full"
                fallback={<CoverGradient />}
              />
            ) : (
              <CoverGradient />
            )}
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
            />
            {view.suggestedPill ? (
              <span
                data-testid="courses-home-track-suggested"
                className={cn(
                  chipBase,
                  'absolute top-3 left-3 bg-black/60 text-white backdrop-blur-sm',
                )}
              >
                {view.suggestedPill}
              </span>
            ) : null}
            <span className="absolute right-4 bottom-3 left-4 block">
              <span
                data-testid="courses-home-track-eyebrow"
                className="block text-xs font-bold uppercase tracking-wider text-white/80 tabular-nums"
              >
                {view.eyebrow}
              </span>
              <span
                data-testid="courses-home-track-name"
                className="mt-1 line-clamp-2 break-words text-base font-bold leading-tight text-white"
              >
                {view.title}
              </span>
            </span>
          </span>
          <span className="block p-4">
            {view.bar ? (
              <ProgressBar percent={view.bar.percent} label={view.bar.label} size="sm" />
            ) : null}
            <span
              data-testid="courses-home-track-line"
              className={cn(
                'block break-words text-xs font-normal text-text-tertiary tabular-nums',
                view.bar && 'mt-2',
              )}
            >
              {view.line}
            </span>
          </span>
        </a>
      </Card>
      {view.lastLocked ? (
        <p
          data-testid="courses-home-track-locked"
          className="mx-4 mt-2 flex items-center gap-2 rounded-xl border border-border border-dashed px-3 py-3 text-xs font-normal text-text-tertiary"
        >
          <Lock aria-hidden size={12} className="shrink-0" />
          <span className="line-clamp-1 min-w-0 break-words">
            {t.rich('lastLocked', { course: view.lastLocked, b: lockedCourse })}
          </span>
        </p>
      ) : null}
    </section>
  );
}
