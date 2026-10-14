import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { LessonForm } from '@/app/(app)/cursos/[courseId]/aulas/LessonForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLesson } from '@/lib/courses';
import { lessonFormDefaults } from '@/lib/courses-view';

/**
 * `/cursos/[courseId]/aulas/[lessonId]` (08.3-09, D-407, D-409, D-410, UI-D-398, UI-D-399,
 * COURSE-06, COURSE-07): the edit half of the SAME lesson form, reached from a lesson row.
 *
 * **Permission first, then the read** (the loja posture). The lesson detail carries its module (for
 * the subtitle), its materials in order and its course with `hasProducts`; a lesson that is unknown,
 * another tenant's or removed is the API's one bare 404 and renders the segment's "Curso
 * indisponível" card — and so does a lesson that exists but belongs to ANOTHER course than the URL
 * names, so the route under which a lesson is edited is always the course page its saves
 * revalidate. A read FAILURE throws, so a form filled with blanks is never offered over a lesson
 * that is fine.
 *
 * `hasProducts` is the API's reading AND the store being on (D-405, the create page's rule).
 */
export default async function EditLessonPage({
  params,
}: {
  params: Promise<{ courseId: string; lessonId: string }>;
}) {
  const [{ courseId, lessonId }, bootstrap] = await Promise.all([params, requireBootstrap()]);
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
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
