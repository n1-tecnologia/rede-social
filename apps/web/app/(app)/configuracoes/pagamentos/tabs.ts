/**
 * The Pagamentos area tabs (UI-D-513): Configuração · Acessos · Eventos, as `href` items
 * (`?aba=acessos`, `?aba=eventos`; the bare path is Configuração), so a tab change is a navigation
 * and back returns to the previous tab. The `cursos/tabs.ts` shape.
 *
 * ORDER IS THE CONTRACT: `PAYMENTS_TABS` is the tab order. The URL values are the pt-BR words the
 * admin sees in the address bar; the keys are what the code and the catalog (`payments.tabs.<key>`)
 * speak.
 *
 * A plain `.ts` module with no React in it, so the server page, the client tabs row and the unit
 * tests all read the same registry.
 */
export const PAYMENTS_TABS = ['setup', 'access', 'events'] as const;

export type PaymentsTab = (typeof PAYMENTS_TABS)[number];

/** The default tab: Configuração, the first of the registry. */
export const DEFAULT_PAYMENTS_TAB = PAYMENTS_TABS[0];

/** The `?aba=` value of each non-default tab. */
const TAB_PARAMS = { access: 'acessos', events: 'eventos' } as const;

const PAYMENTS_PATH = '/configuracoes/pagamentos';

/**
 * `?aba=` → the tab the page renders (E01 error). Anything but ONE known pt-BR value — an unknown
 * one, a repeated one (`?aba=eventos&aba=acessos`), an empty one or none — reads as Configuração.
 */
export function paymentsTabFromParam(value: string | string[] | undefined): PaymentsTab {
  if (typeof value !== 'string') return DEFAULT_PAYMENTS_TAB;
  if (value === TAB_PARAMS.access) return 'access';
  if (value === TAB_PARAMS.events) return 'events';
  return DEFAULT_PAYMENTS_TAB;
}

/** The href of a tab item: Configuração is the bare path. */
export function paymentsTabHref(tab: PaymentsTab): string {
  if (tab === DEFAULT_PAYMENTS_TAB) return PAYMENTS_PATH;
  return `${PAYMENTS_PATH}?aba=${TAB_PARAMS[tab]}`;
}
