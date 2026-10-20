/**
 * The `/inicio` area chips (D-479, UI-D-491): Início · Explorar, as `href` items (`?aba=<key>`), so a
 * tab change is a navigation and back returns to the previous tab. Explorar is not a route of its
 * own: it is `/inicio?aba=explorar`, which keeps links and shares stable and the BottomNav (it
 * matches the path) on Início for both.
 *
 * ORDER IS THE CONTRACT: this array's order is the chip order, Início first. A key is registered
 * only once its body exists, so no chip ever opens an empty body.
 *
 * A plain `.ts` module with no React in it, so the server page, the chip row and the unit tests all
 * read the same registry (the `cursos/tabs.ts` shape).
 */
export const INICIO_TABS = [
  { key: 'inicio', labelKey: 'social.tabs.home' },
  { key: 'explorar', labelKey: 'social.tabs.explore' },
] as const;

export type InicioTab = (typeof INICIO_TABS)[number]['key'];

/** The default tab: the first of the registry. */
export const DEFAULT_INICIO_TAB: InicioTab = INICIO_TABS[0].key;

/**
 * `?aba=` → the tab the page renders (UI-D-491, E01 error). Only a SINGLE string equal to a
 * registered key other than `inicio` opens that body; no value, an empty one, an unknown one or a
 * repeated param all read as Início, with no notice and no 404.
 */
export function inicioTabFromParam(value: string | string[] | undefined): InicioTab {
  if (typeof value !== 'string' || value === DEFAULT_INICIO_TAB) return DEFAULT_INICIO_TAB;
  const found = INICIO_TABS.find((tab) => tab.key === value);
  return found ? found.key : DEFAULT_INICIO_TAB;
}

/** The href of a chip: Início is the bare `/inicio`, the others `/inicio?aba=<key>`. */
export function inicioTabHref(key: InicioTab): string {
  return key === DEFAULT_INICIO_TAB ? '/inicio' : `/inicio?aba=${key}`;
}

/**
 * Who gets the chip row and Explorar at all (D-479): a viewer whose COMPOSED permissions hold
 * `social.participate` (a member) or `moderation.manage` (a moderator), with the `social` module in
 * the bootstrap's module list. Never a role comparison: the permissions are the SAME composed set
 * the API's guards evaluate, so the screen and the API cannot disagree. `support_tenant` holds
 * neither, and with `social` off the module is not on the list, so both get no row and read
 * `?aba=explorar` as Início.
 */
export function showsInicioTabs(
  permissions: readonly string[],
  modules: ReadonlyArray<{ key: string }>,
): boolean {
  if (!modules.some((module) => module.key === 'social')) return false;
  return permissions.includes('social.participate') || permissions.includes('moderation.manage');
}
