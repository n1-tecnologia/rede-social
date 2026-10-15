import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireBootstrap } from '@/lib/bootstrap';

/**
 * The school's gate for every `/cursos*` route (08.3-06, D-400, D-401, UI-D-412; 08.5-06, D-419).
 *
 * ONE half since the member phase: `courses` must be in `bootstrap.modules` (the tenant has it on;
 * off is the default). With the module off everyone — member and manager alike — gets the app's
 * generic not-found, and nothing about the school leaks to a DOM that must not know it exists.
 *
 * The 08.3 permission half (`courses.manage`) is gone: `/cursos` opens for every member of a tenant
 * with the module on (D-419), and `page.tsx` splits the roles itself (UI-D-424). Every manager-only
 * page under the segment (`novo`, `editar`, `categorias`, `trilhas/*`, `aulas/nova`, `lives/nova`,
 * and the course, lesson and live pages until their member halves land) carries its OWN permission
 * check, and the API authorises every admin route again.
 *
 * `notFound()` is thrown HERE, in the segment's layout, on purpose (the `loja/layout.tsx` posture):
 * a layout's `notFound()` is caught by the PARENT segment's boundary, not by `cursos/not-found.tsx`,
 * so the module check renders the kernel's generic not-found, never the school's own "Curso
 * indisponível" card — which a page's own `notFound()` (an unknown id, or a member on a manager-only
 * page) does render.
 *
 * `requireBootstrap` is React-cached, so the page below reads the same bootstrap with no second
 * call — and every `/cursos/*` page reads it, which is what keeps the segment dynamic
 * (`scripts/check-static-routes.sh`).
 */
export default async function CoursesLayout({ children }: { children: ReactNode }) {
  const bootstrap = await requireBootstrap();
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  return children;
}
