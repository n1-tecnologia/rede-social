import { formatBrl } from '@rede-social/contracts/money';
import type {
  ProductCard,
  ProductCommunity,
  ProductDetail,
  ProductFilter,
} from '@rede-social/module-store/contracts';
import type { getTranslations } from 'next-intl/server';

/**
 * THE formatter module for the store (08.2-07, UI-D-383): every price, card label and product-page
 * decision a store surface prints is built here, so the grid, the product page and (in later plans)
 * the purchase dialog and the choice sheet can never disagree.
 *
 * **Money.** Every price goes through `formatBrl(cents)` from `@rede-social/contracts/money`, whose
 * output carries U+00A0 after "R$" (Pitfall 12); zero is the catalog word "Grátis", never
 * "R$ 0,00" (P22: no rounding, no float formatting here). Tests compare against `formatBrl(...)` or
 * an explicit U+00A0, never an ASCII space.
 *
 * **Clock-free and side-effect-free**: nothing here reads the clock, fetches or sorts (P21).
 */

/** The same untyped translator every `lib/*-view` module takes. Keys are FULL (`store.…`). */
type Translator = Awaited<ReturnType<typeof getTranslations>>;

/** The pt-BR `?filtro=` values the chips write, mapped to the API's closed filter enum. */
export const STORE_FILTER_PARAMS = {
  todos: 'all',
  comprados: 'owned',
  arquivados: 'archived',
} as const satisfies Record<string, ProductFilter>;

/** The chip query value for each filter (`all` has none: it is `/loja`). */
export const STORE_FILTER_QUERY: Record<ProductFilter, string | null> = {
  all: null,
  owned: 'comprados',
  archived: 'arquivados',
};

/**
 * `?filtro=` → the filter the page reads (D-352, T-08.2-32). Anything but the single exact string
 * `comprados` or `arquivados` reads as `all` (a repeated value, an unknown one, or none), and
 * `arquivados` without `store.product.manage` reads as `all` too: the API answers 403 anyway, this is
 * the UX half.
 */
export function storeFilterFromParam(
  value: string | string[] | undefined,
  canManage: boolean,
): ProductFilter {
  if (typeof value !== 'string') return 'all';
  if (value === 'comprados') return 'owned';
  if (value === 'arquivados' && canManage) return 'archived';
  return 'all';
}

/** The `/loja` href of a filter chip. */
export function storeFilterHref(filter: ProductFilter): string {
  const query = STORE_FILTER_QUERY[filter];
  return query === null ? '/loja' : `/loja?filtro=${query}`;
}

/** UI-D-383: `formatBrl(cents)`, or the catalog word for zero. Never "R$ 0,00". */
export function priceLabel(cents: number, t: Translator): string {
  return cents === 0 ? t('store.price.free') : formatBrl(cents);
}

export interface ProductCardView {
  id: string;
  href: string;
  ariaLabel: string;
  name: string;
  priceLabel: string;
  /** Null takes the card's brand-gradient branch (D-69). */
  imageAssetId: string | null;
  imageAlt: string;
  pill?: { kind: 'owned' | 'archived'; label: string };
}

/**
 * One grid card (UI-D-368, UI-D-386). Pill priority: `archived` (only on the manager's "Arquivados"
 * filter, `managerArchived`) → `owned` (the viewer holds it) → none. An archived product the viewer
 * holds, listed under "Comprados", carries the "Comprado" pill and no archive wording (E02 partial).
 */
export function productCardView(
  product: Pick<ProductCard, 'id' | 'name' | 'priceCents' | 'owned' | 'imageAssetId'>,
  t: Translator,
  { managerArchived }: { managerArchived: boolean },
): ProductCardView {
  const price = priceLabel(product.priceCents, t);
  const base = {
    id: product.id,
    href: `/loja/${encodeURIComponent(product.id)}`,
    name: product.name,
    priceLabel: price,
    imageAssetId: product.imageAssetId,
    imageAlt: t('store.card.imageAlt', { product: product.name }),
  };
  if (managerArchived) {
    return {
      ...base,
      ariaLabel: t('store.card.ariaArchived', { product: product.name }),
      pill: { kind: 'archived', label: t('store.card.archived') },
    };
  }
  if (product.owned) {
    return {
      ...base,
      ariaLabel: t('store.card.ariaOwned', { product: product.name, price }),
      pill: { kind: 'owned', label: t('store.card.owned') },
    };
  }
  return {
    ...base,
    ariaLabel: t('store.card.aria', { product: product.name, price }),
  };
}

