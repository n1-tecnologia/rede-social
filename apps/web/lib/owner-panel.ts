/**
 * The client owner's panel ("Visão do dono", 2026-10-15) on `/perfil`: the rede-social-dashboard
 * preview's level 4 ("Dono do cliente") brought into the app for the tenant admin
 * (`admin_tenant`) only. Its numbers are SAMPLE values from `@rede-social/module-dashboard/fixtures`,
 * untagged by the owner's decision, until the backend measures them (`docs/pendencias-backend.md`
 * item 10).
 *
 * The panel navigates by the query on `/perfil` (plain links, so every step works without
 * JavaScript): `?area=` picks one of six areas, and the deeper params of each area (Membros,
 * Conteúdo, Financeiro) are read by `owner-band-scope.ts`, `owner-content-view.ts` and
 * `owner-finance-view.ts`, which build every link on `ownerAreaHref`. This file holds no fixture, so
 * any screen may import it cheaply.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The real tenant the panel is drawn for: its name and mark in the header, its host in Visão geral's
 * "Conta". Everything else in the panel is the sample (`tenantOwnerPanel`), the same for every tenant.
 */
export interface OwnerPanelTenant {
  /** `bootstrap.tenant.displayName`. */
  name: string;
  /** The tenant's square app icon (`branding.iconUrls.i192`), or null for the initial alone. */
  iconUrl: string | null;
  /** The tenant's primary host (the request's host on a generic host). */
  domain: string;
  /** Whether `domain` is a verified host of the tenant (a tenant host, not a generic one). */
  domainVerified: boolean;
}

/** Where the panel lives: every link of it is this path plus a query (and an anchor). */
export const OWNER_PANEL_PATH = '/perfil';

/** The id of the panel's wrapper: a step that names no anchor of its own lands on it. */
export const OWNER_PANEL_ANCHOR = 'painel-do-dono';

/**
 * "Ver operação do dia (painel do admin)": the app has no client admin panel (level 5 of the
 * preview), so the card opens Configurações, the admin's own operations area.
 */
export const OWNER_ADMIN_HREF = '/configuracoes';

/**
 * The panel's areas (quick 261012-o00), in tab order: each slug is a `?area=` value on `/perfil`.
 */
export const OWNER_AREAS = [
  'visao-geral',
  'membros',
  'conteudo',
  'eventos',
  'financeiro',
  'atendimento',
] as const;
export type OwnerArea = (typeof OWNER_AREAS)[number];

export const DEFAULT_OWNER_AREA: OwnerArea = 'visao-geral';

function isOwnerArea(value: unknown): value is OwnerArea {
  return (OWNER_AREAS as readonly unknown[]).includes(value);
}

/**
 * The area the query asks for (untrusted): `area` only when it is a single string that is exactly an
 * allow-listed slug, else Visão geral. Only these constants ever reach markup or URLs.
 */
export function parseOwnerArea(params: SearchParams): OwnerArea {
  const raw = params.area;
  return typeof raw === 'string' && isOwnerArea(raw) ? raw : DEFAULT_OWNER_AREA;
}

/** The tab link of an area (Visão geral too; `/perfil` alone also renders it). */
export function ownerAreaHref(area: OwnerArea): string {
  return `${OWNER_PANEL_PATH}?area=${area}`;
}

/**
 * Whether the page was reached from inside the panel: every panel link carries `?area=`, so the
 * profile lands on the panel instead of the hero (`OwnerPanelScroll`).
 */
export function isOwnerPanelQuery(params: SearchParams): boolean {
  return params.area !== undefined;
}

/** RED stub (08.7-05 Task 1): the panel's module flags. Inert until GREEN. */
export function ownerPanelFlags(_modules: readonly { key: string }[]) {
  return {
    feed: false,
    stories: false,
    communities: false,
    events: false,
    store: false,
    chat: false,
    notifications: false,
  };
}
