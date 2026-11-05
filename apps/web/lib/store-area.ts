/**
 * 2026-10-24 — the store as an AREA (the user's call: "a lógica da área de membros" for the Loja,
 * member and admin alike), and the ONE place that knows the path of every store screen.
 *
 * The Loja is a TopBar slot, not a tab; since 2026-10-24 the kernel lets a slot own an area on the
 * pages no tab claims (`activeArea`'s slot fallback), so the store gets its own menu, "· Loja": the
 * phone's sandwich menu and the rail's sub-lines under the Loja row.
 *
 *  - **Produtos** (`/loja`) and **Comprados** (`/loja/comprados`): the catalogue's `all` and `owned`
 *    lists, the two chips of before as screens of their own. A manager browses them exactly as a
 *    member does (no create control, no archived list, no manager-only pill).
 *  - **Gerenciar** (`/loja/gerenciar`), a manager's last row: the products as management rows, the
 *    active ones or `?filtro=arquivados`, and "Novo produto". It has no `matches`: the forms and the
 *    product page mark no row (the courses area's rule).
 *
 * `legacyStoreFilterRedirect` reads the OLD `/loja?filtro=` (the chips' links), so a bookmarked or
 * shared link still lands on its screen through `/loja`'s redirect.
 *
 * A zero-dependency leaf on purpose (its imports are types only): client components and the server
 * layout import it without pulling the view layer.
 */
import type { NavArea } from '@rede-social/core/ui';
import type { ProductFilter } from '@rede-social/module-store/contracts';

export const STORE_PATH = '/loja';
export const STORE_OWNED_PATH = '/loja/comprados';
export const STORE_MANAGE_PATH = '/loja/gerenciar';

/** The browse screens, in the menu's order (ORDER IS THE CONTRACT). `icon` is a kernel nav icon. */
export const STORE_SCREENS = [
  {
    key: 'produtos',
    path: STORE_PATH,
    filter: 'all',
    icon: 'shopping-bag',
    labelKey: 'store.area.screens.products',
  },
  {
    key: 'comprados',
    path: STORE_OWNED_PATH,
    filter: 'owned',
    icon: 'package-check',
    labelKey: 'store.area.screens.owned',
  },
] as const satisfies ReadonlyArray<{
  key: string;
  path: string;
  filter: ProductFilter;
  icon: string;
  labelKey: string;
}>;

export type StoreScreen = (typeof STORE_SCREENS)[number]['key'];

/** Gerenciar's two lists: the active products (the default) and the archived ones. */
export const STORE_MANAGE_LISTS = ['active', 'archived'] as const;
export type StoreManageList = (typeof STORE_MANAGE_LISTS)[number];

/** The pt-BR value of Gerenciar's archived list (`?filtro=arquivados`, the old chip's spelling). */
export const STORE_ARCHIVED_QUERY = 'arquivados';

/** The OLD owned chip's value (`/loja?filtro=comprados`). */
const OWNED_QUERY = 'comprados';

/**
 * Gerenciar's `?filtro=` → its list: only a SINGLE string equal to `arquivados` opens the archived
 * list; anything else (no value, an empty one, another case, a repeated param) reads as the active.
 */
export function storeManageListFromParam(value: string | string[] | undefined): StoreManageList {
  return value === STORE_ARCHIVED_QUERY ? 'archived' : 'active';
}

/** The href of a Gerenciar list; the active one is the bare path. */
export function storeManageHref(list: StoreManageList): string {
  return list === 'archived'
    ? `${STORE_MANAGE_PATH}?${new URLSearchParams({ filtro: STORE_ARCHIVED_QUERY }).toString()}`
    : STORE_MANAGE_PATH;
}

/** The catalogue filter a Gerenciar list reads (the API's `all` holds the ACTIVE products). */
export function storeManageFilter(
  list: StoreManageList,
): Extract<ProductFilter, 'all' | 'archived'> {
  return list === 'archived' ? 'archived' : 'all';
}

/**
 * The OLD `/loja?filtro=` → where it lives now, or `null` (stay on Produtos): `comprados` is the
 * Comprados screen; `arquivados` is Gerenciar's archived list for a manager and Produtos for anyone
 * else (the old page read it as "Todos" without the permission). Only a single exact value counts.
 */
export function legacyStoreFilterRedirect(
  value: string | string[] | undefined,
  canManage: boolean,
): string | null {
  if (value === OWNED_QUERY) return STORE_OWNED_PATH;
  if (value === STORE_ARCHIVED_QUERY) return canManage ? storeManageHref('archived') : STORE_PATH;
  return null;
}

/**
 * The store slot's AREA, worded by `t` (the root translator); the host adds the slot key
 * (`registry.tsx`, `areasFor`): "Loja" with Produtos and Comprados and, for a manager, "Gerenciar".
 * The screen keys are prefixed (`store-*`): a key names one row of the menu.
 */
export function storeAreas({
  canManage,
  t,
}: {
  canManage: boolean;
  t: (key: string) => string;
}): Omit<NavArea, 'key'>[] {
  const screens = STORE_SCREENS.map((screen) => ({
    key: `store-${screen.key}`,
    href: screen.path,
    icon: screen.icon,
    label: t(screen.labelKey),
  }));
  const manage = {
    key: 'store-manage',
    href: STORE_MANAGE_PATH,
    icon: 'sliders-horizontal',
    label: t('store.area.screens.manage'),
  };
  return [
    {
      label: t('store.area.label'),
      menuLabel: t('store.area.menu'),
      screens: canManage ? [...screens, manage] : screens,
    },
  ];
}
