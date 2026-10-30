/**
 * The Formulário de perfil tabs (UI-D-564, UI-D-565): Perguntas · Arquivadas, as `href` items (the bare
 * path is Perguntas, `?aba=arquivadas` is the archived list), so a tab change is a navigation and back
 * returns to the previous tab. The `pagamentos/tabs.ts` shape.
 *
 * ORDER IS THE CONTRACT: `PROFILE_FORM_TABS` is the tab order. The URL value is the pt-BR word the
 * admin sees in the address bar; the keys are what the code and the catalog
 * (`profileForm.admin.tabs.<key>`) speak.
 *
 * A plain `.ts` module with no React in it, so the server page, the client tabs row, the loading
 * skeleton and the unit tests all read the same registry.
 */
export const PROFILE_FORM_TABS = ['questions', 'archived'] as const;

export type ProfileFormTab = (typeof PROFILE_FORM_TABS)[number];

/** The default tab: Perguntas, the first of the registry. */
export const DEFAULT_PROFILE_FORM_TAB = PROFILE_FORM_TABS[0];

const ARCHIVED_PARAM = 'arquivadas';

export const PROFILE_FORM_PATH = '/configuracoes/formulario-de-perfil';

/**
 * `?aba=` to the tab the page renders. Anything but ONE known pt-BR value (an unknown one, a repeated
 * one such as `?aba=arquivadas&aba=arquivadas`, an empty one or none) reads as Perguntas.
 */
export function parseTab(value: string | string[] | undefined): ProfileFormTab {
  if (typeof value === 'string' && value === ARCHIVED_PARAM) return 'archived';
  return DEFAULT_PROFILE_FORM_TAB;
}

/** The href of a tab item: Perguntas is the bare path. */
export function profileFormTabHref(tab: ProfileFormTab): string {
  if (tab === DEFAULT_PROFILE_FORM_TAB) return PROFILE_FORM_PATH;
  return `${PROFILE_FORM_PATH}?aba=${ARCHIVED_PARAM}`;
}
