import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { LessonForm } from '@/app/(app)/cursos/[courseId]/aulas/LessonForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getCourse, getLesson } from '@/lib/courses';
import { getLearnLesson } from '@/lib/courses-learn';
import { isPreview } from '@/lib/courses-member-view';
import { isFirstLessonOfCourse, lessonFormDefaults } from '@/lib/courses-view';
import { LessonErrorCard, LessonLocked } from './LessonLocked';
import { MemberLessonPage } from './MemberLessonPage';

/**
 * `/cursos/[courseId]/aulas/[lessonId]` — the role split (08.5-08, UI-D-432, UI-D-424, D-422).
 *
 * **Admin** (08.3-09, D-407, D-409, D-410, UI-D-398, UI-D-399, COURSE-06, COURSE-07): a
 * `courses.manage` holder WITHOUT `?ver=aluno` gets the edit half of the shipped lesson form, exactly
 * as before — permission first, then the read; a lesson that is unknown, another tenant's, removed,
 * or of ANOTHER course than the URL names is the segment's "Aula indisponível"; a read FAILURE
 * throws, so a form filled with blanks is never offered over a lesson that is fine. The course detail
 * is read beside the lesson (08.5-10, D-428, planning decision 1) only to tell the form whether this
 * is the course's first lesson — the sequence switch then says why it is off; the server forces the
 * rule off there anyway (plan 03). A failed course read throws like a failed lesson read.
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
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  if (!manage || query.ver === 'aluno') {
    return renderMemberLesson(courseId, lessonId, isPreview(bootstrap, query.ver), storeOn);
  }

  const [result, courseResult] = await Promise.all([getLesson(lessonId), getCourse(courseId)]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled' || result.status === 'not-found') notFound();
  if (result.status === 'error') throw new Error('courses.lesson_unavailable');
  if (result.lesson.course.id !== courseId) notFound();
  if (courseResult.status === 'redirect') redirect(courseResult.path);
  if (courseResult.status === 'disabled' || courseResult.status === 'not-found') notFound();
  if (courseResult.status === 'error') throw new Error('courses.course_unavailable');

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
      isFirstLesson={isFirstLessonOfCourse(courseResult.course, lesson.id)}
      initial={lessonFormDefaults(lesson)}
    />
  );
}

/** The member branch: the player, the lock page, the lesson not-found or the error card. */
async function renderMemberLesson(
  courseId: string,
  lessonId: string,
  preview: boolean,
  storeOn: boolean,
) {
  const result = await getLearnLesson(lessonId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'not_found' || result.status === 'disabled') notFound();
  if (result.status === 'locked') {
    // UI-D-431: the lock page reads the COURSE outline only, never this lesson's content.
    return (
      <LessonLocked
        courseId={courseId}
        lessonId={lessonId}
        reason={result.reason}
        preview={preview}
        storeOn={storeOn}
      />
    );
  }
  if (result.status === 'error') {
    return <LessonErrorCard courseId={courseId} lessonId={lessonId} preview={preview} />;
  }
  if (result.lesson.courseId !== courseId) notFound();
  return <MemberLessonPage lesson={result.lesson} preview={preview} />;
}
