import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import { MemberCatalogue } from '../cursos/MemberCatalogue';
import { hubTabFromParam, hubTabHref } from '../cursos/tabs';

/**
 * `/area-membros` (quick 261019-k7x, 2026-10-19): the member's school area (Início · Cursos ·
 * Trilhas · Lives · Progresso), moved out of `/cursos` (08.6 D-435, D-400 reversed for the route
 * prefix ONLY; the five chips, the content and the locked-stays-visible rule of 08.5 D-419..D-424 are
 * unchanged). `/cursos` stays the admin hub; `/membros` is the staff directory and is never used here.
 *
 * The view is chosen from the composed `courses.manage` permission only (T-k7x-01): a `member` or
 * `support_tenant` always gets the area (their `?ver=` is ignored); a manager gets it only with
 * `?ver=aluno` ("Ver como aluno", with the preview banner) and is otherwise sent back to the hub tab
 * named by `?aba=`. The predicates here and on `/cursos` are mutually exclusive, so no loop exists.
 */
export default async function MemberAreaPage({
  searchParams,
}: {
  searchParams: Promise<{
    aba?: string | string[];
    categoria?: string | string[];
    trilha?: string | string[];
    ver?: string | string[];
  }>;
}) {
  const [bootstrap, params] = await Promise.all([requireBootstrap(), searchParams]);
  // The module check is `layout.tsx`'s, repeated here because Next renders the layout and the page
  // concurrently (same reason as the hub page): no body read before the not-found lands.
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);

  if (manage && params.ver !== 'aluno') redirect(hubTabHref(hubTabFromParam(params.aba)));

  return (
    <MemberCatalogue
      aba={params.aba}
      categoria={params.categoria}
      trilha={params.trilha}
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
      preview={manage}
    />
  );
}
