import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';

/**
 * The school's gate for every `/cursos*` route (08.3-06, D-400, D-401, UI-D-412).
 *
 * Two halves, both required in this phase: `courses` must be in `bootstrap.modules` (the tenant has
 * it on; off is the default) AND the caller must hold the composed `courses.manage` permission (the
 * same value the API's `requirePermission` reads, composed for `admin_tenant` only, D-403). A
 * `member` therefore gets the app's generic not-found, and so does everyone while the module is off
 * — nothing about the school leaks to a DOM that must not know it exists.
 *
 * **The member phase drops the permission half**: once the catalogue, the player and the BottomNav
 * tab exist, `/cursos` opens for every member of a tenant with the module on, and the manager's
 * surfaces (`/cursos/novo`, `…/editar`, the curriculum editor) carry their own permission check.
 *
 * `notFound()` is thrown HERE, in the segment's layout, on purpose (the `loja/layout.tsx` posture):
 * a layout's `notFound()` is caught by the PARENT segment's boundary, not by `cursos/not-found.tsx`,
 * so the gate renders the kernel's generic not-found, never the school's own "Curso indisponível"
 * card, which is reserved for a course, track or live that is unknown or another tenant's.
 *
 * `requireBootstrap` is React-cached, so the page below reads the same bootstrap with no second
 * call — and every `/cursos/*` page reads it, which is what keeps the segment dynamic
 * (`scripts/check-static-routes.sh`).
 */
export default async function CoursesLayout({ children }: { children: ReactNode }) {
  const bootstrap = await requireBootstrap();
  const moduleOn = bootstrap.modules.some((module) => module.key === 'courses');
  if (!moduleOn || !bootstrap.permissions.includes(COURSE_PERMISSIONS.manage)) notFound();
  return children;
}
