import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound, redirect } from 'next/navigation';
import { CourseForm } from '@/app/(app)/cursos/CourseForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getCategories, getCourse, listCourseFormProducts } from '@/lib/courses';
import {
  type CourseFormCategory,
  type CourseFormProduct,
  courseFormDefaults,
} from '@/lib/courses-view';

/**
 * `/cursos/[courseId]/editar` (08.3-07, D-404, D-413, UI-D-393, COURSE-08): the edit half of the
 * SAME form.
 *
 * **Permission first, then the read** (the loja posture): the gate of `cursos/layout.tsx` is
 * repeated here so a refused caller's request never fires the course read. Every miss is the
 * school's one not-found (`cursos/not-found.tsx`: an unknown, foreign or vanished course — the API
 * answers one bare 404 for both, D-23); a read FAILURE throws, so a form filled with blanks is never
 * offered over a course that is fine. An ARCHIVED course is still editable: its form shows the
 * archived note instead of "Arquivar curso" (UI-D-394).
 *
 * The products come from `getProducts({ filter: 'all' })` (through `listCourseFormProducts`) only
 * while the store is on and the admin holds its permission (D-405); the course's saved links ride
 * in `initial.products` either way, so with the store off they stay untouched.
 */
export default async function EditCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const [{ courseId }, bootstrap] = await Promise.all([params, requireBootstrap()]);
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const canManageStore = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);

  const [result, categoriesResult, products] = await Promise.all([
    getCourse(courseId),
    getCategories(),
    storeOn && canManageStore
      ? listCourseFormProducts()
      : Promise.resolve<CourseFormProduct[] | null>(null),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (categoriesResult.status === 'redirect') redirect(categoriesResult.path);
  if (result.status === 'disabled' || categoriesResult.status === 'disabled') notFound();
  if (result.status === 'not-found') notFound();
  if (result.status === 'error') throw new Error('courses.course_unavailable');

  const categories: CourseFormCategory[] =
    categoriesResult.status === 'ok'
      ? categoriesResult.categories.map((category) => ({
          id: category.id,
          name: category.name,
          coverAssetId: category.coverAssetId,
        }))
      : [];

  return (
    <CourseForm
      mode="edit"
      courseId={result.course.id}
      initial={courseFormDefaults(result.course)}
      tenantName={bootstrap.tenant.displayName}
      categories={categories}
      products={products}
      // 08.3-08: the course page exists, so a save and the X close land on it (its toast survives).
      returnHref={`/cursos/${encodeURIComponent(result.course.id)}`}
    />
  );
}
