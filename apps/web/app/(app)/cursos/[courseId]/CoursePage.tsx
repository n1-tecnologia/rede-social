'use client';

import type { CourseDetail } from '@rede-social/module-courses/contracts';
import { Card, cn, PageHeader, SectionTitle, StatusPill } from '@rede-social/ui';
import { Check, Eye, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import {
  type CourseFactCell,
  courseFactsView,
  courseRowView,
  courseStatusPill,
  publishBlockedLessons,
} from '@/lib/courses-view';
import { SECTION_TITLE } from '../admin-styles';
import { ReadMoreText } from '../ReadMoreText';
import { CourseHero } from './CourseHero';
import { CurriculumEditor } from './CurriculumEditor';
import { PublishZone } from './PublishZone';

/** A door's focus ring sits on its pill, not on the 44px hit area around it. */
const PILL_FOCUS =
  'group-focus-visible:ring-2 group-focus-visible:ring-brand group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-bg';

/** The header's "Ver como aluno": an outlined pill (a route), inside a 44px-tall hit area. */
const VIEW_AS_MEMBER_PILL =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-border-secondary px-3 text-xs font-bold text-text transition-colors group-hover:bg-bg-hover group-active:bg-bg-tertiary';

/** The hero's "Editar": black alpha like the area's glass chips, so it holds on any art. */
const GLASS_EDIT =
  'inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1.5 text-[11px] font-bold text-white backdrop-blur-sm transition-opacity group-active:opacity-80';

/** A section's "Editar" on the page's ground: the brand's tint, never its fill. */
const TINT_EDIT =
  'inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-1 text-[11px] font-bold text-brand transition-opacity group-active:opacity-80';

/**
 * The hero's chips row (`course-hero-tags`) keeps clear of the "Editar" in the top-right corner, so a
 * long category truncates before the door instead of running under it.
 */
const HERO_TAGS_CLEAR = '[&_[data-testid=course-hero-tags]]:pr-20';

/**
 * The facts strip's cells at each count (the member's): from 360px, `--facts` equal columns that are
 * never narrower than their content (`minmax(max-content, 1fr)`), so "Intermediário" never overflows.
 */
const FACTS_GRID =
  'min-[360px]:grid-cols-[repeat(var(--facts),minmax(max-content,1fr))] min-[360px]:divide-x min-[360px]:divide-y-0';

export interface CoursePageProps {
  course: CourseDetail;
  /** The provider thumbnail of every READY lesson video, minted by the server for this render. */
  thumbnails: Readonly<Record<string, string>>;
  /** "9 de outubro de 2026" in the tenant's timezone, only on a published course. */
  publishedAtLabel: string | null;
  /** The linked products' names while the store is on; empty → the plain publish body (D-405). */
  gatedProducts: readonly string[];
}

/** Aulas · Duração · Nível: one outlined card with rules between the cells, a list below 360px. */
function FactsStrip({ facts }: { facts: CourseFactCell[] }) {
  return (
    <dl
      data-testid="course-facts"
      className={cn(
        'mx-4 mt-4 grid grid-cols-1 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card',
        FACTS_GRID,
      )}
      style={{ '--facts': facts.length } as CSSProperties}
    >
      {facts.map((fact) => (
        <div
          key={fact.key}
          data-testid="course-fact"
          data-fact={fact.key}
          className="flex min-w-0 items-center justify-between gap-3 px-4 py-2.5 min-[360px]:flex-col-reverse min-[360px]:justify-center min-[360px]:gap-0.5 min-[360px]:px-2 min-[360px]:py-3 min-[360px]:text-center"
        >
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
            {fact.label}
          </dt>
          <dd className="m-0 whitespace-nowrap text-base font-extrabold leading-tight text-text tabular-nums">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A section's title row: the admin's 18/800 heading and, on the right, its "Editar" door. */
function SectionHead({
  id,
  title,
  edit,
}: {
  id: string;
  title: string;
  edit: { href: string; label: string; ariaLabel: string; testId: string };
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <SectionTitle id={id} variant="group" className={cn(SECTION_TITLE, 'min-w-0 break-words')}>
        {title}
      </SectionTitle>
      <a
        href={edit.href}
        aria-label={edit.ariaLabel}
        data-testid={edit.testId}
        className="group -my-2.5 inline-flex min-h-11 shrink-0 items-center focus-visible:outline-none"
      >
        <span className={cn(TINT_EDIT, PILL_FOCUS)}>
          <Pencil aria-hidden size={11} className="shrink-0" />
          {edit.label}
        </span>
      </a>
    </div>
  );
}

/**
 * The course page's client shell (08.3-08, UI-D-394, UI-D-409, UI-D-411): the `PageHeader` (back to
 * the courses list, the title truncated, the `Pencil` edit link), the hero, the tagline, the pills
 * (status; level and "{N} h" only when set), the action zone (`PublishZone`) and the curriculum
 * editor. Text safety: the title, the tagline and the instructor's name render as React text
 * (T-08.3-25).
 *
 * 2026-10-22 (the courses area redesign on the social-igoralves prototype): the hero is the SAME
 * full-bleed `CourseHero` the member sees — the cover edge to edge at 16:10 (the tenant gradient
 * without one), the category as a glass chip, and over the foot the line "{N} módulos · {N} aulas ·
 * {duration}", the title and the instructor — so the admin reads the course as it is shown. Under
 * it: the tagline, the pills, the `PublishZone` in an outlined card, and the curriculum as module
 * bands over the course's art. `course-hero`, `course-hero-fallback`, `course-title` and
 * `course-instructor` keep their names.
 *
 * 2026-10-23 (the reference's course page, with no editing on the page itself): the page reads like
 * the member's, and each block has a door to the form section that edits it.
 *
 *  - the header's right side: the pill "Ver como aluno" (`course-view-as-member`, moved from
 *    `PublishZone`) to `/cursos/{id}?ver=aluno`, only on a PUBLISHED course (the member view of a
 *    draft is a 404);
 *  - the hero's glass "Editar" in the top-right corner (`course-edit`, moved from the header's
 *    `Pencil`, now named "Editar a capa e as informações do curso") to `/cursos/{id}/editar`;
 *  - the tagline and the status pill, then the facts strip Aulas · Duração · Nível (the member's:
 *    the certificate hours, else the ready videos' sum, else no cell; a list below 360px). The level
 *    and "{N} h" pills left: the strip says both, once;
 *  - "Sobre o curso" (three lines and "Ler mais") with "Editar" to `/editar#descricao`, and "O que
 *    você vai dominar" (brand checks) with "Editar" to `/editar#resultados`, each only with content;
 *  - the `PublishZone` card (publish and unpublish only), then the curriculum editor as before.
 *
 * Every door is a link (a route) with a 44px hit area and its own accessible name; the header's
 * "Nova …" style brand fill is not used here, the doors are glass or the brand's tint.
 *
 * 2026-10-23 (the wide desktop pages, the member's course page's frame): a WIDE page
 * (`data-shell-wide`). From `md` the hero is inset by the 16px gutter and rounded (its "Editar" door
 * follows it), panoramic from `lg`. The facts strip and the publish card now sit together right
 * under the tagline (on the phone too: publishing is the page's first action), and from `lg` they
 * are the sticky right column (340px, 380px from `xl`) beside "Sobre o curso", "O que você vai
 * dominar" and the curriculum editor. A grid with the DOM in the phone's order.
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
  const courseHref = `/cursos/${encodeURIComponent(course.id)}`;
  const editHref = `${courseHref}/editar`;
  // The list row's own line ("{N} módulos · {N} aulas · {duration}"), the API's counts as they are.
  const overline = courseRowView(course, t as never).meta;
  const facts = courseFactsView(course, t as never);
  const description = course.description.trim() ? course.description : null;
  const outcomes = course.outcomes.filter((outcome) => outcome.trim() !== '');
  const editLabel = t('courses.course.editSection.label');

  return (
    <div data-testid="course-page" data-shell-wide className="mx-auto flex w-full flex-col pb-6">
      <PageHeader
        title={course.title}
        backHref="/cursos"
        backLabel={t('courses.course.back')}
        className="md:px-0"
        trailing={
          course.status === 'published' ? (
            <a
              href={`${courseHref}?ver=aluno`}
              data-testid="course-view-as-member"
              className="group inline-flex min-h-11 shrink-0 items-center focus-visible:outline-none"
            >
              <span className={cn(VIEW_AS_MEMBER_PILL, PILL_FOCUS)}>
                <Eye aria-hidden size={14} className="shrink-0" />
                {t('courses.course.viewAsMember')}
              </span>
            </a>
          ) : undefined
        }
      />

      <div className="md:px-4 md:pt-1">
        <div className={cn('relative', HERO_TAGS_CLEAR)}>
          <CourseHero
            coverAssetId={course.coverAssetId}
            coverAlt={coverAlt}
            category={course.category?.name?.trim() ? course.category.name : null}
            overline={overline}
            title={course.title}
            instructorLine={t('courses.course.instructor', { instructor: course.instructorName })}
            instructorPhotoAssetId={course.instructorPhotoAssetId}
            testIds={{
              root: 'course-hero',
              fallback: 'course-hero-fallback',
              tags: 'course-hero-tags',
              overline: 'course-overline',
              title: 'course-title',
              instructor: 'course-instructor',
            }}
          />
          {/* The door at the chips' inset (12px), the category's mirror; its hit area is 44px. */}
          <a
            href={editHref}
            aria-label={t('courses.course.editSection.hero')}
            data-testid="course-edit"
            className="group absolute top-0 right-0 flex min-h-11 min-w-11 items-start justify-end p-3 focus-visible:outline-none"
          >
            <span className={cn(GLASS_EDIT, PILL_FOCUS)}>
              <Pencil aria-hidden size={11} className="shrink-0" />
              {editLabel}
            </span>
          </a>
        </div>
      </div>

      <div className="flex flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:grid-rows-[auto_1fr] lg:items-start xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-3 px-4 pt-4 lg:col-start-1 lg:row-start-1 lg:pt-6">
          {course.tagline ? (
            <p
              data-testid="course-tagline"
              className="break-words text-sm font-normal leading-relaxed text-text-secondary"
            >
              {course.tagline}
            </p>
          ) : null}
          <div data-testid="course-pills" className="flex flex-wrap items-center gap-2">
            <StatusPill tone={status.tone} data-testid="course-status-pill" data-tone={status.tone}>
              {status.label}
            </StatusPill>
          </div>
        </div>

        <div className="flex flex-col lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:pt-2">
          <FactsStrip facts={facts} />
          <div className="px-4 pt-4">
            <Card
              data-testid="course-actions"
              className="flex flex-col gap-3 rounded-2xl border border-border p-4 shadow-none"
            >
              <PublishZone
                courseId={course.id}
                status={course.status}
                publishedAtLabel={publishedAtLabel}
                lessons={publishBlockedLessons(course.modules, course.id)}
                unreadyLessonIds={course.unreadyLessonIds}
                gatedProducts={gatedProducts}
              />
            </Card>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-7 pt-7 lg:col-start-1 lg:row-start-2">
          {description ? (
            <section aria-labelledby="course-about" className="flex flex-col px-4">
              <SectionHead
                id="course-about"
                title={t('courses.member.course.about')}
                edit={{
                  href: `${editHref}#descricao`,
                  label: editLabel,
                  ariaLabel: t('courses.course.editSection.about'),
                  testId: 'course-edit-about',
                }}
              />
              <ReadMoreText
                id="course-about-text"
                data-testid="course-description"
                text={description}
                moreLabel={t('courses.member.readMore')}
                lessLabel={t('courses.member.readLess')}
              />
            </section>
          ) : null}

          {outcomes.length > 0 ? (
            <section aria-labelledby="course-outcomes" className="flex flex-col px-4">
              <SectionHead
                id="course-outcomes"
                title={t('courses.member.course.outcomes')}
                edit={{
                  href: `${editHref}#resultados`,
                  label: editLabel,
                  ariaLabel: t('courses.course.editSection.outcomes'),
                  testId: 'course-edit-outcomes',
                }}
              />
              <ul
                aria-labelledby="course-outcomes"
                data-testid="course-outcomes"
                className="flex flex-col gap-2.5"
              >
                {outcomes.map((outcome, index) => (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: outcomes may repeat; order is the identity.
                    key={index}
                    className="flex items-start gap-2.5 text-sm font-normal leading-relaxed text-text-secondary [overflow-wrap:anywhere]"
                  >
                    <Check
                      aria-hidden
                      size={16}
                      strokeWidth={2.5}
                      className="mt-0.5 shrink-0 text-brand"
                    />
                    <span className="min-w-0">{outcome}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <div className="px-4">
            <CurriculumEditor
              courseId={course.id}
              courseTitle={course.title}
              modules={course.modules}
              thumbnails={thumbnails}
              coverAssetId={course.coverAssetId}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
