import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import {
  adminScreenFromAba,
  adminScreenHref,
  memberScreenFromAba,
  memberScreenHref,
  PREVIEW_VALUE,
} from '@/lib/member-area';
import { AdminListScreen } from './AdminListScreen';

/**
 * `/cursos` (08.3-06, D-402, UI-D-390, COURSE-14): the school's authoring lists. Desktop: the 680px
 * column (D-39, UI-D-411).
 *
 * **2026-10-22 — one page per list (the courses redesign on the social-igoralves prototype).** The
 * hub's three tabs (`?aba=`) became three pages: this one is Cursos; `cursos/trilhas/page.tsx` and
 * `cursos/lives/page.tsx` are the others. Each renders `AdminListScreen` (the screen's header, its
 * create control, chips, list, empty, loading and error states) with the list's `?filtro=`. The OLD
 * `?aba=trilhas|lives` redirects to that list's page, keeping a single-valued `filtro`; anything
 * else reads as Cursos (EP-01). Since 2026-10-23 the lists are reached from the cards of "Gerenciar"
 * (`/cursos/gerenciar`, the "Membros" menu's last row and the Configurações "Cursos" row), and each
 * leads back to it ("‹ Gerenciar").
 *
 * **The role split (D-419, D-420, UI-D-424, T-08.5-27), on the server.** `layout.tsx` keeps only the
 * module check. A caller holding `courses.manage` gets the list unless the URL says `?ver=aluno`;
 * everyone else (`member`, `support_tenant`, and the manager previewing) is redirected to the member
 * area: the screen the OLD `?aba=` named (`/area-membros/cursos`, `/trilhas` …, else the Início),
 * keeping `categoria` only for Cursos and `trilha` only for Trilhas; the preview keeps `ver=aluno`. A
 * member's `?ver=` is ignored (it can only ever choose the member view), and the API still
 * authorises every admin read the list makes.
 */
export default async function CoursesHubPage({
  searchParams,
}: {
  searchParams: Promise<{
    aba?: string | string[];
    filtro?: string | string[];
    categoria?: string | string[];
    trilha?: string | string[];
    ver?: string | string[];
  }>;
}) {
  const [bootstrap, params] = await Promise.all([requireBootstrap(), searchParams]);
  // The module check is `layout.tsx`'s; it is repeated here because Next renders the layout and the
  // page CONCURRENTLY, so without it a request would still fire the body's API reads (each a
  // guaranteed 404) before the layout's `notFound()` lands. Same cached bootstrap, no second call.
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);

  if (!manage || params.ver === PREVIEW_VALUE) {
    redirect(
      memberScreenHref(
        memberScreenFromAba(params.aba),
        { categoria: params.categoria, trilha: params.trilha },
        manage,
      ),
    );
  }

  const screen = adminScreenFromAba(params.aba);
  if (screen !== 'cursos') redirect(adminScreenHref(screen, { filtro: params.filtro }));

  return (
    <AdminListScreen
      screen="cursos"
      filtro={params.filtro}
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
    />
  );
}
