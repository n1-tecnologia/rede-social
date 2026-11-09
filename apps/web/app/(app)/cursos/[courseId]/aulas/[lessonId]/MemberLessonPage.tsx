import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { LearnLesson } from '@rede-social/module-courses/contracts';
import { MEMBER_CARD, MemberLessonRow } from '@rede-social/module-courses/ui';
import { Card, cn, MemberSkin, PageHeader } from '@rede-social/ui';
import { ChevronRight, Clock, FileText, Paperclip, User } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { MemberSectionHeader } from '@/app/(app)/cursos/MemberSection';
import { ReadMoreText } from '@/app/(app)/cursos/ReadMoreText';
import { getLearnCourse } from '@/lib/courses-learn';
import { lessonNavView, lessonOutlineView, lessonPageView } from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { CompletionZone } from './CompletionZone';
import { LessonNav } from './LessonNav';
import { LessonOutline } from './LessonOutline';
import { LessonPlayer } from './LessonPlayer';
import { LessonSessionProvider } from './LessonSession';
import { LessonTabs } from './LessonTabs';
import { MemberMaterials } from './MemberMaterials';

/**
 * The member's lesson player (08.5-08, UI-D-432, UI-D-433, D-427, D-429, D-430, COURSE-19): what a
 * member, a `support_tenant` or a previewing `admin_tenant` sees at `/cursos/[courseId]/aulas/
 * [lessonId]` for a lesson the API OPENED (`GET /v1/courses/learn/lessons/{id}`).
 *
 * Every word is built by `lessonPageView` / `lessonNavView` / `lessonOutlineView` from the API's
 * answers; the web decides no lock and no completion. Text safety: titles, descriptions and file
 * names are React text. The session provider is keyed by the lesson id, so another lesson starts a
 * fresh session.
 *
 * **2026-10-26 (the academy reference's player, the user's "swap completo").** A WIDE page
 * (`data-shell-full`). From `lg` two columns, as the reference draws them: the video and the lesson
 * at the left, the WHOLE course at the right (`LessonOutline`: every module as a disclosure, the
 * open lesson's module open, a disc per lesson, the course's share on top), sticky while the left
 * scrolls. On a phone the same blocks one under the other, the course list last. The left column:
 *
 *  - the stage (`LessonPlayer`), rounded from `md`;
 *  - the breadcrumb ("{course} › Módulo {nn}"), each part a link back;
 *  - the title (the page's h1), the instructor and the length;
 *  - the row "‹ Aula anterior · 3 de 14 aulas · Próxima aula ›" between hairlines (`LessonNav`);
 *  - the completion zone (absent in preview, D-422);
 *  - "Descrição | Materiais" (`LessonTabs`; one tab alone draws no list).
 *
 * The course list needs the member's course read (`GET /v1/courses/learn/courses/{id}`, titles only,
 * D-423); when it fails, the module's own rows ("Neste módulo") take its place, as before.
 */
export interface MemberLessonPageProps {
  lesson: LearnLesson;
  /** An `admin_tenant` at `?ver=aluno`: no completion zone, no write (UI-D-437); no banner since 2026-10-23. */
  preview: boolean;
}

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

