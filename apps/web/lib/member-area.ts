/**
 * The member side of the school area (user decision 2026-10-19, quick 261019-k7x) and, since
 * 2026-10-22, the ONE place that knows the path of every screen of the courses area.
 *
 * The member's "area de membros" (Inicio, Cursos, Trilhas, Lives, Progresso) lives at
 * `/area-membros`. `/cursos` stays the admin hub (authoring) and the shared detail routes
 * (`/cursos/{id}`, `/cursos/{id}/aulas/{lessonId}`, `/cursos/lives/{id}`). `/membros` must NEVER be
 * used for this: it is the staff-only member directory.
 *
 * **One path per screen (2026-10-22, the courses redesign on the social-igoralves prototype).** The
 * member's five screens and the admin's three are no longer tabs of one page (`?aba=`) but pages of
 * their own, like the prototype and like Eventos. `MEMBER_SCREENS` and `ADMIN_SCREENS` are the
 * registries (ORDER IS THE CONTRACT: the member's is the menu's order); `memberScreenHref` and
 * `adminScreenHref` build every link to them; `memberScreenFromAba` and `adminScreenFromAba` read the
 * OLD `?aba=` (the same rules the tab registries had: only a single known value counts), so a
 * bookmarked or shared link still lands on its screen through the pages' redirects.
 *
 * **"Gerenciar" (2026-10-23, the reference's model).** One menu for every role, "· Membros" (the
 * TopBar's area menu and the rail's sub-lines): the member's five screens and, for a manager, a last
 * row "Gerenciar" (`MANAGE_PATH`), the hub whose cards lead to the management lists.
 *
 * A zero-dependency leaf on purpose: client components (ReminderToggle) and the server layout import
 * it without pulling the view layer.
 *
 * The shell's side lives here too: `coursesAreas` is the courses tab's AREA and
 * `memberAreaTabOverrides` the tab itself.
 */
import type { NavArea, TabOverride } from '@rede-social/core/ui';

export const MEMBER_AREA_PATH = '/area-membros';

/**
 * A manager's "Ver como aluno" (UI-D-437): `?ver=aluno` on a member screen renders it as a member
 * sees it, writing nothing. Moved here from `courses-member-view.ts` (which re-exports it) so the
 * href builders below and the client components share one spelling.
 */
export const PREVIEW_PARAM = 'ver';
export const PREVIEW_VALUE = 'aluno';

/** The member area's screens, in the menu's order. `icon` is a kernel nav icon name. */
export const MEMBER_SCREENS = [
  {
    key: 'inicio',
    path: MEMBER_AREA_PATH,
    icon: 'home',
    labelKey: 'courses.member.area.screens.home',
  },
  {
    key: 'cursos',
    path: `${MEMBER_AREA_PATH}/cursos`,
    icon: 'graduation-cap',
    labelKey: 'courses.member.area.screens.courses',
  },
  {
    key: 'trilhas',
    path: `${MEMBER_AREA_PATH}/trilhas`,
    icon: 'route',
    labelKey: 'courses.member.area.screens.tracks',
  },
  {
    key: 'lives',
    path: `${MEMBER_AREA_PATH}/lives`,
    icon: 'radio',
    labelKey: 'courses.member.area.screens.lives',
  },
  {
    key: 'progresso',
    path: `${MEMBER_AREA_PATH}/progresso`,
    icon: 'trending-up',
    labelKey: 'courses.member.area.screens.progress',
  },
] as const;

export type MemberScreen = (typeof MEMBER_SCREENS)[number]['key'];

/** The admin's screens (authoring), in the menu's order. */
export const ADMIN_SCREENS = [
  {
    key: 'cursos',
    path: '/cursos',
    icon: 'graduation-cap',
    labelKey: 'courses.area.screens.courses',
  },
  {
    key: 'trilhas',
    path: '/cursos/trilhas',
    icon: 'route',
    labelKey: 'courses.area.screens.tracks',
  },
  { key: 'lives', path: '/cursos/lives', icon: 'radio', labelKey: 'courses.area.screens.lives' },
] as const;

export type AdminScreen = (typeof ADMIN_SCREENS)[number]['key'];

