import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import { memberScreenHref, PREVIEW_VALUE } from '@/lib/member-area';
import { AdminListScreen } from '../AdminListScreen';

/**
 * `/cursos/lives` (2026-10-22, one page per list): the manager's Lives list, the hub tab it was
 * (`/cursos?aba=lives`, which redirects here) made a page, reached since 2026-10-23 from the "Lives"
 * card of "Gerenciar". `AdminListScreen` draws it with `?filtro=` (Próximas · Passadas) in the
 * tenant's timezone, and the "‹ Gerenciar" way back. The live
 * form and the member's live page stay at `lives/nova` and `lives/[liveId]` (the address
 * notifications and pushes carry), static and dynamic siblings of this page.
 *
 * The role split (D-419, T-08.5-27): a caller without `courses.manage`, and a manager with
 * `?ver=aluno`, is sent to the member's Lives (`/area-membros/lives`; the preview keeps `ver=aluno`).
 * The module check repeats `layout.tsx`'s, because Next renders the layout and the page
 * concurrently. No `loading.tsx` here on purpose: one in this folder would also cover the live form
 * and the member's live page; the segment's role-neutral `cursos/loading.tsx` frames this page.
 */
export default async function LivesListPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string | string[]; ver?: string | string[] }>;
}) {
  const [bootstrap, params] = await Promise.all([requireBootstrap(), searchParams]);
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);

  if (!manage || params.ver === PREVIEW_VALUE) redirect(memberScreenHref('lives', {}, manage));

  return (
    <AdminListScreen
      screen="lives"
      filtro={params.filtro}
      tenantName={bootstrap.tenant.displayName}
      timeZone={bootstrap.tenant.timezone}
    />
  );
}
