import { MEMBER_AREA_PATH } from '@/lib/member-area';

/**
 * The `/cursos` hub's area tabs (D-402, UI-D-390): Cursos · Trilhas · Lives, as `href` items
 * (`?aba=<key>`), so a tab change is a navigation and back returns to the previous tab.
 *
 * ORDER IS THE CONTRACT (P57): this array's order is the tab order. Plan 10 appended
 * `{ key: 'trilhas', labelKey: 'courses.hub.tabs.tracks' }` and plan 11 appended
 * `{ key: 'lives', labelKey: 'courses.hub.tabs.lives' }` — in that order, after `cursos` — without
 * touching the page's frame. The member area keeps its own registry below (`COURSE_MEMBER_TABS`).
 *
 * A plain `.ts` module with no React in it, so the server page, the client tabs row and the unit
 * tests all read the same registry.
 */
export const COURSE_HUB_TABS = [
  { key: 'cursos', labelKey: 'courses.hub.tabs.courses' },
  { key: 'trilhas', labelKey: 'courses.hub.tabs.tracks' },
  { key: 'lives', labelKey: 'courses.hub.tabs.lives' },
] as const;

export type CourseHubTab = (typeof COURSE_HUB_TABS)[number]['key'];

/** The default tab: the first of the registry. */
export const DEFAULT_HUB_TAB: CourseHubTab = COURSE_HUB_TABS[0].key;

/**
 * `?aba=` → the tab the page renders (E02 error). Anything but one known key — an unknown value, a
 * repeated one, or none — reads as the default `cursos`.
 */
export function hubTabFromParam(value: string | string[] | undefined): CourseHubTab {
  if (typeof value !== 'string') return DEFAULT_HUB_TAB;
  const found = COURSE_HUB_TABS.find((tab) => tab.key === value);
  return found ? found.key : DEFAULT_HUB_TAB;
}

/** The href of a tab item. */
export function hubTabHref(key: CourseHubTab): string {
  return `/cursos?aba=${key}`;
}

/* ── 08.5-06 / 08.6-08: the member area's tabs (D-420, D-435, UI-D-424, UI-D-446) ─────────────── */

/**
 * The member registry over the same `HubTabs` frame (D-435 reverses 08.5's "Cursos · Lives only",
 * and the member now gets Trilhas too), served at `/area-membros` since 2026-10-19: Início (the bare
 * area, its home and the default) ·
 * Cursos (`?aba=cursos`, the catalogue) · Trilhas (`?aba=trilhas`, 08.6-10, one track at a time
 * chosen by `?trilha=`) · Lives (`?aba=lives`) · Progresso (`?aba=progresso`, 08.6-10). ORDER IS
 * THE CONTRACT (EP-03): a key is registered only once its body exists, so no tab ever opens an
 * empty body (08.6-08 planning decision 1).
 */
export const COURSE_MEMBER_TABS = [
  { key: 'inicio', labelKey: 'courses.hub.tabs.home' },
  { key: 'cursos', labelKey: 'courses.hub.tabs.courses' },
  { key: 'trilhas', labelKey: 'courses.hub.tabs.tracks' },
  { key: 'lives', labelKey: 'courses.hub.tabs.lives' },
  { key: 'progresso', labelKey: 'courses.hub.tabs.progress' },
] as const;

export type CourseMemberTab = (typeof COURSE_MEMBER_TABS)[number]['key'];

/** The member's default tab: Início, the first of the registry (D-435). */
export const DEFAULT_MEMBER_TAB: CourseMemberTab = COURSE_MEMBER_TABS[0].key;

/**
 * `?aba=` → the member tab (UI-D-446, E01 error, EP-01, EP-02): only a SINGLE string equal to a
 * registered key other than `inicio` opens that body; anything else — no value, an empty one, an
 * unknown one (`xyz`, a not-yet-registered key), a repeated param — reads as Início.
 */
export function memberTabFromParam(value: string | string[] | undefined): CourseMemberTab {
  if (typeof value !== 'string' || value === DEFAULT_MEMBER_TAB) return DEFAULT_MEMBER_TAB;
  const found = COURSE_MEMBER_TABS.find((tab) => tab.key === value);
  return found ? found.key : DEFAULT_MEMBER_TAB;
}

/**
 * The href of a member tab item: Início is the bare area `/area-membros`, the others
 * `/area-membros?aba=<key>`; a manager's preview keeps `ver=aluno` on every item (UI-D-437,
 * UI-D-446).
 */
export function memberTabHref(key: CourseMemberTab, preview = false): string {
  if (key === DEFAULT_MEMBER_TAB) {
    return preview ? `${MEMBER_AREA_PATH}?ver=aluno` : MEMBER_AREA_PATH;
  }
  return preview ? `${MEMBER_AREA_PATH}?aba=${key}&ver=aluno` : `${MEMBER_AREA_PATH}?aba=${key}`;
}
