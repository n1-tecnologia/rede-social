import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MemberLessonThumb, ProgressBar } from '@rede-social/module-courses/ui';
import { buttonClasses, Card, SectionTitle } from '@rede-social/ui';
import { Play } from 'lucide-react';
import type { HomeHeroView } from '@/lib/courses-member-view';

/** The CTA: the brand `fullWidth` button look as a LINK (a lesson or a course is a route). */
const CTA_LINK = buttonClasses({
  variant: 'brand',
  size: 'md',
  fullWidth: true,
  className: 'mt-4 gap-2',
});

/**
 * The Início hero (08.6-08, D-437, UI-D-449, COURSE-29), ported from the prototype's
 * `app/membros/page.tsx` hero and normalised to the type scale: one card for the three states.
 *
 *  - the section title by state (`SectionTitle` micro, `px-4 mb-3`);
 *  - (1) the media: `MemberLessonThumb` at full width, 16:9, square corners, the COURSE cover
 *    (UI-D-444, never a per-lesson still), the open-state play disc, the "mm:ss" chip and, for a free
 *    lesson, the "Aula aberta" pill. Decorative (`aria-hidden`);
 *  - (2) the body `p-4`: the eyebrow (one line, truncated), the title (two lines), the sub-line
 *    (wraps), the progress block (the `h-2` bar plus its line above zero, the "{N} aulas · {duration}"
 *    line at zero) and ONE brand CTA link — the screen's one brand fill.
 *
 * Only the CTA is a link: the card is not, so there is no nested anchor and no double target. Every
 * word, number and href arrives finished from `homeHeroView` (the server's overview), rendered as
 * React text (UI-D-463, T-08.6-25). No motion (UI-D-443): no cross-fade, the bar renders its value.
 */
export function HomeHero({ view }: { view: HomeHeroView }) {
  return (
    <section data-testid="courses-home-hero" className="flex flex-col">
      <SectionTitle as="h3" className="mb-3 px-4">
        {view.sectionTitle}
      </SectionTitle>
      <Card className="mx-4 p-0">
        <MemberLessonThumb
          state="open"
          coverAssetId={view.coverAssetId}
          coverWidths={PURPOSE_WIDTHS.cover}
          sizes="(min-width: 680px) 648px, 100vw"
          badge={view.badge ?? undefined}
          duration={view.duration ?? undefined}
          className="w-full rounded-none"
        />
        <div className="min-w-0 p-4">
          {view.eyebrow ? (
            <p
              data-testid="courses-home-hero-eyebrow"
              className="truncate text-xs font-bold uppercase tracking-wider text-text-tertiary tabular-nums"
            >
              {view.eyebrow}
            </p>
          ) : null}
          <h4
            data-testid="courses-home-hero-title"
            className="mt-1 line-clamp-2 break-words text-base font-bold leading-tight text-text"
          >
            {view.title}
          </h4>
          {view.subLine ? (
            <p
              data-testid="courses-home-hero-sub"
              className="mt-1 break-words text-xs font-normal text-text-secondary"
            >
              {view.subLine}
            </p>
          ) : null}
          <div className="mt-4">
            {view.bar ? (
              <ProgressBar percent={view.bar.percent} label={view.bar.label} size="md" />
            ) : null}
            <p
              data-testid="courses-home-hero-progress"
              className={`${view.bar ? 'mt-2 ' : ''}text-xs font-normal text-text-tertiary tabular-nums`}
            >
              {view.progressLine}
            </p>
          </div>
          <a href={view.cta.href} data-testid="courses-home-hero-cta" className={CTA_LINK}>
            {view.cta.play ? <Play aria-hidden size={18} fill="currentColor" /> : null}
            {view.cta.label}
          </a>
        </div>
      </Card>
    </section>
  );
}
