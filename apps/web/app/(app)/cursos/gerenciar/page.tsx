import { COURSE_PERMISSIONS } from '@rede-social/module-courses/contracts';
import { notFound, redirect } from 'next/navigation';
import { requireBootstrap } from '@/lib/bootstrap';
import { memberScreenHref, PREVIEW_VALUE } from '@/lib/member-area';
import { ManageHub } from './ManageHub';

/**
 * `/cursos/gerenciar` (2026-10-23): "Gerenciar", the manager's management hub (the social-igoralves
 * reference), reached from the last row of the courses area's menu. `ManageHub` draws it.
 *
 * The role split (D-419, T-08.5-27), as on the management lists: a caller without `courses.manage`,
 * and a manager with `?ver=aluno`, is sent to the member area's Início. The module check repeats
 * `layout.tsx`'s, because Next renders the layout and the page concurrently. A static segment, so it
 * wins over `[courseId]`.
 */
export default async function ManagePage({
  searchParams,
}: {
  searchParams: Promise<{ ver?: string | string[] }>;
}) {
  const [bootstrap, params] = await Promise.all([requireBootstrap(), searchParams]);
  if (!bootstrap.modules.some((module) => module.key === 'courses')) notFound();
  const manage = bootstrap.permissions.includes(COURSE_PERMISSIONS.manage);

  if (!manage || params.ver === PREVIEW_VALUE) redirect(memberScreenHref('inicio', {}, manage));

  return <ManageHub />;
}
