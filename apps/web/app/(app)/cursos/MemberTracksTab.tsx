import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import { ProgressBar } from '@rede-social/module-courses/ui';
import {
  buttonClasses,
  Card,
  chipBase,
  cn,
  EmptyState,
  SectionTitle,
  Skeleton,
} from '@rede-social/ui';
import { Route } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getLearnTracks } from '@/lib/courses-learn';
import { type TrackHeroView, trackTabView } from '@/lib/courses-member-view';
import { CoverGradient } from './HomeShelf';
import { TrackTimeline } from './TrackTimeline';
import { memberTabHref } from './tabs';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** "Tentar novamente": the `outline sm` look as a LINK to the tab's own URL (44px hit area). */
const RETRY_LINK = buttonClasses({
  variant: 'outline',
  size: 'sm',
  hitArea: true,
  className: 'self-start',
});

const STEP_SKELETONS = [0, 1, 2];

/**
 * The Trilhas skeleton (UI-D-456, UI E10 loading): the hero's 16:10 rect, two bars and the `h-11`
 * button bar, then three step skeletons (the 28px disc plus a 56px row). No words.
 */
export function TracksSkeleton() {
  return (
    <div
      aria-busy
      data-testid="courses-member-tracks-skeleton"
      className="flex flex-col gap-6 pb-6"
    >
      <Card className="mx-4 p-0">
        <Skeleton variant="rect" className="aspect-[16/10] w-full rounded-none" />
        <div className="flex flex-col gap-2 p-4">
          <Skeleton variant="rect" className="h-2 w-full rounded-full" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton variant="rect" className="mt-2 h-11 w-full rounded-xl" />
        </div>
      </Card>
      <div className="flex flex-col gap-4 px-4">
        {STEP_SKELETONS.map((index) => (
          <div key={index} className="flex gap-3">
            <Skeleton variant="rect" className="ml-1.5 h-7 w-7 shrink-0 rounded-full" />
            <Skeleton variant="rect" className="h-[82px] min-w-0 flex-1 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The selected track's card (UI-D-456 (1)): the 16:10 cover, the pill, the eyebrow, title and CTA. */
function TrackHero({ view }: { view: TrackHeroView }) {
  const cta = buttonClasses({
    variant: view.cta.kind === 'review' ? 'outline' : 'brand',
    size: 'md',
    fullWidth: true,
    className: 'mt-4',
  });
  return (
    <Card
      data-testid="courses-track-hero"
      data-cta={view.cta.kind}
      className="mx-4 overflow-hidden p-0"
    >
      <div className="relative aspect-[16/10] bg-bg-tertiary">
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
          className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent"
        />
        {view.pill ? (
          <span
            data-testid="courses-track-hero-pill"
            data-kind={view.pill.kind}
            className={cn(
              chipBase,
              'absolute top-3 left-3 bg-black/60 text-white backdrop-blur-sm',
            )}
          >
            {view.pill.label}
          </span>
        ) : null}
        <div className="absolute right-4 bottom-3 left-4">
          <p
            data-testid="courses-track-hero-eyebrow"
            className="text-xs font-bold uppercase tracking-wider text-white/80 tabular-nums"
          >
            {view.eyebrow}
          </p>
          <h2
            data-testid="courses-track-hero-title"
            className="mt-1 line-clamp-2 break-words text-base font-bold leading-tight text-white"
          >
            {view.title}
          </h2>
        </div>
      </div>
      <div className="flex flex-col p-4">
        {view.bar ? <ProgressBar percent={view.bar.percent} label={view.bar.label} /> : null}
        <p
          data-testid="courses-track-hero-line"
          className={cn('text-xs font-normal text-text-secondary tabular-nums', view.bar && 'mt-2')}
        >
          {view.line}
        </p>
        <a href={view.cta.href} data-testid="courses-track-hero-cta" className={cta}>
          {view.cta.label}
        </a>
      </div>
    </Card>
  );
}

/**
 * The member's Trilhas (08.6-10, D-439, D-438, UI-D-456, COURSE-35), ported from the prototype's
 * `app/membros/trilhas/page.tsx`: ONE track at a time, chosen by `?trilha=` when it names a track of
 * the answer, else the member's own track, else the suggested one, else the first (planning
 * decision 2: the param only selects among the server's tracks; every href is built from server
 * ids). One `GET /v1/courses/learn/tracks` read, inside the frame's own `Suspense`:
 *
 *  1. the selected track's hero ("Sua trilha" / "Sugerido" / no pill, "Etapa n de N", the bar
 *     above 0%, "{coursesDone} de {total} etapas · {percent}% do caminho" and one CTA to the course
 *     to do now — brand "Continuar trilha" / "Começar trilha", outline "Rever a trilha" once every
 *     course is done, keyed on `coursesDone`, never on the lesson-weighted percent);
 *  2. "O caminho" (`TrackTimeline`), one step per published course with its state in words;
 *  3. "Outras trilhas", only with two or more tracks — each card swaps the hero by link, so there is
 *     no client state and no member track page (R-A10).
 *
 * No active track → the Trilhas empty card. The read's refusals split like Início's: `disabled` →
 * the kernel not-found, `redirect` → a navigation, anything else → the shipped error card with
 * "Tentar novamente". The web decides no state and counts nothing (T-08.6-17); titles render as
 * React text (T-08.6-25). No motion (the prototype's `AnimatePresence` is dropped, UI-D-463).
 */
export async function MemberTracksTab({
  trilha,
  tenantName,
  preview,
}: {
  trilha: string | string[] | undefined;
  tenantName: string;
  preview: boolean;
}) {
  const [t, result] = await Promise.all([getTranslations(), getLearnTracks()]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  if (result.status === 'error') {
    return (
      <div data-testid="courses-member-tracks" className="flex flex-col gap-6 pb-6">
        <Card data-testid="courses-member-tracks-error" className="mx-4 flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <p className="text-base font-bold leading-tight text-text">
              {t('courses.errors.title')}
            </p>
            <p className="text-sm font-normal text-text-secondary">{t('courses.errors.tracks')}</p>
          </div>
          <a href={memberTabHref('trilhas', preview)} className={RETRY_LINK}>
            {t('courses.errors.retry')}
          </a>
        </Card>
      </div>
    );
  }

  const view = trackTabView(result.page.tracks, trilha, t, preview);

  if (!view) {
    return (
      <div data-testid="courses-member-tracks" className="flex flex-col gap-6 pb-6">
        <EmptyState
          variant="card"
          icon={Route}
          data-testid="courses-member-tracks-empty"
          className="mx-4"
          title={t('courses.member.tracks.empty.title')}
          body={t('courses.member.tracks.empty.body', { tenant: tenantName })}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="courses-member-tracks"
      data-track={view.selected.id}
      className="flex flex-col gap-6 pb-6"
    >
      <TrackHero view={view.selected} />

      <section className="flex flex-col">
        <SectionTitle as="h3" className="mb-3 px-4">
          {t('courses.member.tracks.path.title')}
        </SectionTitle>
        <TrackTimeline ariaLabel={view.selected.pathAria} steps={view.selected.steps} />
      </section>

      {view.others.length > 0 ? (
        <section data-testid="courses-track-others" className="flex flex-col">
          <SectionTitle as="h3" id="courses-track-others-title" className="mb-3 px-4">
            {t('courses.member.tracks.others.title')}
          </SectionTitle>
          <ul aria-labelledby="courses-track-others-title" className="flex flex-col gap-3 px-4">
            {view.others.map((other) => (
              <li key={other.id}>
                <Card className="p-0">
                  <a
                    href={other.href}
                    data-testid="courses-track-other"
                    className={`flex min-h-24 overflow-hidden rounded-[inherit] transition-opacity active:opacity-80 ${FOCUS}`}
                  >
                    <span
                      aria-hidden
                      className="relative w-24 shrink-0 self-stretch bg-bg-tertiary"
                    >
                      {other.coverAssetId ? (
                        <MediaImage
                          assetId={other.coverAssetId}
                          widths={PURPOSE_WIDTHS.cover}
                          alt=""
                          sizes="96px"
                          ratio=""
                          className="absolute inset-0 h-full w-full"
                          fallback={<CoverGradient />}
                        />
                      ) : (
                        <CoverGradient />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col p-3">
                      <span className="line-clamp-2 break-words text-sm font-bold leading-snug text-text">
                        {other.title}
                      </span>
                      <span className="mt-1 text-xs font-normal text-text-tertiary tabular-nums">
                        {other.meta}
                      </span>
                      {other.progress ? (
                        <>
                          <ProgressBar
                            percent={other.progress.percent}
                            label={other.progress.label}
                            size="sm"
                            className="mt-2"
                          />
                          <span className="mt-1 text-xs font-normal text-text-tertiary tabular-nums">
                            {other.progress.line}
                          </span>
                        </>
                      ) : (
                        <span className="mt-2 text-xs font-normal text-text-tertiary">
                          {other.notStarted}
                        </span>
                      )}
                    </span>
                  </a>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
