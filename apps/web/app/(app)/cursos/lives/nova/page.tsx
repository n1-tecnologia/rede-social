import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound } from 'next/navigation';
import { LiveForm } from '@/app/(app)/cursos/lives/LiveForm';
import { requireBootstrap } from '@/lib/bootstrap';

/**
 * `/cursos/lives/nova` (08.3-11, D-416, D-418, UI-D-403, UI-D-418, COURSE-11): the create half of the
 * live form.
 *
 * The gate is `cursos/layout.tsx`'s (module on AND `courses.manage`); it is repeated here because Next
 * renders the layout and the page CONCURRENTLY, so a refused caller never sees the form before the
 * layout's `notFound()` lands. Same cached bootstrap, no second call.
 *
 * The form receives the TENANT's timezone (`bootstrap.tenant.timezone`): the date and time inputs are
 * that zone's wall clock and the submit builds the ISO instant from them (UI-D-403). Create mode has
 * no Acesso block at all (UI-D-418): a live is linked to a product only from the product form in the
 * Loja (D-418), so no product list is loaded here.
 */
export default async function NewLivePage() {
  const bootstrap = await requireBootstrap();
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }

  return (
    <LiveForm
      mode="create"
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
    />
  );
}
