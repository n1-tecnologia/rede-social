import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { LearnCourse } from '@rede-social/module-courses/contracts';
import { MemberModuleCard } from '@rede-social/module-courses/ui';
import { ExclusiveBadge } from '@rede-social/module-store/ui';
import { buttonClasses, MemberSkin, PageHeader, StatusPill } from '@rede-social/ui';
import { BookOpen, Check, CircleCheck, Clock, GraduationCap, Play, User } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import {
  courseActionView,
  courseHeroView,
  courseSeconds,
  curriculumView,
  memberCourseHref,
  memberLessonHref,
  moduleCardViews,
} from '@/lib/courses-member-view';
import { type CoursesTranslator, formatCourseDuration } from '@/lib/courses-view';
import { memberScreenHref } from '@/lib/member-area';
import { getCourseAccess } from '@/lib/store';
import { lockedCourseView } from '@/lib/store-view';
import { MemberEmptyCard } from '../MemberEmptyCard';
import {
  DETAIL_GRID,
  HeroChip,
  MemberDetailHero,
  MemberDetailSection,
  MemberProgressPanel,
} from '../MemberDetail';
import { MemberSectionHeader } from '../MemberSection';
import { ReadMoreText } from '../ReadMoreText';
import { riseStyle } from '../rise';
import { CourseActionZone, type LockedCourseZone } from './CourseActionZone';

/**
 * The member's course page (08.5-07, UI-D-427..UI-D-430, D-423, D-430, COURSE-18): what a member, a
 * `support_tenant` or a previewing `admin_tenant` sees at `/cursos/[courseId]` (the role split is
 * `page.tsx`'s). Server-rendered top to bottom from ONE read, the courses API's titles-only course
 * (`GET /v1/courses/learn/courses/{id}`).
 *
 * **Titles only** (D-423, T-08.5-13): the course read never carries a locked lesson's description,
 * video, poster or material, so none of it can reach this page's HTML or RSC payload. Text safety:
 * every title, description and outcome renders as React text (T-08.5-29).
 *
 * **2026-10-26 (the academy reference's course page, the user's "swap completo").** Top to bottom:
 *
 *  - on a phone, the sticky `PageHeader` (back to Cursos; its title is a paragraph);
 *  - the reference's hero (`MemberDetailHero`): the cover as the panel's ground, the overline
 *    ("Curso · 4 módulos · Iniciante"), the title (the page's h1), the tagline, the instructor, the
 *    chips ("14 aulas", "3 concluídas", "21% completo", the length; "Exclusivo" on a locked course)
 *    and the main action ("Começar o curso" / "Continuar o curso" / "Rever o curso"), never on a
 *    locked course;
 *  - on a LOCKED course (never for staff or preview) the buy section (UI-D-428, `CourseActionZone`),
 *    else "Seu progresso no curso", the bar and its share;
 *  - "Módulos": the modules as the reference's cards (`MemberModuleCard`), each opening its own page
 *    (`/cursos/{id}/modulos/{moduleId}`), where its lessons are; or "Nenhuma aula ainda" (EP-13);
 *  - "Sobre o curso" (three lines and "Ler mais") and "O que você vai dominar", side by side from
 *    `lg`; the store's "Produto arquivado" pill when it applies.
 *
 * A WIDE page on the desktop (`data-shell-full`). Nothing here moves or isolates around the buy zone,
 * whose sheet renders inside it.
 */
export interface MemberCoursePageProps {
  course: LearnCourse;
  /** An `admin_tenant` at `?ver=aluno`: internal links keep the param (UI-D-437); no banner since 2026-10-23. */
  preview: boolean;
  /** The store module is on for the tenant (UI-D-442: off → nothing to buy, no access read). */
  storeOn: boolean;
}

