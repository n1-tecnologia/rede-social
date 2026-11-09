import type { ProductCard } from '@rede-social/module-store/contracts';
import type { getTranslations } from 'next-intl/server';
import { STORE_PATH } from '@/lib/store-area';
import { plainText } from '@/lib/store-categories';
import {
  categoryOf,
  type StoreAssignments,
  type StoreCategoryIcon,
  type StoreCategoryView,
} from '@/lib/store-setup';
import { type ProductCardView, productCardView } from '@/lib/store-view';

type Translator = Awaited<ReturnType<typeof getTranslations>>;

/**
 * The storefront (2026-10-27, the product owner: "repense a loja ... estilo comercial ... cards
 * maiores, destaque em itens, esquema de prateleiras de itens, categorias"). Pure: no fetch and no
 * clock. It only groups, filters and orders what the store's `all` list answered (ACTIVE products,
 * newest first); every price and pill is the card's finished view (`productCardView`).
 */

/**
 * A product on the storefront: the card's view, its category, its chip and its price for sorting.
 * 2026-10-28: the categories are the store's own (`lib/store-setup.ts`), so a product may have none.
 */
export interface StoreItemView extends ProductCardView {
  /** The category's id, or `null` (the product then sits in no shelf). */
  category: string | null;
  /** "Livro", "Roupa": the chip over the image (`''` with no category). */
  tag: string;
  priceCents: number;
}

export const STORE_SORTS = ['recentes', 'menor-preco', 'maior-preco'] as const;
export type StoreSort = (typeof STORE_SORTS)[number];

/** What the storefront's address asks for: a category, a search, an order. */
export interface StoreQuery {
  categoria: string | null;
  busca: string | null;
  ordem: StoreSort;
}

/** The longest search the field sends (`CatalogueSearch`'s `maxLength`). */
const SEARCH_MAX = 80;

/**
 * `?categoria=&busca=&ordem=` read leniently: anything unknown is the plain storefront. A category
 * counts only when the store keeps it (`categoryIds`, the store's own since 2026-10-28).
 */
export function parseStoreQuery(
  params: {
    categoria?: string | string[];
    busca?: string | string[];
    ordem?: string | string[];
  },
  categoryIds: readonly string[],
): StoreQuery {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const categoria = one(params.categoria);
  const busca = one(params.busca)?.trim().slice(0, SEARCH_MAX) ?? '';
  const ordem = one(params.ordem);
  return {
    categoria: categoria !== undefined && categoryIds.includes(categoria) ? categoria : null,
    busca: busca === '' ? null : busca,
    ordem: (STORE_SORTS as readonly string[]).includes(ordem ?? '')
      ? (ordem as StoreSort)
      : 'recentes',
  };
}

/** The storefront's address for a query (the default order is left out). */
export function storeHref(query: Partial<StoreQuery>): string {
  const search = new URLSearchParams();
  if (query.categoria) search.set('categoria', query.categoria);
  if (query.busca) search.set('busca', query.busca);
  if (query.ordem && query.ordem !== 'recentes') search.set('ordem', query.ordem);
  const text = search.toString();
  return text ? `${STORE_PATH}?${text}` : STORE_PATH;
}

/** The store's categories and each product's (`lib/store-setup.ts`). */
export interface StoreCategoryContext {
  categories: readonly StoreCategoryView[];
  assignments: StoreAssignments;
}

/** Every product as a storefront item, in the API's order. */
export function storeItems(
  products: readonly ProductCard[],
  t: Translator,
  { categories, assignments }: StoreCategoryContext,
): StoreItemView[] {
  return products.map((product) => {
    const category = categoryOf(product, categories, assignments);
    return {
      ...productCardView(product, t, { managerArchived: false }),
      category,
      tag: categories.find((entry) => entry.id === category)?.tag ?? '',
      priceCents: product.priceCents,
    };
  });
}

function byCategory(items: readonly StoreItemView[]): Map<string, StoreItemView[]> {
  const groups = new Map<string, StoreItemView[]>();
  for (const item of items) {
    if (item.category === null) continue;
    const group = groups.get(item.category);
    if (group) group.push(item);
    else groups.set(item.category, [item]);
  }
  return groups;
}

/* ── The storefront ────────────────────────────────────────────────────────────────────────── */

export interface StoreHeroView {
  /** The large card: the featured product. */
  main: StoreItemView;
  /** Beside it, the other featured products, then the newest (up to four). */
  side: StoreItemView[];
}

export interface StoreCategoryTileView {
  key: string;
  icon: StoreCategoryIcon;
  name: string;
  count: string;
  ariaLabel: string;
  href: string;
  active: boolean;
}

export interface StoreShelfView {
  key: string;
  title: string;
  sub: string;
  seeAll: { href: string; label: string; ariaLabel: string };
  items: StoreItemView[];
}

export interface StoreFrontView {
  hero: StoreHeroView | null;
  categories: StoreCategoryTileView[];
  shelves: StoreShelfView[];
}

