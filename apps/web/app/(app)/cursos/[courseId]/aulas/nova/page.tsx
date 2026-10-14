import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { LessonForm } from '@/app/(app)/cursos/[courseId]/aulas/LessonForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getCourse } from '@/lib/courses';

/**
 * `/cursos/[courseId]/aulas/nova?modulo={moduleId}` (08.3-09, D-407, D-409, UI-D-398, COURSE-06):
 * the create half of the lesson form, reached from a module card's "Nova aula" row.
 *
 * **Permission first, then the read** (the loja posture): the gate of `cursos/layout.tsx` is
 * repeated here so a refused caller's request never fires the course read. The course is read for
 * the header's subtitle ("Módulo {position} · {module}") and for whether a product gates it (the free
 * switch's helper, D-407); `modulo` must name one of the course's LIVE modules, else the segment's
 * one not-found renders — a removed module cannot take a new lesson, and an id from another course
 * (or tenant) is indistinguishable from an unknown one (D-23).
 *
 * `hasProducts` is true only while the store is ON and the course links a product (D-405: with the
 * store off every course is open, so "Aula aberta" would promise a gate that does not exist).
 */
export default async function NewLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ modulo?: string | string[] }>;
}) {
  const [{ courseId }, query, bootstrap] = await Promise.all([
    params,
    searchParams,
    requireBootstrap(),
  ]);
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }
  const moduleId = typeof query.modulo === 'string' ? query.modulo : null;
  if (!moduleId) notFound();

  const result = await getCourse(courseId);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled' || result.status === 'not-found') notFound();
  if (result.status === 'error') throw new Error('courses.course_unavailable');

  const index = result.course.modules.findIndex((module) => module.id === moduleId);
  if (index < 0) notFound();
  const module = result.course.modules[index];
  if (!module) notFound();

  const storeOn = bootstrap.modules.some((entry) => entry.key === 'store');

  return (
    <LessonForm
      mode="create"
      courseId={result.course.id}
      moduleId={module.id}
      moduleTitle={module.title}
      modulePosition={index + 1}
      hasProducts={storeOn && result.course.products.length > 0}
    />
  );
}
