import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { formatBrl } from '@rede-social/contracts/money';
import { avatarUrlFor } from '@rede-social/contracts/profiles';
import type {
  Buyer,
  CommunityAccess,
  CommunityAccessItem,
  CommunityProduct,
  EntitlementSource,
  LockPreview,
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
/** Exported for client hosts that pass their root `useTranslations()` (the product form). */
export type StoreTranslator = Translator;

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

/**
 * The tags a Comunidades card shows for the viewer (08.2-09, UI-D-372 "who sees what", P44):
 *  - no access row (an open community, or the store off / the read failed) → nothing;
 *  - `support_tenant` → nothing: it reads every community in full and has no store role;
 *  - a manager (`store.product.manage`) → "Exclusiva" on every GATED community, and "Produto
 *    arquivado" under the same rule, so the admin sees what members see;
 *  - anyone else → "Exclusiva" only while the community is LOCKED for them (a holder sees no tag),
 *    plus "Produto arquivado" when none of its linked products is active.
 * The tag never reorders, hides or recounts anything (P47, P48): it is two booleans.
 */
export interface CommunityTagsView {
  coverBadge: boolean;
  archived: boolean;
}

const NO_TAGS: CommunityTagsView = { coverBadge: false, archived: false };

export function communityTagsView(
  access: Pick<CommunityAccessItem, 'locked' | 'gated' | 'archivedTag'> | null | undefined,
  { canManage, isSupport }: { canManage: boolean; isSupport: boolean },
): CommunityTagsView {
  if (!access || isSupport) return NO_TAGS;
  const shown = canManage ? access.gated : access.locked;
  if (!shown) return NO_TAGS;
  return { coverBadge: true, archived: access.archivedTag };
}

/** One row of the product-choice sheet (UI-D-375), its thumb built by the host. */
export interface LockedChoiceView {
  id: string;
  href: string;
  name: string;
  priceLabel: string;
  ariaLabel: string;
  imageAssetId: string | null;
}

/**
 * Everything the locked community page decides (08.2-09, UI-D-373, UI-D-375, UI-D-376; P49, P53,
 * P54, P84). `N` is the feed's `lockedCount` exactly as the server sent it — never rounded, capped or
 * replaced by a page size.
 *  - `placeholders` = min(3, N), `showCount` = N ≥ 1, `countLine` the ICU plural of N;
 *  - `section`: `one` (one buyable product: "Ver produto" → `/loja/{id}?comunidade={cid}`),
 *    `many` (two or more: "Ver opções" opens the sheet), `none` (nothing buyable: no top section,
 *    the count body reads "não está à venda" and carries no action);
 *  - `fromPost` is the `?exclusivo=1` line, placed by the host in the top section, or above the
 *    count body when there is no top section.
 */
export interface LockedPageView {
  placeholders: number;
  showCount: boolean;
  countLine: string;
  countBody: string;
  section: 'one' | 'many' | 'none';
  title: string;
  sectionBody: string | null;
  actionLabel: string | null;
  /** `section: 'one'` only. */
  productHref: string | null;
  /** `section: 'many'` only, in the server's order (newest first); archived products never listed. */
  choices: LockedChoiceView[];
  choiceTitle: string;
  choiceHelper: string;
  fromPost: string | null;
  archivedTag: boolean;
}

export function lockedPageView(
  access: Pick<CommunityAccess, 'communityId' | 'archivedTag' | 'buyableProducts'>,
  lockedCount: number,
  { communityName, fromPost }: { communityName: string; fromPost: boolean },
  t: Translator,
): LockedPageView {
  const n = Number.isFinite(lockedCount) && lockedCount > 0 ? Math.trunc(lockedCount) : 0;
  const query = `?comunidade=${encodeURIComponent(access.communityId)}`;
  const products = access.buyableProducts;
  const section: LockedPageView['section'] =
    products.length === 0 ? 'none' : products.length === 1 ? 'one' : 'many';
  const first = products[0];

  let sectionBody: string | null = null;
  if (section === 'one' && first) {
    sectionBody = t(first.priceCents === 0 ? 'store.locked.bodyOneFree' : 'store.locked.bodyOne', {
      product: first.name,
      community: communityName,
    });
  } else if (section === 'many') {
    sectionBody = t('store.locked.bodyMany', { community: communityName });
  }

  const choices: LockedChoiceView[] =
    section === 'many'
      ? products.map((product) => {
          const price = priceLabel(product.priceCents, t);
          return {
            id: product.id,
            href: `/loja/${encodeURIComponent(product.id)}${query}`,
            name: product.name,
            priceLabel: price,
            ariaLabel: t('store.locked.choice.row', { product: product.name, price }),
            imageAssetId: product.imageAssetId,
          };
        })
      : [];

  return {
    placeholders: Math.min(3, n),
    showCount: n >= 1,
    countLine: t('store.locked.count', { N: n }),
    countBody:
      section === 'none'
        ? t('store.locked.unavailable')
        : t('store.locked.countBody', { community: communityName }),
    section,
    title: t('store.locked.title'),
    sectionBody,
    actionLabel:
      section === 'one'
        ? t('store.locked.viewProduct')
        : section === 'many'
          ? t('store.locked.viewOptions')
          : null,
    productHref:
      section === 'one' && first ? `/loja/${encodeURIComponent(first.id)}${query}` : null,
    choices,
    choiceTitle: t('store.locked.choice.title'),
    choiceHelper: t('store.locked.choice.helper', { community: communityName }),
    fromPost: fromPost ? t('store.locked.fromPost') : null,
    archivedTag: access.archivedTag,
  };
}

/* ── 08.2-10: the product form (UI-D-377, UI-D-383) ──────────────────────────────────────────── */

/** Reais thousands grouping only ("1.234"); the cents are appended from integers below. */
const REAIS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0, useGrouping: true });

