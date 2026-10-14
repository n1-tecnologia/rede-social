import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound, redirect } from 'next/navigation';
import { CourseForm } from '@/app/(app)/cursos/CourseForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getCategories, listCourseFormProducts } from '@/lib/courses';
import type { CourseFormCategory, CourseFormProduct } from '@/lib/courses-view';

/**
 * `/cursos/novo` (08.3-07, D-404, D-405, UI-D-393, COURSE-02): the create half of the course form.
 *
 * The gate is `cursos/layout.tsx`'s (module on AND `courses.manage`); it is repeated here because
 * Next renders the layout and the page CONCURRENTLY, so without it a refused caller's request would
 * still fire the category and product reads before the layout's `notFound()` lands (the 08.3-06
 * lesson). Same cached bootstrap, no second call.
 *
 * The picker's rows: the tenant's categories (the API's order), and the store's ACTIVE products
 * through `getProducts({ filter: 'all' })` — walked by `listCourseFormProducts` — ONLY while the
 * `store` module is on AND the admin holds `store.product.manage` (D-405). Otherwise `products` is
 * null, the Acesso block is absent and the save never sends links. Neither read throws: an
 * unreadable list offers no rows and the course still saves.
 */
export default async function NewCoursePage() {
  const bootstrap = await requireBootstrap();
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const canManageStore = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);

  const [categoriesResult, products] = await Promise.all([
    getCategories(),
    storeOn && canManageStore
      ? listCourseFormProducts()
      : Promise.resolve<CourseFormProduct[] | null>(null),
  ]);
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
    <CourseForm
      mode="create"
      tenantName={bootstrap.tenant.displayName}
      categories={categories}
      products={products}
    />
  );
}
