import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { LearnCourse } from '@rede-social/module-courses/contracts';
import { ExclusiveBadge } from '@rede-social/module-store/ui';
import { chipBase, cn, EmptyState, PageHeader, SectionTitle, StatusPill } from '@rede-social/ui';
import { Check, GraduationCap, User } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import {
  courseActionView,
  courseHeroView,
  courseSeconds,
  curriculumOpenModules,
  curriculumView,
  memberCourseHref,
  memberLessonHref,
} from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { getCourseAccess } from '@/lib/store';
import { lockedCourseView } from '@/lib/store-view';
import { PreviewBanner } from '../PreviewBanner';
import { ReadMoreText } from '../ReadMoreText';
import { CourseActionZone, type LockedCourseZone } from './CourseActionZone';
import { Curriculum } from './Curriculum';

/**
 * The member's course page (08.5-07, UI-D-427..UI-D-430, D-423, D-430, COURSE-18): what a member, a
 * `support_tenant` or a previewing `admin_tenant` sees at `/cursos/[courseId]` (the role split is
 * `page.tsx`'s). Server-rendered top to bottom from ONE read, the courses API's titles-only course
 * (`GET /v1/courses/learn/courses/{id}`):
 *
 *  - the `PageHeader` (back "Voltar para Cursos", the course title truncated, no trailing control);
 *  - the `PreviewBanner` right under it for an `admin_tenant` at `?ver=aluno` (UI-D-437);
 *  - the full-bleed 16:10 hero (the course cover, the tenant gradient without one) with the category
 *    and, on a locked course, the store's `ExclusiveBadge` "Exclusivo" as over-media pills that wrap;
 *  - the identity block: title 24/700, tagline, the `neutral` pills (level, "{N} h", and "Produto
 *    arquivado" when the store says so), the instructor line with the 24px photo;
 *  - the action zone: on a LOCKED course (the courses API's `locked`, never for staff or preview) the
 *    buy section in one of its four variants from the store's access read (UI-D-428), else the
 *    progress variants;
 *  - "Sobre o curso" (absent when empty) with "Ler mais", "O que você vai dominar" (absent when
 *    empty), and "Conteúdo do curso" with the module bands — or "Nenhuma aula ainda" (EP-13).
 *
 * **Titles only** (D-423, T-08.5-13): the course read never carries a locked lesson's description,
 * video, poster or material, so none of it can reach this page's HTML or RSC payload. Text safety:
 * every title, description and outcome renders as React text (T-08.5-29).
 */
export interface MemberCoursePageProps {
  course: LearnCourse;
  /** An `admin_tenant` at `?ver=aluno`: the banner, and internal links keep the param (UI-D-437). */
  preview: boolean;
  /** The store module is on for the tenant (UI-D-442: off → nothing to buy, no access read). */
  storeOn: boolean;
}

