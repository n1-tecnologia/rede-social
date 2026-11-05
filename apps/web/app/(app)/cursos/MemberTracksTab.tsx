import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { CourseCard, MemberTrackCard } from '@rede-social/module-courses/ui';
import { buttonClasses, cn, Skeleton } from '@rede-social/ui';
import { BookOpen, CircleAlert, Clock, PlayCircle, Route, Users } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { trackCardsView } from '@/lib/courses-home-view';
import { getLearnTracks } from '@/lib/courses-learn';
import { type TrackDetailView, trackDetailView, trackFromParam } from '@/lib/courses-member-view';
import { memberScreenHref } from '@/lib/member-area';
import { withTrackWordsLocalView } from '@/lib/track-words-local-view';
import {
  DETAIL_GRID,
  HeroChip,
  MemberDetailHero,
  MemberDetailSection,
  MemberProgressPanel,
} from './MemberDetail';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from './MemberEmptyCard';
import { MemberSectionHeader } from './MemberSection';
import { ReadMoreText } from './ReadMoreText';
import { riseStyle } from './rise';
import { ScreenHeader, ScreenHeaderSkeleton } from './ScreenHeader';

/** "Tentar novamente": the `outline sm` look as a LINK to the screen's own URL (44px hit area). */
const RETRY_LINK = buttonClasses({ variant: 'outline', size: 'sm', hitArea: true });

/** The list's grid, the reference's: two cards a row, three from `lg`. */
const TRACK_GRID = 'grid grid-cols-2 gap-3 px-4 lg:grid-cols-3 lg:gap-4';

const CARD_SKELETONS = [0, 1, 2];

/** The step's number over a course's cover ("01"), the reference's chip. */
const NUMERAL_CHIP =
  'ms-chip inline-flex items-center rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white tabular-nums ring-1 ring-white/15';

/**
 * The Trilhas skeleton (UI-D-456, UI E10 loading), at the 2026-10-26 geometry: the screen's header
 * and a row of three track cards under a title bar. No words. The screen draws its own header, so
 * the skeleton does too.
 */
