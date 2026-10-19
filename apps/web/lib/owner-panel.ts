/**
 * The client owner's panel ("Visão do dono", 2026-10-15) on `/perfil`: the rede-social-dashboard
 * preview's level 4 ("Dono do cliente") brought into the app for the tenant admin
 * (`admin_tenant`) only. Since 08.7 every number is the tenant's own, read from its daily snapshot
 * through the API (D-459: no runtime web file renders a fixture value, `pnpm lint` enforces it).
 *
 * The panel navigates by the query on `/perfil` (plain links, so every step works without
 * JavaScript): `?area=` picks one of the areas the tenant's modules show (08.7-12, D-460), and the
 * deeper params of each area (Membros,
 * Conteúdo, Financeiro) are read by `owner-band-scope.ts`, `owner-content-view.ts` and
 * `owner-finance-view.ts`, which build every link on `ownerAreaHref`. This file holds no fixture, so
 * any screen may import it cheaply.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The real tenant the panel is drawn for: its name and mark in the header, its host in Visão geral's
 * "Conta". The numbers, the plan and the team come from the API's snapshot answers.
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
 * The modules each area needs (D-460, UI-D-471): Visão geral and Membros are always present, so the
 * row never has zero chips; Conteúdo hides only when `feed` AND `stories` are both off (UI-D-473);
 * Atendimento leaves with `chat`, Moderação with it (UI-D-474).
 */
const AREA_SHOWN: Readonly<Record<OwnerArea, (flags: OwnerPanelFlags) => boolean>> = {
  'visao-geral': () => true,
  membros: () => true,
  conteudo: (flags) => flags.feed || flags.stories,
  eventos: (flags) => flags.events,
  financeiro: (flags) => flags.store,
  atendimento: (flags) => flags.chat,
};

/** The areas the tenant's modules show, in tab order (D-460, UI-D-471). */
export function visibleOwnerAreas(flags: OwnerPanelFlags): OwnerArea[] {
  return OWNER_AREAS.filter((area) => AREA_SHOWN[area](flags));
}

/**
 * The tracks the chip at `index` spans when `count` chips share the 6-track row (UI-D-471): rows of
 * at most three, each chip spanning 6 ÷ (chips in its row) — 6 → 3 + 3 (span 2), 5 → 3 + 2 (span
 * 2, then 3), 4 → 2 + 2 (span 3), 3 → 3 (span 2), 2 → 2 (span 3). No track is ever left empty.
 */
export function areaChipSpan(index: number, count: number): 2 | 3 {
  const firstRow = count === 4 ? 2 : Math.min(count, 3);
  const inRow = index < firstRow ? firstRow : count - firstRow;
  return inRow === 3 ? 2 : 3;
}

/**
 * The area the query asks for (untrusted): `area` only when it is a single string that is exactly an
 * allow-listed slug AND an area the tenant's modules show, else Visão geral (UI-D-471, T-08.7-24):
 * a hidden area's `?area=` renders Visão geral with its chip active, with no redirect, toast or
 * notice, and every deeper parameter of it is ignored (Visão geral reads none). The API refuses the
 * hidden area anyway (404 `MODULE_DISABLED`). Only these constants ever reach markup or URLs.
 */
export function parseOwnerArea(params: SearchParams, flags: OwnerPanelFlags): OwnerArea {
  const raw = params.area;
  return typeof raw === 'string' && isOwnerArea(raw) && AREA_SHOWN[raw](flags)
    ? raw
    : DEFAULT_OWNER_AREA;
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

/**
 * The modules the panel reads (08.7-05, D-460): a hidden module hides its area, its scope tab and its
 * blocks, and drops its fragments ("com push" with `notifications` off, UI-D-489 d).
 */
export const OWNER_PANEL_MODULES = [
  'feed',
  'stories',
  'communities',
  'events',
  'store',
  'chat',
  'notifications',
] as const;
export type OwnerPanelModule = (typeof OWNER_PANEL_MODULES)[number];
export type OwnerPanelFlags = Readonly<Record<OwnerPanelModule, boolean>>;

/**
 * The panel's module flags, computed ONCE on `/perfil` from `bootstrap.modules` (the tenant's
 * enabled modules) and passed down through `OwnerPanelSection` and `TenantOwnerPanel` to the areas.
 * A key the bootstrap does not list is off; a module the panel does not read is ignored.
 */
export function ownerPanelFlags(modules: readonly { key: string }[]): OwnerPanelFlags {
  const on = new Set(modules.map((module) => module.key));
  return Object.fromEntries(OWNER_PANEL_MODULES.map((key) => [key, on.has(key)])) as Record<
    OwnerPanelModule,
    boolean
  >;
}