/**
 * The price field's text for integer cents (UI-D-383): `1990` -> "19,90", `123450` -> "1.234,50",
 * `0` -> "0,00". Built from integers (reais and centavos), never from a float, and it parses back
 * through `parseBrlToCents` to the same cents. The form re-displays the typed value with this on
 * blur, and the edit form opens with it.
 */
export function priceInputText(cents: number): string {
  const reais = Math.trunc(cents / 100);
  const centavos = String(cents % 100).padStart(2, '0');
  return `${REAIS.format(reais)},${centavos}`;
}

/** A community as the product form draws it: a selected row and a picker row share this shape. */
export interface ProductFormCommunity {
  id: string;
  name: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
}

/** The edit form's starting values, the saved product as the form holds it. */
export interface ProductFormDefaults {
  name: string;
  description: string;
  priceText: string;
  priceCents: number;
  imageAssetId: string | null;
  /** The product's ACTIVE linked communities, in the API's order (the saved link set). */
  communities: ProductFormCommunity[];
  status: ProductDetail['status'];
}

/**
 * `ProductDetail` -> the edit form's defaults (UI-D-377): the price shown as "19,90" from cents, the
 * linked communities with the `cover` ladder the product page also uses for their 32px thumbs.
 */
export function productFormDefaults(product: ProductDetail): ProductFormDefaults {
  return {
    name: product.name,
    description: product.description,
    priceText: priceInputText(product.priceCents),
    priceCents: product.priceCents,
    imageAssetId: product.imageAssetId,
    communities: product.communities.map((community) => ({
      id: community.id,
      name: community.name,
      coverAssetId: community.coverAssetId,
      coverVariantWidths: PURPOSE_WIDTHS.cover,
    })),
    status: product.status,
  };
}

/* ── 08.2-10: the lock warning (D-364, UI-D-378) ─────────────────────────────────────────────── */

/** The danger confirmation's words, finished. */
export interface LockWarningView {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

/**
 * The lock warning (D-364, UI-D-378) from the lock preview's rows: one newly locked community names
 * it and its exact member count (the ICU singular "1 membro perderá…", or the "passa a ser
 * exclusiva" body at N = 0); several name every community with its count, joined by
 * `Intl.ListFormat` (conjunction) in the API's order. `null` when nothing newly locks: the form then
 * saves without asking. `names` maps a community id to the name the admin picked it by.
 *
 * No count is ever rounded or capped here: the admin is told exactly who loses access.
 */
export function lockWarningView(
  items: LockPreview['items'],
  names: ReadonlyMap<string, string>,
  t: Translator,
): LockWarningView | null {
  if (items.length === 0) return null;
  const cancelLabel = t('store.lockWarning.cancel');
  const nameOf = (id: string) => names.get(id) ?? '';

  if (items.length === 1) {
    const [only] = items as [LockPreview['items'][number]];
    const community = nameOf(only.communityId);
    return {
      title: t('store.lockWarning.one.title', { community }),
      body:
        only.membersLosingAccess === 0
          ? t('store.lockWarning.one.bodyNone', { community })
          : t('store.lockWarning.one.body', { community, N: only.membersLosingAccess }),
      confirmLabel: t('store.lockWarning.one.confirm'),
      cancelLabel,
    };
  }

  const list = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' }).format(
    items.map((item) =>
      t('store.lockWarning.many.item', {
        community: nameOf(item.communityId),
        N: item.membersLosingAccess,
      }),
    ),
  );
  return {
    title: t('store.lockWarning.many.title', { count: items.length }),
    body: t('store.lockWarning.many.body', { list }),
    confirmLabel: t('store.lockWarning.many.confirm'),
    cancelLabel,
  };
}

/* ── 08.2-10: the community edit form's read-only "Acesso" block (D-363, UI-D-379) ─────────── */

/** One product in "Liberada pelos produtos: …", with the archived suffix already decided. */
export interface CommunityAccessProductView {
  id: string;
  name: string;
  href: string;
  archived: boolean;
}

/**
 * The manager's `products` (every linked product, archived included) -> the block's links, in the
 * API's order. `/loja/{id}` is built from the id only (never from tenant text).
 */
export function communityAccessProductsView(
  products: readonly CommunityProduct[],
): CommunityAccessProductView[] {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    href: `/loja/${encodeURIComponent(product.id)}`,
    archived: product.status === 'archived',
  }));
}

