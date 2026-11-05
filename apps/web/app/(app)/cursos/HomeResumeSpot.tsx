import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProgressBar } from '@rede-social/module-courses/ui';
import { Play } from 'lucide-react';
import type { HomeResumeSpotView } from '@/lib/courses-home-view';
import { HOME_RESUME_ID } from './HomeDashboard';
import { CoverGradient } from './MemberSection';

/**
 * The CTA, a link stretched over the whole card (the card has no other target): the brand's ink on
 * a phone, the screen's one brand fill from `sm`.
 */
const CTA =
  'mt-2.5 inline-flex w-fit items-center gap-1.5 text-[13px] font-semibold text-brand transition-colors after:absolute after:inset-0 after:rounded-2xl hover:text-brand-hover focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-brand sm:mt-5 sm:h-11 sm:rounded-full sm:bg-brand sm:px-5 sm:text-sm sm:text-on-brand sm:after:rounded-3xl sm:hover:bg-brand-hover sm:hover:text-on-brand motion-reduce:transition-none';

/**
 * "Continue de onde parou" at the top of Início (2026-10-27, `homeResumeSpotView`), drawn only while
 * the member is in the middle of a course (the server's `retomando` hero): the course cover with the
 * play disc, the lesson's place and title, the bar at the second the member stopped at with "Você
 * parou em 12:34 de 25:00", and "Continuar aula", ONE link over the whole card, straight to the
 * player, which starts at that second. A phone draws one compact row; from `sm` the cover grows and
 * the CTA turns into the brand's pill. The section keeps the old hero's hooks (`courses-home-hero*`)
 * and the id the floating "Continuar assistindo" watches (`HOME_RESUME_ID`); with it on screen, the
 * panel below leaves its own resume block out.
 */
export function HomeResumeSpot({ view }: { view: HomeResumeSpotView }) {
  return (
    <section
      id={HOME_RESUME_ID}
      data-testid="courses-home-hero"
      data-home-section
      aria-labelledby="courses-home-hero-heading"
      className="px-4"
    >
      <div className="ms-card ms-panel group relative flex items-center gap-4 rounded-2xl border border-border bg-card p-3 sm:gap-6 sm:rounded-3xl sm:p-4">
        <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-xl bg-bg-tertiary sm:w-[42%] sm:max-w-[400px] sm:rounded-2xl">
          {view.coverAssetId ? (
            <MediaImage
              assetId={view.coverAssetId}
              widths={PURPOSE_WIDTHS.cover}
              alt=""
              sizes="(min-width: 640px) 400px, 144px"
              ratio=""
              className="ms-zoom absolute inset-0 h-full w-full"
              fallback={<CoverGradient />}
            />
          ) : (
            <CoverGradient />
          )}
          <span
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent"
          />
          <span aria-hidden className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white backdrop-blur-md transition-transform duration-200 group-hover:scale-110 motion-reduce:transition-none sm:h-14 sm:w-14">
              <Play size={18} fill="currentColor" className="ml-0.5 sm:h-[22px] sm:w-[22px]" />
            </span>
          </span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col py-0.5 sm:py-2 sm:pr-2">
          <h2
            id="courses-home-hero-heading"
            className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand sm:text-[11px]"
          >
            {view.heading}
          </h2>
          {view.eyebrow ? (
            <p
              data-testid="courses-home-hero-eyebrow"
              className="mt-1.5 line-clamp-1 text-[11px] font-normal text-text-tertiary tabular-nums sm:text-xs"
            >
              {view.eyebrow}
            </p>
          ) : null}
          <h3
            data-testid="courses-home-hero-title"
            className="ms-title-font mt-0.5 line-clamp-2 break-words text-[15px] font-medium leading-snug tracking-tight text-text sm:text-xl lg:text-2xl"
          >
            {view.title}
          </h3>
          {view.watched ? (
            <div data-testid="courses-home-resume-watched" className="mt-2.5 sm:mt-4">
              <ProgressBar
                percent={view.watched.percent}
                label={view.watched.label}
                size="sm"
                className="sm:h-2"
              />
              <p className="mt-1.5 text-[11px] font-normal text-text-secondary tabular-nums sm:text-xs">
                {view.watched.line}
              </p>
            </div>
          ) : null}
          <a href={view.cta.href} data-testid="courses-home-hero-cta" className={CTA}>
            <Play aria-hidden size={14} fill="currentColor" className="shrink-0" />
            {view.cta.label}
          </a>
        </div>
      </div>
    </section>
  );
}