/**
 * The products beside the featured one in the hero: two on a phone and in a four-column row, three
 * and four as the full-width row widens (the hero hides what does not fit, `StoreHero`).
 */
const HERO_SIDE = 4;
/** The most a shelf carries (a phone scrolls them; a desktop shows one row and "Ver tudo"). */
export const SHELF_MAX = 8;

/** One tile per category with products, in the store's order. */
export function storeCategoryTiles(
  items: readonly StoreItemView[],
  active: string | null,
  t: Translator,
  categories: readonly StoreCategoryView[],
): StoreCategoryTileView[] {
  const groups = byCategory(items);
  return categories.flatMap(({ id: key, name, icon }) => {
    const size = groups.get(key)?.length ?? 0;
    if (size === 0) return [];
    const count = t('store.categories.count', { n: size });
    return [
      {
        key,
        icon,
        name,
        count,
        ariaLabel: t('store.categories.aria', { category: name, count }),
        href: storeHref({ categoria: key }),
        active: key === active,
      },
    ];
  });
}

/**
 * The storefront: the hero (the featured products Gerenciar picked, the first large, the rest beside
 * it and then the newest; by default the newest), the categories with products, and a shelf per
 * category in the store's order (its newest first, "Ver tudo" to the category's page). An empty store
 * has no hero, no tiles and no shelf. A featured id no longer on sale is skipped.
 */
export function storeFrontView(
  items: readonly StoreItemView[],
  t: Translator,
  {
    categories,
    featured = [],
  }: { categories: readonly StoreCategoryView[]; featured?: readonly string[] },
): StoreFrontView {
  const picked = featured.flatMap((id) => items.find((item) => item.id === id) ?? []);
  const main = picked[0] ?? items[0];
  const groups = byCategory(items);
  const side = main
    ? [
        ...picked.filter((item) => item.id !== main.id),
        ...items.filter((item) => item.id !== main.id && !picked.includes(item)),
      ].slice(0, HERO_SIDE)
    : [];
  return {
    hero: main ? { main, side } : null,
    categories: storeCategoryTiles(items, null, t, categories),
    shelves: categories.flatMap(({ id: key, name }) => {
      const group = groups.get(key) ?? [];
      if (group.length === 0) return [];
      return [
        {
          key,
          title: name,
          sub: t('store.categories.count', { n: group.length }),
          seeAll: {
            href: storeHref({ categoria: key }),
            label: t('store.front.shelf.seeAll'),
            ariaLabel: t('store.front.shelf.seeAllAria', { category: name }),
          },
          items: group.slice(0, SHELF_MAX),
        },
      ];
    }),
  };
}

/* ── A category's page and the search ─────────────────────────────────────────────────────── */

export interface StoreListingView {
  title: string;
  sub: string;
  items: StoreItemView[];
  sorts: { key: StoreSort; label: string; href: string; active: boolean }[];
}

const SORT_LABEL: Record<StoreSort, 'recent' | 'priceAsc' | 'priceDesc'> = {
  recentes: 'recent',
  'menor-preco': 'priceAsc',
  'maior-preco': 'priceDesc',
};

/** The items in the asked order; the API's (newest first) breaks every tie. */
function sorted(items: readonly StoreItemView[], ordem: StoreSort): StoreItemView[] {
  if (ordem === 'recentes') return [...items];
  const sign = ordem === 'menor-preco' ? 1 : -1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => sign * (a.item.priceCents - b.item.priceCents) || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * A category's page (`?categoria=`) or a search (`?busca=`, the name holding every word of it,
 * accents and case aside): its products in the asked order and the three orders as links.
 */
export function storeListingView(
  items: readonly StoreItemView[],
  query: StoreQuery,
  t: Translator,
  categories: readonly StoreCategoryView[],
): StoreListingView {
  const words = query.busca ? plainText(query.busca).split(/\s+/).filter(Boolean) : [];
  const found = items.filter(
    (item) =>
      (query.categoria === null || item.category === query.categoria) &&
      words.every((word) => plainText(item.name).includes(word)),
  );
  const title =
    (query.categoria && categories.find((entry) => entry.id === query.categoria)?.name) ||
    t('store.front.search.title');
  const sub =
    query.busca !== null
      ? t('store.front.search.results', { n: found.length, query: query.busca })
      : t('store.categories.count', { n: found.length });
  return {
    title,
    sub,
    items: sorted(found, query.ordem),
    sorts: STORE_SORTS.map((key) => ({
      key,
      label: t(`store.front.sort.${SORT_LABEL[key]}`),
      href: storeHref({ ...query, ordem: key }),
      active: key === query.ordem,
    })),
  };
}

/**
 * The product page's "Você também pode gostar": the same category first (newest first), then the
 * rest of the store, never the product itself.
 */
export function relatedItems(
  items: readonly StoreItemView[],
  productId: string,
  category: string | null,
  limit: number,
): StoreItemView[] {
  const others = items.filter((item) => item.id !== productId);
  return [
    ...others.filter((item) => category !== null && item.category === category),
    ...others.filter((item) => category === null || item.category !== category),
  ].slice(0, limit);
}