/** One piece of the "Acesso" value: catalog text, or a product link. */
export type CommunityAccessSegment =
  | { kind: 'text'; text: string }
  | { kind: 'product'; product: CommunityAccessProductView };

/** Stands in for `{products}` while the catalog sentence is split around the links. */
const PRODUCTS_SLOT = '\uE000';

/**
 * "Liberada pelos produtos: {products}" (UI-D-379) as segments the form renders: the catalog text
 * around the list, and each product as its own segment between the `Intl.ListFormat` (pt-BR,
 * conjunction) separators, so every name can be a link while the sentence stays the catalog's.
 * Call it with at least one product; the empty case is the "Aberta para todos os membros." line.
 */
export function communityAccessSegments(
  products: readonly CommunityAccessProductView[],
  t: Translator,
): CommunityAccessSegment[] {
  const [before = '', after = ''] = t('communities.form.access.value', {
    products: PRODUCTS_SLOT,
  }).split(PRODUCTS_SLOT);
  const segments: CommunityAccessSegment[] = [];
  if (before) segments.push({ kind: 'text', text: before });
  let next = 0;
  const parts = new Intl.ListFormat('pt-BR', { style: 'long', type: 'conjunction' }).formatToParts(
    products.map((product) => product.id),
  );
  for (const part of parts) {
    const product = part.type === 'element' ? products[next] : undefined;
    if (product) {
      segments.push({ kind: 'product', product });
      next += 1;
    } else {
      segments.push({ kind: 'text', text: part.value });
    }
  }
  if (after) segments.push({ kind: 'text', text: after });
  return segments;
}

/* ── 08.2-11: the "Compradores" rows (D-360, UI-D-380) ─────────────────────────────────────── */

/** One finished "Compradores" row: every string built here (the dates on the server). */
export interface BuyerRowView {
  /** The entitlement id: the row key and what the revoke sends. */
  id: string;
  /** Null for a holder whose membership was removed. */
  membershipId: string | null;
  /** The member's name in THIS community, or the catalog's "Membro removido". */
  name: string;
  removed: boolean;
  /** The stable `/v1/media/{id}/w128` path, or null for the neutral icon. */
  avatarUrl: string | null;
  /** "Comprou em {date}" or "Acesso concedido em {date}", `dd/MM/yyyy` in the tenant's zone. */
  meta: string;
  source: EntitlementSource;
  /** "Comprado" (success) or "Concedido" (neutral): a grant is never mistaken for a purchase. */
  tag: { label: string; tone: 'success' | 'neutral' };
  /** The revoke control's accessible name, "Revogar acesso de {name}". */
  revokeLabel: string;
}

/**
 * The row's meta line for an entitlement created at `sinceIso` (UTC), with the date formatted
 * `dd/MM/yyyy` in the TENANT's timezone (the device's zone never enters, UI-D-380).
 */
export function buyerMeta(
  source: EntitlementSource,
  sinceIso: string,
  timezone: string,
  t: Translator,
): string {
  const date = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(sinceIso));
  return t(`store.buyers.meta.${source}`, { date });
}

function rowView(
  parts: {
    id: string;
    membershipId: string | null;
    displayName: string | null;
    avatarAssetId: string | null;
    source: EntitlementSource;
    meta: string;
  },
  t: Translator,
): BuyerRowView {
  // The three identity fields move together (08.2-06); a missing name alone also reads as removed.
  const removed = parts.membershipId === null || parts.displayName === null;
  const name = removed ? t('store.buyers.removed') : (parts.displayName ?? '');
  return {
    id: parts.id,
    membershipId: parts.membershipId,
    name,
    removed,
    avatarUrl: removed ? null : avatarUrlFor(parts.avatarAssetId),
    meta: parts.meta,
    source: parts.source,
    tag: {
      label: t(`store.buyers.tag.${parts.source}`),
      tone: parts.source === 'purchase' ? 'success' : 'neutral',
    },
    revokeLabel: t('store.buyers.revoke.label', { name }),
  };
}

/** `Buyer` (the API's row) -> the finished row, in the tenant's timezone. */
export function buyerRowView(
  buyer: Buyer,
  { timezone }: { timezone: string },
  t: Translator,
): BuyerRowView {
  return rowView(
    {
      id: buyer.entitlementId,
      membershipId: buyer.membershipId,
      displayName: buyer.displayName,
      avatarAssetId: buyer.avatarAssetId,
      source: buyer.source,
      meta: buyerMeta(buyer.source, buyer.since, timezone, t),
    },
    t,
  );
}

/**
 * The row a fresh grant prepends (UI-D-381): the member as the search showed them, the entitlement
 * the API answered, and the meta line the grant action formatted on the server.
 */
export function grantedRowView(
  granted: {
    entitlementId: string;
    membershipId: string;
    name: string;
    avatarAssetId: string | null;
    meta: string;
  },
  t: Translator,
): BuyerRowView {
  return rowView(
    {
      id: granted.entitlementId,
      membershipId: granted.membershipId,
      displayName: granted.name,
      avatarAssetId: granted.avatarAssetId,
      source: 'grant',
      meta: granted.meta,
    },
    t,
  );
}