export async function MemberCoursePage({ course, preview, storeOn }: MemberCoursePageProps) {
  const t = (await getTranslations()) as unknown as CoursesTranslator;
  // D-424 / UI-D-428: the buy section only for a course the COURSES API locked for this viewer. Staff
  // are never locked (the API answers `locked: false`), and preview is always open (UI-D-437).
  const locked = course.locked && !preview;
  const access = locked && storeOn ? await getCourseAccess(course.id) : null;
  const hero = courseHeroView(course, t);
  const progressAction = courseActionView(course.progress, t, {
    courseId: course.id,
    durationSeconds: courseSeconds(course),
    preview,
  });
  const curriculum = curriculumView(course, preview, t);
  const modules = moduleCardViews(course, preview, t);
  const noLessons = curriculum.lessonCount === 0;
  const archived = locked && access?.archivedTag === true;
  const duration = formatCourseDuration(courseSeconds(course));

  let lockedZone: LockedCourseZone | null = null;
  if (locked) {
    // Store off → nothing is buyable: the not-for-sale card (c); a failed read → (d).
    const view = storeOn
      ? access
        ? lockedCourseView(access, { courseId: course.id, courseTitle: course.title }, t)
        : null
      : lockedCourseView(
          { archivedTag: false, buyableProducts: [] },
          { courseId: course.id, courseTitle: course.title },
          t,
        );
    const freeId = course.progress.firstFreeLessonId;
    lockedZone = {
      view,
      choices: (view?.choices ?? []).map((choice) => ({
        href: choice.href,
        name: choice.name,
        priceLabel: choice.priceLabel,
        ariaLabel: choice.ariaLabel,
        thumb: choice.imageAssetId ? (
          <MediaImage
            assetId={choice.imageAssetId}
            widths={PURPOSE_WIDTHS.cover}
            alt=""
            sizes="40px"
            ratio=""
            className="h-full w-full"
          />
        ) : (
          <span
            className="block h-full w-full"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        ),
      })),
      buyLabel: t('courses.member.locked.buy'),
      storeUnavailable: t('courses.member.locked.storeUnavailable'),
      retryLabel: t('courses.errors.retry'),
      retryHref: memberCourseHref(course.id, preview),
      freeLesson: freeId
        ? {
            href: memberLessonHref(course.id, freeId, preview),
            label: t('courses.member.locked.freeLesson'),
          }
        : null,
    };
  }

  const progress = course.progress;
  const chips = noLessons ? null : (
    <>
      <HeroChip icon={BookOpen} testId="member-course-chip-lessons">
        {t('courses.member.chips.lessons', { N: curriculum.lessonCount })}
      </HeroChip>
      {progress.done > 0 ? (
        <HeroChip icon={CircleCheck} testId="member-course-chip-done">
          {t('courses.member.chips.done', { n: progress.done })}
        </HeroChip>
      ) : null}
      {duration ? (
        <HeroChip icon={Clock} testId="member-course-chip-duration">
          {duration}
        </HeroChip>
      ) : null}
      {!locked && progress.percent > 0 ? (
        <HeroChip tone="brand" testId="member-course-chip-progress">
          {t('courses.member.chips.percent', { percent: progress.percent })}
        </HeroChip>
      ) : null}
      {locked ? (
        <ExclusiveBadge label={t('courses.member.tags.exclusiveCourse')} size="compact" />
      ) : null}
    </>
  );

  const cta =
    !locked && !noLessons && progressAction?.href ? (
      <a
        href={progressAction.href}
        data-testid="course-action-cta"
        data-variant={progressAction.variant}
        className={buttonClasses({
          variant: progressAction.variant === 'done' ? 'outline' : 'brand',
          size: 'lg',
          className: 'w-full gap-2 sm:w-auto',
        })}
      >
        {progressAction.variant === 'done' ? null : (
          <Play aria-hidden size={17} fill="currentColor" />
        )}
        {progressAction.label}
      </a>
    ) : null;

  return (
    <MemberSkin>
      <div
        data-testid="member-course-page"
        data-shell-full
        className="mx-auto flex w-full flex-col gap-6 pb-8 md:gap-8"
      >
        <PageHeader
          title={hero.title}
          titleAs="p"
          backHref={memberScreenHref('cursos', {}, preview)}
          backLabel={t('courses.course.back')}
          className="md:hidden"
        />

        <MemberDetailHero
          back={{
            href: memberScreenHref('cursos', {}, preview),
            label: t('courses.member.catalogue.title'),
          }}
          coverAssetId={hero.coverAssetId}
          eyebrow={hero.overline}
          title={hero.title}
          description={hero.tagline}
          chips={
            <>
              <span
                data-testid="member-course-instructor"
                className="inline-flex w-full items-center gap-2 pb-1 text-sm text-white/85"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/20">
                  {hero.instructorPhotoAssetId ? (
                    <MediaImage
                      assetId={hero.instructorPhotoAssetId}
                      widths={PURPOSE_WIDTHS.cover}
                      alt=""
                      sizes="24px"
                      ratio=""
                      className="h-full w-full"
                    />
                  ) : (
                    <User aria-hidden size={13} className="text-white" />
                  )}
                </span>
                <span className="min-w-0 break-words">{hero.instructorLine}</span>
              </span>
              {chips}
            </>
          }
          actions={
            cta ? (
              <div data-testid="member-course-actions" className="flex w-full sm:w-auto">
                {cta}
              </div>
            ) : null
          }
          testIds={{
            root: 'member-course-hero',
            title: 'member-course-title',
            description: 'member-course-tagline',
            chips: 'member-course-chips',
          }}
        />

        {archived ? (
          <div data-testid="member-course-pills" className="flex flex-wrap items-center gap-1 px-4">
            <StatusPill tone="neutral">{t('courses.member.tags.productArchived')}</StatusPill>
          </div>
        ) : null}

        {/* EP-13: a course with no live lesson has no action zone at all, locked or open. */}
        {!noLessons && locked ? (
          <div data-testid="member-course-locked" className="flex flex-col lg:max-w-xl">
            <CourseActionZone action={null} locked={lockedZone} />
          </div>
        ) : null}
        {!noLessons && !locked && progressAction ? (
          <MemberProgressPanel
            testId="member-course-progress"
            title={t('courses.member.course.progressTitle')}
            percent={progress.percent}
            barLabel={t('courses.member.progress.aria', { percent: progress.percent })}
            helper={progressAction.variant === 'start' ? null : progressAction.line}
          />
        ) : null}

        <MemberDetailSection
          id="course-content"
          title={t('courses.member.course.modulesTitle')}
          sub={noLessons ? null : curriculum.countLabel}
          testId="member-course-modules"
        >
          {noLessons ? (
            <div className="px-4">
              <MemberEmptyCard
                icon={GraduationCap}
                as="h3"
                data-testid="member-course-no-lessons"
                title={t('courses.member.course.noLessons.title')}
                body={t('courses.member.course.noLessons.body')}
              />
            </div>
          ) : (
            <ul aria-labelledby="course-content" className={DETAIL_GRID}>
              {modules.map((module, index) => (
                <li key={module.id} className="ms-rise min-w-0" style={riseStyle(index)}>
                  <MemberModuleCard
                    id={module.id}
                    href={module.href}
                    ariaLabel={module.ariaLabel}
                    title={module.title}
                    pill={module.pill}
                    meta={module.meta}
                    state={module.state}
                    coverAssetId={course.coverAssetId}
                    coverWidths={PURPOSE_WIDTHS.cover}
                  />
                </li>
              ))}
            </ul>
          )}
        </MemberDetailSection>

        {hero.description || hero.outcomes.length > 0 ? (
          <div className="flex flex-col gap-7 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-2">
            {hero.description ? (
              <section aria-labelledby="course-about" className="flex flex-col">
                <MemberSectionHeader id="course-about" title={t('courses.member.course.about')} />
                <div className="px-4">
                  <div className="ms-panel rounded-2xl border border-border p-4 md:p-5">
                    <ReadMoreText
                      id="course-about-text"
                      data-testid="member-course-description"
                      text={hero.description}
                      moreLabel={t('courses.member.readMore')}
                      lessLabel={t('courses.member.readLess')}
                    />
                  </div>
                </div>
              </section>
            ) : null}

            {hero.outcomes.length > 0 ? (
              <section aria-labelledby="course-outcomes" className="flex flex-col">
                <MemberSectionHeader
                  id="course-outcomes"
                  title={t('courses.member.course.outcomes')}
                />
                <div className="px-4">
                  <ul
                    aria-labelledby="course-outcomes"
                    className="ms-panel flex flex-col gap-3 rounded-2xl border border-border p-4 md:p-5"
                  >
                    {hero.outcomes.map((outcome, index) => (
                      <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: outcomes may repeat; order is the identity.
                        key={index}
                        className="flex items-start gap-2.5 text-sm font-normal leading-relaxed text-text-secondary [overflow-wrap:anywhere]"
                      >
                        <span
                          aria-hidden
                          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand"
                        >
                          <Check size={12} strokeWidth={3} />
                        </span>
                        <span className="min-w-0">{outcome}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </MemberSkin>
  );
}