/** One "Libera o acesso a" row: a link once held, a static row with a padlock otherwise. */
export interface ProductUnlockRow {
  id: string;
  name: string;
  coverAssetId: string | null;
  /** `/comunidades/{id}` when held; `null` draws the static locked row. */
  href: string | null;
  ariaLabel: string;
}

export interface ProductPageView {
  title: string;
  back: { href: string; label: string };
  priceLabel: string;
  headerPill: { tone: 'success' | 'neutral'; label: string } | null;
  /** What sits under the price: the owned block, the manager's archived note, or nothing yet. */
  action: 'owned' | 'archived' | 'none';
  /** `null` renders no node at all (E04 empty). */
  description: string | null;
  /** Empty renders no section and says nothing about communities (D-353). */
  unlocks: ProductUnlockRow[];
  /** The manager card's Compradores sub-line, or `null` for everyone else. */
  manage: { buyersSub: string } | null;
}

/**
 * The product page (UI-D-369). Decisions, in order:
 *  - **back**: `/comunidades/{id}` "Voltar para {community}" only when `?comunidade=` names one of
 *    the product's ACTIVE linked communities (the API lists only those); the href is built from the
 *    product's own row, never echoed from the URL (T-08.2-33). Otherwise `/loja`.
 *  - **header pill / action**: a manager on an archived product gets "Arquivado" and the note with
 *    "Reativar produto" (a manager cannot buy an archived product); otherwise a holder gets
 *    "Comprado" and the owned block; otherwise neither (the buy control is plan 08's).
 *  - **unlocks**: only when the product links at least one active community AND the communities
 *    module is on (D-353, P23); rows become links once held (D-352).
 *  - **description**: trimmed-empty renders nothing (P24); otherwise the raw text, rendered by the
 *    page as React text with `whitespace-pre-line` (P25: no HTML, no linkify).
 */
export function productPageView(
  product: ProductDetail,
  t: Translator,
  {
    canManage,
    communitiesOn,
    fromCommunity,
  }: {
    canManage: boolean;
    communitiesOn: boolean;
    fromCommunity?: string | string[] | undefined;
  },
): ProductPageView {
  const origin =
    typeof fromCommunity === 'string'
      ? product.communities.find((community) => community.id === fromCommunity)
      : undefined;
  const back = origin
    ? {
        href: `/comunidades/${encodeURIComponent(origin.id)}`,
        label: t('store.product.backToCommunity', { community: origin.name }),
      }
    : { href: '/loja', label: t('store.product.back') };

  const managerArchived = canManage && product.status === 'archived';
  let headerPill: ProductPageView['headerPill'] = null;
  let action: ProductPageView['action'] = 'none';
  if (managerArchived) {
    headerPill = { tone: 'neutral', label: t('store.card.archived') };
    action = 'archived';
  } else if (product.owned) {
    headerPill = { tone: 'success', label: t('store.card.owned') };
    action = 'owned';
  }

  const unlocks = communitiesOn
    ? product.communities.map((community) => unlockRow(community, product.owned, t))
    : [];

  return {
    title: product.name,
    back,
    priceLabel: priceLabel(product.priceCents, t),
    headerPill,
    action,
    description: product.description.trim() === '' ? null : product.description,
    unlocks,
    manage: canManage
      ? { buyersSub: t('store.product.manage.buyersSub', { count: product.holderCount ?? 0 }) }
      : null,
  };
}

function unlockRow(community: ProductCommunity, owned: boolean, t: Translator): ProductUnlockRow {
  return {
    id: community.id,
    name: community.name,
    coverAssetId: community.coverAssetId,
    href: owned ? `/comunidades/${encodeURIComponent(community.id)}` : null,
    ariaLabel: owned
      ? t('store.product.unlocks.rowOpen', { community: community.name })
      : t('store.product.unlocks.rowLocked', { community: community.name }),
  };
}