export function TracksSkeleton() {
  return (
    <div aria-busy data-testid="courses-member-tracks-skeleton" className="flex flex-col pb-8">
      <ScreenHeaderSkeleton />
      <div className="flex flex-col gap-2.5 pt-2">
        <Skeleton className="mx-4 h-4 w-32" />
        <div className={TRACK_GRID}>
          {CARD_SKELETONS.map((index) => (
            <Skeleton
              key={index}
              variant="rect"
              className={cn(
                'aspect-[3/4] w-full rounded-2xl sm:aspect-auto sm:h-[300px] lg:h-[clamp(280px,calc(var(--screen-h)*0.36),420px)]',
                index === 2 && 'hidden lg:block',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The member's Trilhas (08.6-10, D-439, D-438, UI-D-456, COURSE-35). One `GET
 * /v1/courses/learn/tracks` read inside the frame's own `Suspense`.
 *
 * **2026-10-26 (the academy reference's Trilhas, the user's "swap completo").** Two views of the
 * same read, like the reference:
 *
 *  - **the list** (no `?trilha=`, or one naming no track of the answer): the screen's header
 *    ("Caminhos de aprendizado", "Trilhas") and "Todas as trilhas", every track as a large cover
 *    card (`MemberTrackCard`), the member's own first ("Sua trilha" / "Sugerido") with where they
 *    stand, the others with their share; a card opens the track's page;
 *  - **a track's page** (`?trilha={id}` naming a track of the answer): the way back to the list,
 *    the hero (the cover, the pill, "Etapa n de N", "3 cursos", "18 aulas no total", the length and
 *    the CTA "Continuar trilha" / "Começar trilha" / "Rever a trilha" to the course to do now), the
 *    progress panel ("1 de 3 cursos concluídos", the bar, the reference's helper) and "Cursos da
 *    trilha": the courses in path order as numbered catalogue cards, each with the SERVER's state
 *    (a padlock, a check, its share), the step to do now outlined.
 *
 * The param only selects among the server's tracks: every href is built from server ids (planning
 * decision 2, T-08.6-20). No active track → the empty card under the header. The read's refusals
 * split like Início's: `disabled` → the kernel not-found, `redirect` → a navigation, anything else →
 * the error card with "Tentar novamente". The web decides no state and counts nothing (T-08.6-17).
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
  const [t, result] = await Promise.all([
    getTranslations(),
    // ⚠ TEMPORARY LOCAL VIEW (2026-10-27): remove this `.then` with `track-words-local-view.ts`.
    getLearnTracks().then((read) => withTrackWordsLocalView(read, preview)),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();

  const header = (
    <ScreenHeader
      title={t('courses.member.screens.tracks.title')}
      subtitle={t('courses.member.screens.tracks.meta')}
      eyebrow={{ icon: Route, text: t('courses.member.screens.tracks.eyebrow') }}
    />
  );

  if (result.status === 'error') {
    return (
      <div data-testid="courses-member-tracks" className="flex flex-col pb-6">
        {header}
        <MemberEmptyCard
          icon={CircleAlert}
          tone="error"
          data-testid="courses-member-tracks-error"
          className={cn('mx-4 mt-2', MEMBER_EMPTY_WIDE)}
          title={t('courses.errors.title')}
          body={t('courses.errors.tracks')}
          action={
            <a href={memberScreenHref('trilhas', {}, preview)} className={RETRY_LINK}>
              {t('courses.errors.retry')}
            </a>
          }
        />
      </div>
    );
  }

  const tracks = result.page.tracks;
  if (tracks.length === 0) {
    return (
      <div data-testid="courses-member-tracks" className="flex flex-col pb-6">
        {header}
        <MemberEmptyCard
          icon={Route}
          data-testid="courses-member-tracks-empty"
          className={cn('mx-4 mt-2', MEMBER_EMPTY_WIDE)}
          title={t('courses.member.tracks.empty.title')}
          body={t('courses.member.tracks.empty.body', { tenant: tenantName })}
        />
      </div>
    );
  }

  const selected = trackFromParam(tracks, trilha);
  if (selected) {
    return (
      <TrackPage
        view={trackDetailView(selected, t, preview)}
        labels={{
          back: t('courses.member.tracks.detail.back'),
          coursesTitle: t('courses.member.tracks.detail.coursesTitle'),
          coursesSub: t('courses.member.tracks.detail.coursesSub'),
          about: t('courses.member.tracks.detail.about'),
          readMore: t('courses.member.readMore'),
          readLess: t('courses.member.readLess'),
        }}
      />
    );
  }

  const cards = trackCardsView(tracks, t, preview);
  return (
    <div
      data-testid="courses-member-tracks"
      data-view="list"
      className="flex animate-swap-in flex-col pb-8 motion-reduce:animate-none"
    >
      {header}
      <section data-testid="courses-track-list" className="flex flex-col pt-2">
        <MemberSectionHeader
          id="courses-track-list-title"
          title={t('courses.member.tracks.list.title')}
        />
        <ul aria-labelledby="courses-track-list-title" className={TRACK_GRID}>
          {cards.map((card, index) => (
            <li
              key={card.id}
              data-featured={card.featured || undefined}
              className="ms-rise min-w-0"
              style={riseStyle(index)}
            >
              <MemberTrackCard
                id={card.id}
                href={card.href}
                ariaLabel={card.ariaLabel}
                title={card.title}
                eyebrow={card.eyebrow}
                cta={card.cta}
                line={card.line}
                subtitle={card.subtitle}
                tag={card.audience}
                percent={card.percent}
                coverAssetId={card.coverAssetId}
                coverWidths={PURPOSE_WIDTHS.cover}
                index={index}
                eager={index < 3}
              />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A track's own page: the hero, the progress panel and the numbered courses. */
function TrackPage({
  view,
  labels,
}: {
  view: TrackDetailView;
  labels: {
    back: string;
    coursesTitle: string;
    coursesSub: string;
    about: string;
    readMore: string;
    readLess: string;
  };
}) {
  const cta = buttonClasses({
    variant: view.cta.kind === 'review' ? 'outline' : 'brand',
    size: 'md',
    className: 'w-full gap-2 sm:w-auto sm:px-7',
  });
  return (
    <div
      data-testid="courses-member-tracks"
      data-view="track"
      data-track={view.id}
      className="flex animate-swap-in flex-col gap-6 pb-8 motion-reduce:animate-none md:pt-2"
    >
      <MemberDetailHero
        back={{
          href: view.backHref,
          label: labels.back,
          phone: true,
          testId: 'courses-track-back',
        }}
        coverAssetId={view.coverAssetId}
        eyebrow={view.eyebrow}
        title={view.title}
        // 2026-10-27: the manager's subtitle, under the title, when the member read carries it.
        description={view.subtitle}
        watermark={view.title}
        chips={
          <>
            {view.pill ? (
              <HeroChip tone="brand" testId="courses-track-hero-pill">
                {view.pill.label}
              </HeroChip>
            ) : null}
            {view.audience ? (
              <HeroChip icon={Users} testId="courses-track-hero-audience">
                {view.audience}
              </HeroChip>
            ) : null}
            <HeroChip icon={BookOpen}>{view.chips.courses}</HeroChip>
            <HeroChip icon={PlayCircle}>{view.chips.lessons}</HeroChip>
            {view.chips.duration ? <HeroChip icon={Clock}>{view.chips.duration}</HeroChip> : null}
          </>
        }
        actions={
          <a
            href={view.cta.href}
            data-testid="courses-track-hero-cta"
            data-cta={view.cta.kind}
            className={cta}
          >
            {view.cta.label}
          </a>
        }
        testIds={{
          root: 'courses-track-hero',
          title: 'courses-track-hero-title',
          description: 'courses-track-hero-subtitle',
          chips: 'courses-track-hero-chips',
        }}
      />

      {/* 2026-10-27 ("a descrição deve aparecer quando o user abrir a trilha"): the manager's
          description, the course page's "Sobre o curso" panel. */}
      {view.description ? (
        <section aria-labelledby="courses-track-about" className="flex flex-col">
          <MemberSectionHeader id="courses-track-about" title={labels.about} />
          <div className="px-4">
            <div className="ms-panel rounded-2xl border border-border p-4 md:p-5">
              <ReadMoreText
                id="courses-track-about-text"
                data-testid="courses-track-description"
                text={view.description}
                moreLabel={labels.readMore}
                lessLabel={labels.readLess}
              />
            </div>
          </div>
        </section>
      ) : null}

      <MemberProgressPanel
        title={view.progress.title}
        percent={view.progress.percent}
        barLabel={view.progress.barLabel}
        helper={view.progress.helper}
        testId="courses-track-progress"
      />

      <MemberDetailSection
        id="courses-track-courses-title"
        title={labels.coursesTitle}
        sub={labels.coursesSub}
        testId="courses-track-courses"
      >
        <ol aria-labelledby="courses-track-courses-title" className={DETAIL_GRID}>
          {view.courses.map((course, index) => (
            <li
              key={course.id}
              data-testid="courses-track-course"
              data-state={course.state}
              data-current={course.current || undefined}
              style={riseStyle(index)}
              className="ms-rise min-w-0"
            >
              <CourseCard
                testId="courses-track-course-card"
                href={course.href}
                ariaLabel={course.ariaLabel}
                title={course.title}
                meta={course.line}
                duration={course.duration}
                coverAssetId={course.coverAssetId}
                coverWidths={PURPOSE_WIDTHS.cover}
                tags={<span className={NUMERAL_CHIP}>{course.numeral}</span>}
                progress={course.progress}
                locked={course.locked}
                done={course.done}
                eager={index < 4}
                className={cn(
                  'h-full',
                  course.current && 'outline-2 outline-offset-2 outline-brand/60',
                )}
              />
            </li>
          ))}
        </ol>
      </MemberDetailSection>
    </div>
  );
}
