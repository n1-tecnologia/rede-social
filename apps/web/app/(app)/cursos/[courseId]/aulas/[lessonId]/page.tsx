import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { CircleAlert } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LessonForm } from '@/app/(app)/cursos/[courseId]/aulas/LessonForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLesson } from '@/lib/courses';
import { getLearnLesson } from '@/lib/courses-learn';
import { isPreview, memberCourseHref, memberLessonHref } from '@/lib/courses-member-view';
import { lessonFormDefaults } from '@/lib/courses-view';
import { MemberLessonPage } from './MemberLessonPage';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * `/cursos/[courseId]/aulas/[lessonId]` — the role split (08.5-08, UI-D-432, UI-D-424, D-422).
 *
 * **Admin** (08.3-09, D-407, D-409, D-410, UI-D-398, UI-D-399, COURSE-06, COURSE-07): a
 * `courses.manage` holder WITHOUT `?ver=aluno` gets the edit half of the shipped lesson form, exactly
 * as before — permission first, then the read; a lesson that is unknown, another tenant's, removed,
 * or of ANOTHER course than the URL names is the segment's "Aula indisponível"; a read FAILURE
 * throws, so a form filled with blanks is never offered over a lesson that is fine.
 *
 * **Member** (everyone else, and the `admin_tenant` previewing at `?ver=aluno`): ONE learn read,
 * `GET /v1/courses/learn/lessons/{lessonId}`:
 *  - `not_found` (removed, under a removed module, foreign, crafted id) or a lesson whose `courseId`
 *    is not the URL's course → "Aula indisponível" (`not-found.tsx`, UI-D-441);
 *  - `locked` (403 `lesson_locked` / 409 `lesson_sequence_locked`) → the lock page (UI-D-431);
 *  - a read failure → the shipped course error card with a retry to this URL;
 *  - `ok` → the player (`MemberLessonPage`). A member's `?ver=` is ignored; only an `admin_tenant`
 *    previews (`isPreview`), and the API authorises every read by its own rules anyway.
 */
export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
  searchParams: Promise<{ ver?: string | string[] }>;
}) {
  const [{ courseId, lessonId }, query, bootstrap] = await Promise.all([
    params,
    searchParams,
    requireBootstrap(),
  ]);
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();

  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);
  if (!manage || query.ver === 'aluno') {
    return renderMemberLesson(courseId, lessonId, isPreview(bootstrap, query.ver));
  }

  const result = await getLesson(lessonId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled' || result.status === 'not-found') notFound();
  if (result.status === 'error') throw new Error('courses.lesson_unavailable');
  if (result.lesson.course.id !== courseId) notFound();

  const storeOn = bootstrap.modules.some((entry) => entry.key === 'store');
  const lesson = result.lesson;

  return (
    <LessonForm
      mode="edit"
      courseId={lesson.course.id}
      lessonId={lesson.id}
      moduleId={lesson.module.id}
      moduleTitle={lesson.module.title}
      modulePosition={lesson.module.position}
      hasProducts={storeOn && lesson.course.hasProducts}
      initial={lessonFormDefaults(lesson)}
    />
  );
}

/** The member branch: the player, the lock page, the lesson not-found or the error card. */
async function renderMemberLesson(courseId: string, lessonId: string, preview: boolean) {
  const result = await getLearnLesson(lessonId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'not_found' || result.status === 'disabled') notFound();
  if (result.status === 'locked') {
    // Replaced by the lock page (Task 2, sketch 010): until then the course page says why.
    redirect(memberCourseHref(courseId, preview));
  }
  if (result.status === 'error') {
    const t = await getTranslations('courses');
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col">
        <PageHeader
          backHref={memberCourseHref(courseId, preview)}
          backLabel={t('member.player.back')}
          className="md:static md:px-0"
        />
        <div className="px-4 pt-2">
          <EmptyState
            variant="card"
            icon={CircleAlert}
            data-testid="lesson-error"
            title={t('errors.title')}
            body={t('errors.course')}
            action={
              <a href={memberLessonHref(courseId, lessonId, preview)} className={LINK_OUTLINE}>
                {t('errors.retry')}
              </a>
            }
          />
        </div>
      </div>
    );
  }
  if (result.lesson.courseId !== courseId) notFound();
  return <MemberLessonPage lesson={result.lesson} preview={preview} />;
}
