'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { CourseDetail } from '@rede-social/module-courses/contracts';
import { Card, PageHeader, StatusPill } from '@rede-social/ui';
import { Pencil, User } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  COURSE_LEVEL_LABEL_KEY,
  courseStatusPill,
  formatHours,
  publishBlockedLessons,
} from '@/lib/courses-view';
import { CurriculumEditor } from './CurriculumEditor';
import { PublishZone } from './PublishZone';

/** The trailing edit control: an `<a>` (a route, UI-D-407) in the `IconButton` geometry. */
const EDIT_LINK =
  'relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export interface CoursePageProps {
  course: CourseDetail;
  /** The provider thumbnail of every READY lesson video, minted by the server for this render. */
  thumbnails: Readonly<Record<string, string>>;
  /** "9 de outubro de 2026" in the tenant's timezone, only on a published course. */
  publishedAtLabel: string | null;
  /** The linked products' names while the store is on; empty → the plain publish body (D-405). */
  gatedProducts: readonly string[];
}

/**
 * The course page's client shell (08.3-08, UI-D-394, UI-D-409, UI-D-411): the `PageHeader` (back to
 * the hub, the title truncated, the `Pencil` edit link), the 16:10 hero of the SAME cover the
 * catalogue crops 3:4 (`object-cover object-center`, the gradient fallback), the title 24/700, the
 * tagline, the pills (status; level and "{N} h" only when set), the instructor line with the 24px
 * photo (a neutral glyph without one), the action zone (`PublishZone`) and the curriculum editor.
 * Text safety: the title, the tagline and the instructor's name render as React text (T-08.3-25).
 */
export function CoursePage({
  course,
  thumbnails,
  publishedAtLabel,
  gatedProducts,
}: CoursePageProps) {
  const t = useTranslations();
  const status = courseStatusPill(course.status, t as never);
  const coverAlt = t('courses.alt.course', { title: course.title });
  const editHref = `/cursos/${encodeURIComponent(course.id)}/editar`;

  return (
    <div data-testid="course-page" className="mx-auto flex w-full max-w-[680px] flex-col pb-6">
      <PageHeader
        title={course.title}
        backHref="/cursos"
        backLabel={t('courses.course.back')}
        className="md:static md:px-0"
        trailing={
          <a
            href={editHref}
            aria-label={t('courses.course.edit')}
            data-testid="course-edit"
            className={EDIT_LINK}
          >
            <Pencil aria-hidden size={20} />
          </a>
        }
      />

      <div className="flex flex-col gap-4 px-4 pt-2">
        {/* The hero: the catalogue's cover at 16:10 (UI-D-409), or the tenant gradient (D-69). */}
        {course.coverAssetId ? (
          <div
            data-testid="course-hero"
            className="relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-bg-tertiary"
          >
            <MediaImage
              assetId={course.coverAssetId}
              widths={PURPOSE_WIDTHS.cover}
              alt={coverAlt}
              sizes="(min-width: 712px) 648px, 100vw"
              eager
              ratio=""
              className="h-full w-full"
            />
          </div>
        ) : (
          <div
            data-testid="course-hero-fallback"
            aria-hidden
            className="aspect-[16/10] w-full rounded-xl"
            style={{ backgroundImage: 'var(--brand-gradient)' }}
          />
        )}

        <div className="flex flex-col gap-2">
          <p
            data-testid="course-title"
            data-brand-title
            className="break-words text-2xl font-bold leading-tight tracking-[-0.02em] text-text"
          >
            {course.title}
          </p>
          {course.tagline ? (
            <p
              data-testid="course-tagline"
              className="break-words text-sm font-normal text-text-secondary"
            >
              {course.tagline}
            </p>
          ) : null}
          <div data-testid="course-pills" className="flex flex-wrap items-center gap-2">
            <StatusPill tone={status.tone} data-testid="course-status-pill" data-tone={status.tone}>
              {status.label}
            </StatusPill>
            {course.level ? (
              <StatusPill tone="neutral" data-testid="course-level-pill">
                {t(COURSE_LEVEL_LABEL_KEY[course.level])}
              </StatusPill>
            ) : null}
            {course.certificateHours !== null && course.certificateHours > 0 ? (
              <StatusPill tone="neutral" data-testid="course-hours-pill">
                {t('courses.course.hours', {
                  N: formatHours(course.certificateHours).slice(0, -2),
                })}
              </StatusPill>
            ) : null}
          </div>
          <p
            data-testid="course-instructor"
            className="flex items-center gap-2 text-sm font-normal text-text"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary">
              {course.instructorPhotoAssetId ? (
                <MediaImage
                  assetId={course.instructorPhotoAssetId}
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
            <span className="min-w-0 break-words">
              {t('courses.course.instructor', { instructor: course.instructorName })}
            </span>
          </p>
        </div>

        <Card data-testid="course-actions" className="flex flex-col gap-3 p-4">
          <PublishZone
            courseId={course.id}
            status={course.status}
            publishedAtLabel={publishedAtLabel}
            lessons={publishBlockedLessons(course.modules, course.id)}
            unreadyLessonIds={course.unreadyLessonIds}
            gatedProducts={gatedProducts}
          />
        </Card>

        <CurriculumEditor
          courseId={course.id}
          courseTitle={course.title}
          modules={course.modules}
          thumbnails={thumbnails}
        />
      </div>
    </div>
  );
}
