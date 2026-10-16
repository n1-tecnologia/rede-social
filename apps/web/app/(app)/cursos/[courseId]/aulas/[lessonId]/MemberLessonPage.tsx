import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { LearnLesson } from '@rede-social/module-courses/contracts';
import { MemberLessonRow } from '@rede-social/module-courses/ui';
import { buttonClasses, Card, PageHeader, SectionTitle, StatusPill } from '@rede-social/ui';
import { ChevronRight, User } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { PreviewBanner } from '@/app/(app)/cursos/PreviewBanner';
import { ReadMoreText } from '@/app/(app)/cursos/ReadMoreText';
import { lessonNavView, lessonPageView } from '@/lib/courses-member-view';
import type { CoursesTranslator } from '@/lib/courses-view';
import { CompletionZone } from './CompletionZone';
import { LessonNav } from './LessonNav';
import { LessonPlayer } from './LessonPlayer';
import { LessonSessionProvider } from './LessonSession';
import { MemberMaterials } from './MemberMaterials';

/**
 * The member's lesson player (08.5-08, UI-D-432, UI-D-433, D-427, D-429, D-430, COURSE-19): what a
 * member, a `support_tenant` or a previewing `admin_tenant` sees at `/cursos/[courseId]/aulas/
 * [lessonId]` for a lesson the API OPENED (`GET /v1/courses/learn/lessons/{id}`), the prototype's
 * player section by section on the shipped player and the store's owned block:
 *
 *  - `PageHeader` (back "Voltar para o curso", the COURSE title truncated) and, in preview, the
 *    `PreviewBanner` (UI-D-437);
 *  - the media block — `LessonPlayer` (the shipped `VideoPlayer`, resumed, with the progress writes)
 *    — only when the lesson has a video (E09 empty: none → no block);
 *  - the identity: the `neutral` pills ("Módulo {nn}", "Aula {nn}", "Aula aberta" / "Prática"), the
 *    duration, the title 24/700 wrapping anywhere, the instructor line;
 *  - the completion zone (absent in preview, D-422), then "Sobre esta aula" with "Ler mais" (absent
 *    when empty), "Materiais desta aula" (absent without materials), "Neste módulo" with the current
 *    row (`aria-current="page"`) and "Ver o curso completo", and previous / next.
 *
 * Every word is built by `lessonPageView` / `lessonNavView` from the API's answer; the web decides
 * no lock and no completion. Text safety: titles, descriptions and file names are React text.
 * The session provider is keyed by the lesson id, so another lesson starts a fresh session.
 */
export interface MemberLessonPageProps {
  lesson: LearnLesson;
  /** An `admin_tenant` at `?ver=aluno`: the banner, no completion zone, no write (UI-D-437). */
  preview: boolean;
}

/** "Ver o curso completo": the `ghost sm` look from `buttonClasses`, 44px hit area (UI-D-443). */
const GHOST_SM_LINK = buttonClasses({
  variant: 'ghost',
  size: 'sm',
  hitArea: true,
  className: 'gap-1 self-center',
});

export async function MemberLessonPage({ lesson, preview }: MemberLessonPageProps) {
  const t = (await getTranslations()) as unknown as CoursesTranslator;
  const view = lessonPageView(lesson, t, { preview });
  const nav = lessonNavView(lesson, t, { preview });

  return (
    <LessonSessionProvider
      key={lesson.id}
      courseHref={view.courseHref}
      initialCompleted={view.completed}
    >
      <div
        data-testid="member-lesson-page"
        data-lesson-id={lesson.id}
        className="mx-auto flex w-full max-w-[680px] flex-col pb-6"
      >
        <PageHeader
          title={view.courseTitle}
          backHref={view.courseHref}
          backLabel={t('courses.member.player.back')}
          stickyTop="0px"
          className="md:static md:px-0"
        />
        {preview ? <PreviewBanner courseId={view.courseId} /> : null}

        {view.video ? (
          <div className={preview ? 'pt-3' : undefined}>
            <LessonPlayer
              lessonId={lesson.id}
              assetId={view.video.assetId}
              status={view.video.status}
              startTime={view.video.startTime}
              writes={!preview}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2 px-4 pt-4">
          <div data-testid="member-lesson-pills" className="flex flex-wrap items-center gap-1">
            {view.pills.map((pill) => (
              <StatusPill key={pill} tone="neutral">
                {pill}
              </StatusPill>
            ))}
            {view.duration ? (
              <span className="ml-1 text-xs font-normal text-text-tertiary tabular-nums">
                {view.duration}
              </span>
            ) : null}
          </div>
          <h1
            data-testid="member-lesson-title"
            data-brand-title
            className="text-2xl font-bold leading-tight tracking-[-0.02em] text-text [overflow-wrap:anywhere]"
          >
            {view.title}
          </h1>
          <p
            data-testid="member-lesson-instructor"
            className="flex items-center gap-2 text-sm font-normal text-text"
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-bg-tertiary">
              {view.instructorPhotoAssetId ? (
                <MediaImage
                  assetId={view.instructorPhotoAssetId}
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
            <span className="min-w-0 break-words">{view.instructorLine}</span>
          </p>
        </div>

        {preview ? null : <CompletionZone lessonId={lesson.id} moduleBar={view.moduleBar} />}

        <div className="flex flex-col gap-6 pt-6">
          {view.description ? (
            <section aria-labelledby="lesson-about" className="flex flex-col gap-2 px-4">
              <SectionTitle id="lesson-about">{t('courses.member.player.about')}</SectionTitle>
              <ReadMoreText
                id="lesson-about-text"
                data-testid="member-lesson-description"
                text={view.description}
                moreLabel={t('courses.member.readMore')}
                lessLabel={t('courses.member.readLess')}
              />
            </section>
          ) : null}

          {view.materials.length > 0 ? (
            <MemberMaterials
              lessonId={lesson.id}
              materials={view.materials}
              countLabel={view.materialsCount}
            />
          ) : null}

          <section
            aria-labelledby="lesson-module"
            data-testid="lesson-module-list"
            className="flex flex-col gap-3 px-4"
          >
            <div className="flex items-baseline justify-between gap-3">
              <SectionTitle id="lesson-module">{t('courses.member.player.inModule')}</SectionTitle>
              <span className="min-w-0 truncate text-xs font-normal text-text-tertiary">
                {view.moduleTitle}
              </span>
            </div>
            <Card className="p-1">
              <ol aria-labelledby="lesson-module" className="flex flex-col">
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
            <a href={view.courseHref} data-testid="lesson-see-course" className={GHOST_SM_LINK}>
              {t('courses.member.player.seeCourse')}
              <ChevronRight aria-hidden size={16} />
            </a>
          </section>
        </div>

        <LessonNav nav={nav} />
      </div>
    </LessonSessionProvider>
  );
}
