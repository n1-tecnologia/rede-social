import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound } from 'next/navigation';
import { LiveForm } from '@/app/(app)/cursos/lives/LiveForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { listCourseFormProducts } from '@/lib/courses';
import type { CourseFormProduct } from '@/lib/courses-view';

/**
 * `/cursos/lives/nova` (08.3-11, D-416, UI-D-403, COURSE-11): the create half of the live form.
 *
 * The gate is `cursos/layout.tsx`'s (module on AND `courses.manage`); it is repeated here because Next
 * renders the layout and the page CONCURRENTLY, so without it a refused caller's request would still
 * fire the product read before the layout's `notFound()` lands. Same cached bootstrap, no second call.
 *
 * The form receives the TENANT's timezone (`bootstrap.tenant.timezone`): the date and time inputs are
 * that zone's wall clock and the submit builds the ISO instant from them (UI-D-403). The product
 * picker's rows arrive ONLY while the `store` module is on AND the admin holds
 * `store.product.manage` (D-405); otherwise `products` is null, the Acesso block is absent and the
 * save never sends links. The read never throws: an unreadable list offers no rows.
 */
export default async function NewLivePage() {
  const bootstrap = await requireBootstrap();
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const canManageStore = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);
  const products: CourseFormProduct[] | null =
    storeOn && canManageStore ? await listCourseFormProducts() : null;

  return (
    <LiveForm
      mode="create"
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
      products={products}
    />
  );
}