const COVER_SIZES = '(min-width: 680px) 680px, 100vw';

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
  const initialOpen = curriculumOpenModules(course);
  const noLessons = curriculum.lessonCount === 0;
  const archived = locked && access?.archivedTag === true;
  const identityPills = archived
    ? [...hero.pills, t('courses.member.tags.productArchived')]
    : hero.pills;

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

  return (
    <div
      data-testid="member-course-page"
      className="mx-auto flex w-full max-w-[680px] flex-col pb-6"
    >
      <PageHeader
        title={hero.title}
        backHref="/cursos"
        backLabel={t('courses.course.back')}
        stickyTop="0px"
        className="md:static md:px-0"
      />
      {preview ? <PreviewBanner courseId={course.id} /> : null}

      <div
        data-testid="member-course-hero"
        className="relative aspect-[16/10] w-full overflow-hidden bg-bg-tertiary"
      >
        {hero.coverAssetId ? (
          <MediaImage
            assetId={hero.coverAssetId}
            widths={PURPOSE_WIDTHS.cover}
            alt={hero.coverAlt}
            sizes={COVER_SIZES}
            eager
            ratio=""
            className="absolute inset-0 h-full w-full"
            fallback={
              <span
                aria-hidden
                className="absolute inset-0 block"
                style={{ backgroundImage: 'var(--brand-gradient)' }}
              />
            }
          />
        ) : (
          <span
            aria-hidden
            data-testid="member-course-hero-fallback"
            className="absolute inset-0 block"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}
        {hero.categoryPill || locked ? (
          <div
            data-testid="member-course-hero-tags"
            className="absolute top-3 right-3 left-3 flex flex-wrap items-start gap-1"
          >
            {hero.categoryPill ? (
              <span
                className={cn(
                  chipBase,
                  'max-w-full truncate bg-black/60 text-white backdrop-blur-sm',
                )}
              >
                {hero.categoryPill}
              </span>
            ) : null}
            {locked ? <ExclusiveBadge label={t('courses.member.tags.exclusiveCourse')} /> : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 px-4 pt-4">
        <p
          data-testid="member-course-title"
          data-brand-title
          className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text [overflow-wrap:anywhere]"
        >
          {hero.title}
        </p>
        {hero.tagline ? (
          <p
            data-testid="member-course-tagline"
            className="text-sm font-normal text-text-secondary [overflow-wrap:anywhere]"
          >
            {hero.tagline}
          </p>
        ) : null}
        {identityPills.length > 0 ? (
          <div data-testid="member-course-pills" className="flex flex-wrap items-center gap-1">
            {identityPills.map((pill) => (
              <StatusPill key={pill} tone="neutral">
                {pill}
              </StatusPill>
            ))}
          </div>
        ) : null}
        <p
          data-testid="member-course-instructor"
          className="flex items-center gap-2 text-sm font-normal text-text"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary">
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
              <User aria-hidden size={14} className="text-text-tertiary" />
            )}
          </span>
          <span className="min-w-0 break-words">{hero.instructorLine}</span>
        </p>
      </div>

      {/* EP-13: a course with no live lesson has no action zone at all, locked or open. */}
      {noLessons ? null : (
        <div data-testid="member-course-actions" className="flex flex-col">
          <CourseActionZone action={locked ? null : progressAction} locked={lockedZone} />
        </div>
      )}

      <div className="flex flex-col gap-6 pt-6">
        {hero.description ? (
          <section aria-labelledby="course-about" className="flex flex-col gap-2 px-4">
            <SectionTitle id="course-about">{t('courses.member.course.about')}</SectionTitle>
            <ReadMoreText
              id="course-about-text"
              data-testid="member-course-description"
              text={hero.description}
              moreLabel={t('courses.member.readMore')}
              lessLabel={t('courses.member.readLess')}
            />
          </section>
        ) : null}

        {hero.outcomes.length > 0 ? (
          <section aria-labelledby="course-outcomes" className="flex flex-col gap-2 px-4">
            <SectionTitle id="course-outcomes">{t('courses.member.course.outcomes')}</SectionTitle>
            <ul aria-labelledby="course-outcomes" className="flex flex-col gap-2">
              {hero.outcomes.map((outcome, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: outcomes may repeat; order is the identity.
                  key={index}
                  className="flex items-start gap-2 text-sm font-normal text-text-secondary [overflow-wrap:anywhere]"
                >
                  <Check aria-hidden size={16} className="shrink-0 text-text-secondary" />
                  <span className="min-w-0">{outcome}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="course-content" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-3 px-4">
            <SectionTitle id="course-content">{t('courses.member.course.content')}</SectionTitle>
            {noLessons ? null : (
              <span
                data-testid="member-course-count"
                className="shrink-0 text-xs font-normal text-text-tertiary tabular-nums"
              >
                {curriculum.countLabel}
              </span>
            )}
          </div>
          {noLessons ? (
            <div className="px-4">
              <EmptyState
                variant="card"
                icon={GraduationCap}
                data-testid="member-course-no-lessons"
                title={t('courses.member.course.noLessons.title')}
                body={t('courses.member.course.noLessons.body')}
              />
            </div>
          ) : (
            <Curriculum
              modules={curriculum.modules}
              initialOpen={initialOpen}
              coverAssetId={course.coverAssetId}
              coverWidths={PURPOSE_WIDTHS.cover}
            />
          )}
        </section>
      </div>
    </div>
  );
}
