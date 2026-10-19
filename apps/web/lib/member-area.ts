/**
 * The member side of the school area (user decision 2026-10-19, quick 261019-k7x).
 *
 * The member's "area de membros" (Inicio, Cursos, Trilhas, Lives, Progresso) lives at
 * `/area-membros`. `/cursos` stays the admin hub (authoring) and the shared detail routes
 * (`/cursos/{id}`, `/cursos/{id}/aulas/{lessonId}`, `/cursos/lives/{id}`). `/membros` must NEVER be
 * used for this: it is the staff-only member directory.
 *
 * A zero-dependency leaf on purpose: client components (ReminderToggle) and the server layout import
 * it without pulling the view layer.
 */
import type { TabOverride } from '@rede-social/core/ui';

export const MEMBER_AREA_PATH = '/area-membros';

/**
 * The bottom bar's school tab, per role (QD-01). The courses manifest nav is one entry for every role
 * (Cursos, `/cursos`), so the host rewrites it per request: a member or support_tenant gets the tab
 * named `label` ("Membros") pointing at the member area, still current on every `/cursos/*` page (the
 * course, the player and the live page are shared with the admin); an admin_tenant (`canManage`)
 * keeps the manifest tab as built, so the override is empty. The key `courses` is the courses module's
 * tab key; the `matches` entry is the admin hub path, which is also the prefix of the shared detail
 * routes.
 */
export function memberAreaTabOverrides({
  canManage,
  label,
}: {
  canManage: boolean;
  label: string;
}): Record<string, TabOverride> {
  if (canManage) return {};
  return { courses: { href: MEMBER_AREA_PATH, label, matches: ['/cursos'] } };
}
