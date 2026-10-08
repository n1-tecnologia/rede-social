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
  /**
   * What sits under the price: "Comprar"/"Obter" for an active product the viewer does not hold,
   * the owned block, the manager's archived note, or nothing (an archived product nobody here may
   * buy; the API answers that one as a 404 for everyone but holders and managers).
   */
  action: 'buy' | 'owned' | 'archived' | 'none';
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
 *    "Comprado" and the owned block; otherwise an active product gets "Comprar"/"Obter" (08.2-08).
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
  } else if (product.status === 'active') {
    action = 'buy';
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

/**
 * The owned block's DOM id on the product page: where focus lands once the refresh after a
 * purchase replaces "Comprar" with it (UI-D-386). Shared here because a server page cannot read a
 * value exported from a client module.
 */
export const STORE_OWNED_BLOCK_ID = 'store-product-owned';

/** The most community names the confirm body spells out before "e mais {n}" (UI-D-370). */
const PURCHASE_BODY_NAMES = 2;

/**
 * The confirm step's community list (UI-D-370): `Intl.ListFormat('pt-BR', conjunction)` of at most
 * two names; with more, the two names keep the list's own separator and the catalog's
 * "e mais {n}" closes it: "A e B", "A, B e mais 2". The catalog phrase carries its own "e", so it
 * is appended after the two names rather than formatted as a third list item, which would read
 * "A, B e e mais 2".
 */
function communitiesList(names: readonly string[], t: Translator): string {
  const format = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' });
  if (names.length <= PURCHASE_BODY_NAMES) return format.format(names);
  const more = t('store.purchase.andMore', { n: names.length - PURCHASE_BODY_NAMES });
  // The parts of "A, B e X" up to (not including) the conjunction before X: "A, B".
  const head = format
    .formatToParts([...names.slice(0, PURCHASE_BODY_NAMES), more])
    .slice(0, -2)
    .map((part) => part.value)
    .join('');
  return `${head} ${more}`;
}

/**
 * The confirm body (UI-D-370, D-361, UI-D-388): the price ("Grátis" at R$ 0, through `priceLabel`,
 * the SAME `priceCents` the page shows and the action sends, P26), then, only when the product
 * opens an active community, which ones. It promises the access and nothing else: no payment
 * word, since no payment is taken (UI-D-388).
 */
export function purchaseBodyText(
  product: Pick<ProductDetail, 'priceCents' | 'communities'>,
  t: Translator,
): string {
  const price = priceLabel(product.priceCents, t);
  if (product.communities.length === 0) return t('store.purchase.body', { price });
  return t('store.purchase.bodyCommunities', {
    price,
    communities: communitiesList(
      product.communities.map((community) => community.name),
      t,
    ),
  });
}

/** The confirm step, finished (titles, body, labels), and the buy control's label. */
export interface PurchaseConfirmView {
  buyLabel: string;
  title: string;
  body: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel: string;
}

/** "Comprar"/"Comprar {product}?" or, at R$ 0, "Obter"/"Obter {product}?" (D-361). */
export function purchaseConfirmView(
  product: Pick<ProductDetail, 'name' | 'priceCents' | 'communities'>,
  t: Translator,
): PurchaseConfirmView {
  const free = product.priceCents === 0;
  return {
    buyLabel: free ? t('store.product.get') : t('store.product.buy'),
    title: free
      ? t('store.purchase.titleFree', { product: product.name })
      : t('store.purchase.title', { product: product.name }),
    body: purchaseBodyText(product, t),
    confirmLabel: t('store.purchase.confirm'),
    pendingLabel: t('store.purchase.confirming'),
    cancelLabel: t('store.purchase.cancel'),
  };
}

/** One community of the success list, still data: the host draws the 32px thumb. */
export interface PurchaseSuccessCommunity {
  id: string;
  href: string;
  name: string;
  coverAssetId: string | null;
}

/** The success step (UI-D-370 b), by the number of communities the purchase answered. */
export interface PurchaseSuccessView {
  variant: 'none' | 'one' | 'several';
  title: string;
  body: string;
  /** `several` only: the link list. */
  communities: PurchaseSuccessCommunity[];
  /** `one` only: "Ir para a comunidade". */
  primary: { href: string; label: string } | null;
  closeLabel: string;
}

/**
 * The success step for the communities the purchase ANSWERED (a first purchase and an `owned`
 * replay answer the same list, so both draw the same step, P27): one → "{community} já está
 * liberada para você." with "Ir para a comunidade"; several → the link list; none → "{product}
 * agora é seu." with only "Fechar" (P28, D-353). Every href is built from the answered row.
 */
export function successView(
  product: Pick<ProductDetail, 'name'>,
  communities: readonly ProductCommunity[],
  t: Translator,
): PurchaseSuccessView {
  const base = {
    title: t('store.purchase.success.title'),
    closeLabel: t('store.purchase.success.close'),
  };
  const [first] = communities;
  if (!first) {
    return {
      ...base,
      variant: 'none',
      body: t('store.purchase.success.none', { product: product.name }),
      communities: [],
      primary: null,
    };
  }
  if (communities.length === 1) {
    return {
      ...base,
      variant: 'one',
      body: t('store.purchase.success.one', { community: first.name }),
      communities: [],
      primary: {
        href: `/comunidades/${encodeURIComponent(first.id)}`,
        label: t('store.purchase.success.goToCommunity'),
      },
    };
  }
  return {
    ...base,
    variant: 'several',
    body: t('store.purchase.success.several'),
    communities: communities.map((community) => ({
      id: community.id,
      href: `/comunidades/${encodeURIComponent(community.id)}`,
      name: community.name,
      coverAssetId: community.coverAssetId,
    })),
    primary: null,
  };
}
