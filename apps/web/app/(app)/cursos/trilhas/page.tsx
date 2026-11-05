import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import { memberScreenHref, PREVIEW_VALUE } from '@/lib/member-area';
import { AdminListScreen } from '../AdminListScreen';

/**
 * `/cursos/trilhas` (2026-10-22, one page per list): the manager's Trilhas list, the hub tab it was
 * (`/cursos?aba=trilhas`, which redirects here) made a page, reached since 2026-10-23 from the
 * "Trilhas" card of "Gerenciar". `AdminListScreen` draws it with `?filtro=` (Ativas · Arquivadas)
 * and the "‹ Gerenciar" way back. The track form stays at
 * `trilhas/nova` and `trilhas/[trackId]`, static and dynamic siblings of this page.
 *
 * The role split (D-419, T-08.5-27): a caller without `courses.manage`, and a manager with
 * `?ver=aluno`, is sent to the member's Trilhas (`/area-membros/trilhas`, keeping a single `trilha`;
 * the preview keeps `ver=aluno`). The module check repeats `layout.tsx`'s, because Next renders the
 * layout and the page concurrently. No `loading.tsx` here on purpose: one in this folder would also
 * cover the track form; the segment's role-neutral `cursos/loading.tsx` frames this page.
 */
export default async function TracksListPage({
  searchParams,
}: {
  searchParams: Promise<{
    filtro?: string | string[];
    trilha?: string | string[];
    ver?: string | string[];
  }>;
}) {
  const [bootstrap, params] = await Promise.all([requireBootstrap(), searchParams]);
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);

  if (!manage || params.ver === PREVIEW_VALUE) {
    redirect(memberScreenHref('trilhas', { trilha: params.trilha }, manage));
  }

  return (
    <AdminListScreen
      screen="trilhas"
      filtro={params.filtro}
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
    />
  );
}
