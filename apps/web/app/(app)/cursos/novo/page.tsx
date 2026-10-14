import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { CourseForm } from '@/app/(app)/cursos/CourseForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getCategories } from '@/lib/courses';
import type { CourseFormCategory } from '@/lib/courses-view';

/**
 * `/cursos/novo` (08.3-07, D-418, UI-D-393, UI-D-417, COURSE-02): the create half of the course form.
 *
 * The gate is `cursos/layout.tsx`'s (module on AND `courses.manage`); it is repeated here because
 * Next renders the layout and the page CONCURRENTLY, so without it a refused caller's request would
 * still fire the category read before the layout's `notFound()` lands (the 08.3-06 lesson). Same
 * cached bootstrap, no second call.
 *
 * The picker's rows: the tenant's categories (the API's order). The read never throws: an
 * unreadable list offers no rows and the course still saves. Create mode has no Acesso block at
 * all (UI-D-417): a course is linked to a product only from the product form (D-418).
 */
export default async function NewCoursePage() {
  const bootstrap = await requireBootstrap();
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }

  const categoriesResult = await getCategories();
  if (categoriesResult.status === 'redirect') redirect(categoriesResult.path);
  if (categoriesResult.status === 'disabled') notFound();
  const categories: CourseFormCategory[] =
    categoriesResult.status === 'ok'
      ? categoriesResult.categories.map((category) => ({
          id: category.id,
          name: category.name,
          coverAssetId: category.coverAssetId,
        }))
      : [];

  return (
    <CourseForm mode="create" tenantName={bootstrap.tenant.displayName} categories={categories} />
  );
}