export async function MemberLessonPage({ lesson, preview }: MemberLessonPageProps) {
  const [t, courseResult] = await Promise.all([
    getTranslations() as unknown as Promise<CoursesTranslator>,
    getLearnCourse(lesson.courseId),
  ]);
  const view = lessonPageView(lesson, t, { preview });
  const nav = lessonNavView(lesson, t, { preview });
  const outline =
    courseResult.status === 'ok'
      ? lessonOutlineView(courseResult.course, lesson.id, preview, t)
      : null;

  const description = view.description ? (
    <div className="ms-panel rounded-2xl border border-border p-4 md:p-5">
      <ReadMoreText
        id="lesson-about-text"
        data-testid="member-lesson-description"
        text={view.description}
        moreLabel={t('courses.member.readMore')}
        lessLabel={t('courses.member.readLess')}
      />
    </div>
  ) : null;
  const materials =
    view.materials.length > 0 ? (
      <MemberMaterials
        lessonId={lesson.id}
        materials={view.materials}
        countLabel={view.materialsCount}
      />
    ) : null;
  const tabs = [
    description
      ? {
          key: 'description',
          label: t('courses.member.player.tabs.description'),
          icon: <FileText aria-hidden size={15} />,
          content: description,
        }
      : null,
    materials
      ? {
          key: 'materials',
          label: t('courses.member.player.tabs.materials'),
          icon: <Paperclip aria-hidden size={15} />,
          content: materials,
        }
      : null,
  ].filter((tab) => tab !== null);

  return (
    <LessonSessionProvider
      key={lesson.id}
      courseHref={view.courseHref}
      initialCompleted={view.completed}
    >
      <MemberSkin>
        <div
          data-testid="member-lesson-page"
          data-lesson-id={lesson.id}
          data-shell-full
          className="mx-auto flex w-full flex-col pb-8"
        >
          <PageHeader
            title={view.courseTitle}
            titleAs="p"
            backHref={view.courseHref}
            backLabel={t('courses.member.player.back')}
            className="md:hidden"
          />

          <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6 lg:px-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col">
              {view.video ? (
                <div data-testid="member-lesson-stage" className="md:px-4 md:pt-1 lg:px-0 lg:pt-0">
                  <div className="ms-hero overflow-hidden bg-black md:rounded-3xl md:shadow-lg">
                    <LessonPlayer
                      lessonId={lesson.id}
                      assetId={view.video.assetId}
                      status={view.video.status}
                      startTime={view.video.startTime}
                      writes={!preview}
                    />
                  </div>
                </div>
              ) : null}

              <div
                data-testid="member-lesson-info"
                className="flex min-w-0 flex-col gap-4 px-4 pt-5 lg:px-0"
              >
                <nav
                  aria-label={view.courseTitle}
                  className="flex min-w-0 items-center gap-1.5 text-sm text-text-tertiary"
                >
                  <a
                    href={view.courseHref}
                    className={`min-w-0 truncate rounded-sm hover:text-text ${FOCUS}`}
                  >
                    {view.courseTitle}
                  </a>
                  <ChevronRight aria-hidden size={14} className="shrink-0" />
                  {outline?.moduleHref ? (
                    <a
                      href={outline.moduleHref}
                      className={`min-w-0 truncate rounded-sm hover:text-text ${FOCUS}`}
                    >
                      {view.moduleTitle}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate">{view.moduleTitle}</span>
                  )}
                </nav>
                <h1
                  data-testid="member-lesson-title"
                  data-brand-title
                  className="ms-title-compact text-xl font-extrabold leading-tight tracking-tight text-text md:text-2xl [overflow-wrap:anywhere]"
                >
                  {view.title}
                </h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <p
                    data-testid="member-lesson-instructor"
                    className="flex min-w-0 items-center gap-2 text-sm font-normal text-text-secondary"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary">
                      {view.instructorPhotoAssetId ? (
                        <MediaImage
                          assetId={view.instructorPhotoAssetId}
                          widths={PURPOSE_WIDTHS.cover}
                          alt=""
                          sizes="28px"
                          ratio=""
                          className="h-full w-full"
                        />
                      ) : (
                        <User aria-hidden size={14} className="text-text-tertiary" />
                      )}
                    </span>
                    <span className="min-w-0 break-words">{view.instructorLine}</span>
                  </p>
                  {view.duration ? (
                    <p
                      data-testid="member-lesson-duration"
                      className="ms-chip-surface inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-text-tertiary tabular-nums"
                    >
                      <Clock aria-hidden size={14} className="shrink-0" />
                      {view.duration}
                    </p>
                  ) : null}
                </div>

                <LessonNav nav={nav} position={outline?.position ?? null} />

                {preview ? null : (
                  <CompletionZone lessonId={lesson.id} moduleBar={view.moduleBar} />
                )}

                {tabs.length > 0 ? (
                  <LessonTabs label={t('courses.member.player.tabs.label')} tabs={tabs} />
                ) : null}
              </div>
            </div>

            <aside className="flex flex-col gap-2 px-4 lg:sticky lg:top-4 lg:px-0">
              {outline ? (
                <LessonOutline outline={outline} label={t('courses.member.course.content')} />
              ) : (
                <section
                  aria-labelledby="lesson-module"
                  data-testid="lesson-module-list"
                  className="flex flex-col"
                >
                  <MemberSectionHeader
                    id="lesson-module"
                    title={t('courses.member.player.inModule')}
                    count={view.moduleTitle}
                    className="px-0"
                  />
                  <Card className={cn(MEMBER_CARD, 'ms-panel rounded-2xl p-1.5')}>
                    <ol aria-labelledby="lesson-module" className="flex flex-col gap-1">
                      {view.moduleRows.map((row) => (
                        <li key={row.id}>
                          <MemberLessonRow
                            id={row.id}
                            href={row.href}
                            ariaLabel={row.ariaLabel}
                            title={row.title}
                            meta={row.meta}
                            metaLocked={row.metaLocked}
                            trailing={row.trailing}
                            thumbState={row.thumbState}
                            resumePercent={row.resumePercent}
                            current={row.current}
                            coverAssetId={lesson.coverAssetId}
                            coverWidths={PURPOSE_WIDTHS.cover}
                          />
                        </li>
                      ))}
                    </ol>
                  </Card>
                </section>
              )}
              <a
                href={view.courseHref}
                data-testid="lesson-see-course"
                className={`inline-flex min-h-11 items-center gap-1 self-center rounded-md px-2 text-xs font-semibold text-brand ${FOCUS}`}
              >
                {t('courses.member.player.seeCourse')}
                <ChevronRight aria-hidden size={14} />
              </a>
            </aside>
          </div>
        </div>
      </MemberSkin>
    </LessonSessionProvider>
  );
}
