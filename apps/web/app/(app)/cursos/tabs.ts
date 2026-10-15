/**
 * The `/cursos` hub's area tabs (D-402, UI-D-390): Cursos · Trilhas · Lives, as `href` items
 * (`?aba=<key>`), so a tab change is a navigation and back returns to the previous tab.
 *
 * ORDER IS THE CONTRACT (P57): this array's order is the tab order. Plan 10 appended
 * `{ key: 'trilhas', labelKey: 'courses.hub.tabs.tracks' }` and plan 11 appended
 * `{ key: 'lives', labelKey: 'courses.hub.tabs.lives' }` — in that order, after `cursos` — without
 * touching the page's frame; the member phase appends Início and Progresso to the same registry.
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

/* ── 08.5-06: the member catalogue's area tabs (D-420, UI-D-424) ────────────────────────────── */

/**
 * The member registry over the same `HubTabs` frame: Cursos (`?aba=cursos`, the default) · Lives
 * (`?aba=lives`). The labels are the hub's shipped keys; the member never gets Trilhas.
 */
export const COURSE_MEMBER_TABS = [
  { key: 'cursos', labelKey: 'courses.hub.tabs.courses' },
  { key: 'lives', labelKey: 'courses.hub.tabs.lives' },
] as const;

export type CourseMemberTab = (typeof COURSE_MEMBER_TABS)[number]['key'];

/**
 * `?aba=` → the member tab (UI-D-424, E02 error): only `lives` opens Lives; anything else — an
 * unknown value, the admin-only `trilhas`, a repeated param, none — reads as `cursos`.
 */
export function memberTabFromParam(value: string | string[] | undefined): CourseMemberTab {
  return value === 'lives' ? 'lives' : 'cursos';
}

/** The href of a member tab item; a manager's preview keeps `?ver=aluno` (UI-D-437). */
export function memberTabHref(key: CourseMemberTab, preview = false): string {
  return preview ? `/cursos?aba=${key}&ver=aluno` : `/cursos?aba=${key}`;
}
