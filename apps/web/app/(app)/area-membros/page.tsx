import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import { memberScreenFromAba, memberScreenHref } from '@/lib/member-area';
import { MemberScreenPage, type MemberScreenParams } from './member-screen';

/**
 * `/area-membros` (quick 261019-k7x, 2026-10-19): the member's school area, moved out of `/cursos`
 * (08.6 D-435, D-400 reversed for the route prefix ONLY; the content and the locked-stays-visible rule
 * of 08.5 D-419..D-424 are unchanged). `/cursos` stays the admin hub; `/membros` is the staff
 * directory and is never used here.
 *
 * **2026-10-22 — the Início only.** Each screen is a page of its own now (`/area-membros/cursos`,
 * `/trilhas`, `/lives`, `/progresso`, reached from the TopBar's "· Membros" menu), so this page is
 * the area's home (`member-screen.tsx` does the gate, the role split and the render). The OLD
 * `?aba=` still lands where it did: a single known screen redirects to that screen's page, keeping
 * `categoria` only for Cursos, `trilha` only for Trilhas and `ver=aluno` for a manager (2026-10-23:
 * a manager browses the member screens too, so it is never sent to the admin lists from here); no
 * value, an empty, unknown or repeated one stays on the Início (EP-01, EP-02, EP-03).
 */
export default async function MemberAreaPage({
  searchParams,
}: {
  searchParams: Promise<MemberScreenParams & { aba?: string | string[] }>;
}) {
  const [bootstrap, params] = await Promise.all([requireBootstrap(), searchParams]);
  // The module check is `layout.tsx`'s, repeated here because Next renders the layout and the page
  // concurrently: no redirect is decided before the not-found of a school that is off.
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();

  const screen = memberScreenFromAba(params.aba);
  if (screen !== 'inicio') {
    const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);
    redirect(
      memberScreenHref(screen, { categoria: params.categoria, trilha: params.trilha }, manage),
    );
  }

  return <MemberScreenPage screen="inicio" params={params} />;
}