/** A query value worth keeping: one non-empty string. A repeated or empty param is dropped. */
function single(value: string | string[] | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * The href of a member screen. `categoria` is kept only on Cursos and `trilha` only on Trilhas (each
 * is the one screen that reads it); a manager's preview adds `ver=aluno`, always LAST. Values are
 * encoded by `URLSearchParams`, so a value shaped like a URL stays a value.
 */
export function memberScreenHref(
  screen: MemberScreen,
  query: { categoria?: string | string[] | null; trilha?: string | string[] | null } = {},
  preview = false,
): string {
  const path = MEMBER_SCREENS.find((item) => item.key === screen)?.path ?? MEMBER_AREA_PATH;
  const search = new URLSearchParams();
  const categoria = single(query.categoria);
  const trilha = single(query.trilha);
  if (screen === 'cursos' && categoria) search.set('categoria', categoria);
  if (screen === 'trilhas' && trilha) search.set('trilha', trilha);
  if (preview) search.set(PREVIEW_PARAM, PREVIEW_VALUE);
  const encoded = search.toString();
  return encoded ? `${path}?${encoded}` : path;
}

/** The href of an admin screen; `filtro` (each list's own chips) is kept when it is one value. */
export function adminScreenHref(
  screen: AdminScreen,
  query: { filtro?: string | string[] | null } = {},
): string {
  const path = ADMIN_SCREENS.find((item) => item.key === screen)?.path ?? '/cursos';
  const filtro = single(query.filtro);
  return filtro ? `${path}?${new URLSearchParams({ filtro }).toString()}` : path;
}

/**
 * The OLD `?aba=` of the member area → its screen (EP-01, EP-02, EP-03, unchanged): only a SINGLE
 * string equal to a known key opens that screen; anything else (no value, an empty one, an unknown
 * one, a repeated param, another case) reads as Início.
 */
export function memberScreenFromAba(value: string | string[] | undefined): MemberScreen {
  if (typeof value !== 'string') return 'inicio';
  const found = MEMBER_SCREENS.find((item) => item.key === value);
  return found ? found.key : 'inicio';
}

/** The OLD `?aba=` of the admin hub → its screen; anything but one known key reads as Cursos. */
export function adminScreenFromAba(value: string | string[] | undefined): AdminScreen {
  if (typeof value !== 'string') return 'cursos';
  const found = ADMIN_SCREENS.find((item) => item.key === value);
  return found ? found.key : 'cursos';
}

/**
 * 2026-10-23 — "Gerenciar" (the social-igoralves reference's management hub): the manager's ONE door
 * to authoring, the last row of the courses area's menu. Its page lists the four management screens;
 * the row stays current on each of them (`MANAGEMENT_PATHS`, exact paths: their detail pages and
 * forms mark no row).
 */
export const MANAGE_PATH = '/cursos/gerenciar';

/** The pages "Gerenciar" gathers: the hub and the four management lists (exact paths). */
export const MANAGEMENT_PATHS = [
  MANAGE_PATH,
  '/cursos',
  '/cursos/trilhas',
  '/cursos/lives',
  '/cursos/categorias',
] as const;

/**
 * The bottom bar's school tab (QD-01). The courses manifest nav is one entry for every role (Cursos,
 * `/cursos`), so the host rewrites it per request: the tab is named `label` ("Membros") and points at
 * the member area, still current on every `/cursos/*` page (the course, the player and the live page
 * are shared with the admin, and the management pages live there). The key `courses` is the courses
 * module's tab key.
 *
 * 2026-10-23: the SAME tab for a manager (`canManage`): the manager now browses the member area as a
 * member sees it, and manages through the menu's "Gerenciar" (the reference's model), so the tab
 * leads where the member's does.
 */
export function memberAreaTabOverrides({
  label,
}: {
  canManage: boolean;
  label: string;
}): Record<string, TabOverride> {
  return { courses: { href: MEMBER_AREA_PATH, label, matches: ['/cursos'] } };
}

/**
 * The courses tab's AREA, worded by `t` (the root translator); the host adds the tab key
 * (`registry.tsx`, `areasFor`): "Membros" with the five member screens, the reference's menu.
 *
 * 2026-10-23: one area for every role. A manager's member rows keep `ver=aluno` (the shared course,
 * lesson and live pages open the member's side with it) and the menu ends with "Gerenciar"
 * (`MANAGE_PATH`), current on the management pages (`MANAGEMENT_PATHS`). The authoring area
 * "· Cursos" (Cursos, Trilhas, Lives) and the `within` preview variant are gone.
 *
 * The screen keys are prefixed by side (`member-*`, `manage`): a key names one row of the menu.
 */
export function coursesAreas({
  canManage,
  t,
}: {
  canManage: boolean;
  t: (key: string) => string;
}): Omit<NavArea, 'key'>[] {
  const screens = MEMBER_SCREENS.map((screen) => ({
    key: `member-${screen.key}`,
    href: memberScreenHref(screen.key, {}, canManage),
    icon: screen.icon,
    label: t(screen.labelKey),
  }));
  const manage = {
    key: 'manage',
    href: MANAGE_PATH,
    icon: 'sliders-horizontal',
    label: t('courses.manage.title'),
    matches: [...MANAGEMENT_PATHS],
  };
  return [
    {
      label: t('courses.member.area.label'),
      menuLabel: t('courses.member.area.menu'),
      screens: canManage ? [...screens, manage] : screens,
    },
  ];
}
