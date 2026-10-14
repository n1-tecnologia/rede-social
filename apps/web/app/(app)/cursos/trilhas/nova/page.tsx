import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound } from 'next/navigation';
import { TrackForm } from '@/app/(app)/cursos/trilhas/TrackForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { listTrackFormCourses } from '@/lib/courses';

/**
 * `/cursos/trilhas/nova` (08.3-10, D-415, UI-D-402, COURSE-10): the create half of the track form.
 *
 * The gate is `cursos/layout.tsx`'s (module on AND `courses.manage`); it is repeated here because Next
 * renders the layout and the page CONCURRENTLY, so without it a refused caller's request would still
 * fire the catalogue read before the layout's `notFound()` lands. Same cached bootstrap, no second
 * call.
 *
 * The picker's rows: the tenant's PUBLISHED courses (`getCourses({ filter: 'published' })`, the first
 * 50 — a draft or archived course never reaches the sheet, so the API's `course_invalid` is explained
 * before it can happen). The read never throws: an unreadable catalogue offers no rows and the track
 * still saves without courses (P40).
 */
export default async function NewTrackPage() {
  const bootstrap = await requireBootstrap();
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }
  const courses = await listTrackFormCourses();

  return <TrackForm mode="create" tenantName={bootstrap.tenant.displayName} courses={courses} />;
}
