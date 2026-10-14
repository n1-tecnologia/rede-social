import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { STORE_PERMISSIONS } from '@rede-social/module-store/contracts';
import { notFound, redirect } from 'next/navigation';
import { LiveForm } from '@/app/(app)/cursos/lives/LiveForm';
import { requireBootstrap } from '@/lib/bootstrap';
import { getLessonsForPicker, getLive, listCourseFormProducts } from '@/lib/courses';
import { type CourseFormProduct, liveFormDefaults } from '@/lib/courses-view';

/**
 * `/cursos/lives/[liveId]` (08.3-11, D-416, UI-D-403, COURSE-11): the edit half of the SAME form —
 * the row the Lives tab links to (UI-D-392).
 *
 * **Permission first, then the read** (the loja posture): the gate of `cursos/layout.tsx` is repeated
 * here so a refused caller's request never fires the live read. Every miss is the school's one
 * not-found (an unknown, foreign or vanished live — the API answers one bare 404 for both, D-23); a
 * read FAILURE throws, so a form filled with blanks is never offered over a live that is fine.
 *
 * **The status is the SERVER's** (UI-D-403, UI-D-407): the API projected it against its clock when
 * it answered, and the page hands it to the form with the tenant timezone — the form reads no clock.
 * The replay picker's lessons are read ONLY when the live is `recorded` (the row exists only then);
 * a scheduled, on-air or cancelled live never pays for that read. The product rows arrive while the
 * store is on and the admin manages it (D-405).
 */
export default async function EditLivePage({ params }: { params: Promise<{ liveId: string }> }) {
  const [{ liveId }, bootstrap] = await Promise.all([params, requireBootstrap()]);
  if (
    !bootstrap.modules.some((module) => module.key === 'courses') ||
    !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)
  ) {
    notFound();
  }
  const storeOn = bootstrap.modules.some((module) => module.key === 'store');
  const canManageStore = bootstrap.permissions.includes(STORE_PERMISSIONS.manage);

  const [result, products] = await Promise.all([
    getLive(liveId),
    storeOn && canManageStore
      ? listCourseFormProducts()
      : Promise.resolve<CourseFormProduct[] | null>(null),
  ]);
  if (result.status === 'redirect') redirect(result.path);
  if (result.status === 'disabled') notFound();
  if (result.status === 'not-found') notFound();
  if (result.status === 'error') throw new Error('courses.live_unavailable');

  const live = result.live;
  const lessons = live.status === 'recorded' ? await getLessonsForPicker() : null;

  return (
    <LiveForm
      mode="edit"
      liveId={live.id}
      initial={liveFormDefaults(live, bootstrap.tenant.timezone)}
      status={live.status}
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
      products={products}
      lessons={lessons}
    />
  );
}
