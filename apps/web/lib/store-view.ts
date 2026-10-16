import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { formatBrl } from '@rede-social/contracts/money';
import { avatarUrlFor } from '@rede-social/contracts/profiles';
import type {
  Buyer,
  CommunityAccess,
  CommunityAccessItem,
  CommunityProduct,
  CourseAccess,
  EntitlementSource,
  LiveAccess,
  LockPreview,
  ProductCard,
  ProductCommunity,
  ProductDetail,
  ProductFilter,
  ProductUnlockCourse,
  ProductUnlockLive,
} from '@rede-social/module-store/contracts';
import type { UnlockThumbRatio } from '@rede-social/module-store/ui';
import type { getTranslations } from 'next-intl/server';
import { liveDateParts } from '@/lib/courses-view';

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

/** What a "Libera o acesso a" row (and a "Compra concluída" list row) opens (UI-D-439). */
export type UnlockKind = 'community' | 'course' | 'live';

/**
 * The thumb box per kind (UI-D-439): a community's 32px square, a course's 3:4 poster, a live's
 * 16:10 frame; the store UI's `UnlockThumb` draws the classes.
 */
const UNLOCK_THUMB_RATIO: Record<UnlockKind, UnlockThumbRatio> = {
  community: 'square',
  course: 'poster',
  live: 'wide',
};

/** One "Libera o acesso a" row: a link once held, a static row with a padlock otherwise. */
export interface ProductUnlockRow {
  id: string;
  name: string;
  coverAssetId: string | null;
  /** `/comunidades/{id}`, `/cursos/{id}` or `/cursos/lives/{id}` when held; `null` draws the static locked row. */
  href: string | null;
  ariaLabel: string;
  /** 08.5-12 (UI-D-439): the row's kind, its thumb box and its kind meta line. */
  kind: UnlockKind;
  thumbRatio: UnlockThumbRatio;
  /** "Comunidade", "Curso" or "Live · {date}, {time}" (the tenant's timezone). */
  meta: string;
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
 *  - **back**: the header's `BackLink` returns to the screen the member came from (2026-10-09), so
 *    its label is the bare "Voltar" and the href is only its fallback for a direct entry:
 *    `/comunidades/{id}` when `?comunidade=` names one of the product's ACTIVE linked communities
 *    (the API lists only those), built from the product's own row and never echoed from the URL
 *    (T-08.2-33). Otherwise `/loja`.
 *  - **header pill / action**: a manager on an archived product gets "Arquivado" and the note with
 *    "Reativar produto" (a manager cannot buy an archived product); otherwise a holder gets
 *    "Comprado" and the owned block; otherwise an active product gets "Comprar"/"Obter" (08.2-08).
 *  - **back from a course or a live** (08.5-12, UI-D-439): with no honoured `?comunidade=`,
 *    `?curso=` and then `?live=` go back to `/cursos/{id}` "Voltar para {course}" or
 *    `/cursos/lives/{id}` "Voltar para {live}", again only for an id the product's OWN
 *    `unlockedCourses` / `unlockedLives` list, the href built from that row (T-08.5-09).
 *  - **unlocks** (UI-D-439, D-425): ONE list, communities first (only while the communities module
 *    is on, D-353, P23), then the published courses, then the non-cancelled lives (only while the
 *    courses module is on), each group in the API's order (EP-59). Rows become links once held
 *    (D-352, the shipped `owned` rule for every kind); the list is rebuilt on every render, so a
 *    course unpublished after the page rendered still leads to `/cursos/{id}`, which answers
 *    "Curso indisponível" (EP-56). An empty list renders no section.
 *  - **description**: trimmed-empty renders nothing (P24); otherwise the raw text, rendered by the
 *    page as React text with `whitespace-pre-line` (P25: no HTML, no linkify).
 */
export function productPageView(
  product: ProductDetail,
  t: Translator,
  {
    canManage,
    communitiesOn,
    coursesOn,
    timeZone,
    fromCommunity,
    fromCourse,
    fromLive,
  }: {
    canManage: boolean;
    communitiesOn: boolean;
    /** 08.5-12: the courses module flag; off → no course or live rows (the API answers `[]` too). */
    coursesOn: boolean;
    /** The tenant's timezone: a live row's "Live · {date}, {time}" is finished here (UI-D-439). */
    timeZone: string;
    fromCommunity?: string | string[] | undefined;
    fromCourse?: string | string[] | undefined;
    fromLive?: string | string[] | undefined;
  },
): ProductPageView {
  const courses = coursesOn ? product.unlockedCourses : [];
  const lives = coursesOn ? product.unlockedLives : [];
  const back = productBack(product, courses, lives, t, { fromCommunity, fromCourse, fromLive });

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

  const unlocks = [
    ...(communitiesOn
      ? product.communities.map((community) => unlockRow(community, product.owned, t))
      : []),
    ...courses.map((course) => unlockCourseRow(course, product.owned, t)),
    ...lives.map((live) => unlockLiveRow(live, product.owned, t, timeZone)),
  ];

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

/**
 * The back control (UI-D-369, UI-D-439): the header's `BackLink` returns to the screen the member
 * came from (2026-10-09), so its label is always the bare "Voltar" and the href is only its fallback
 * for a direct entry: `?comunidade=`, then `?curso=`, then `?live=`, each honoured only when the
 * product's own list names that id; the href is built from the matched row, never echoed from the
 * URL (T-08.2-33, T-08.5-09). Otherwise `/loja`.
 */
function productBack(
  product: Pick<ProductDetail, 'communities'>,
  courses: readonly ProductUnlockCourse[],
  lives: readonly ProductUnlockLive[],
  t: Translator,
  {
    fromCommunity,
    fromCourse,
    fromLive,
  }: {
    fromCommunity?: string | string[] | undefined;
    fromCourse?: string | string[] | undefined;
    fromLive?: string | string[] | undefined;
  },
): ProductPageView['back'] {
  const community =
    typeof fromCommunity === 'string'
      ? product.communities.find((row) => row.id === fromCommunity)
      : undefined;
  if (community) {
    return {
      href: `/comunidades/${encodeURIComponent(community.id)}`,
      label: t('store.product.back'),
    };
  }
  const course =
    typeof fromCourse === 'string' ? courses.find((row) => row.id === fromCourse) : undefined;
  if (course) {
    return {
      href: `/cursos/${encodeURIComponent(course.id)}`,
      label: t('store.product.back'),
    };
  }
  const live = typeof fromLive === 'string' ? lives.find((row) => row.id === fromLive) : undefined;
  if (live) {
    return {
      href: `/cursos/lives/${encodeURIComponent(live.id)}`,
      label: t('store.product.back'),
    };
  }
  return { href: '/loja', label: t('store.product.back') };
}

/** The `/cursos/…` href of an unlocked course or live, built from the row's own id. */
export function courseHref(courseId: string): string {
  return `/cursos/${encodeURIComponent(courseId)}`;
}

export function liveHref(liveId: string): string {
  return `/cursos/lives/${encodeURIComponent(liveId)}`;
}

/** "Live · {date}, {time}" in the tenant's timezone (planning decision 3, `liveDateParts`). */
function liveKindMeta(startsAt: string, t: Translator, timeZone: string): string {
  return t('store.product.unlocks.kindLive', liveDateParts(startsAt, timeZone));
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
    kind: 'community',
    thumbRatio: UNLOCK_THUMB_RATIO.community,
    meta: t('store.product.unlocks.kindCommunity'),
  };
}

function unlockCourseRow(
  course: ProductUnlockCourse,
  owned: boolean,
  t: Translator,
): ProductUnlockRow {
  return {
    id: course.id,
    name: course.title,
    coverAssetId: course.coverAssetId,
    href: owned ? courseHref(course.id) : null,
    ariaLabel: owned
      ? t('store.product.unlocks.rowOpenCourse', { course: course.title })
      : t('store.product.unlocks.rowLockedCourse', { course: course.title }),
    kind: 'course',
    thumbRatio: UNLOCK_THUMB_RATIO.course,
    meta: t('store.product.unlocks.kindCourse'),
  };
}

function unlockLiveRow(
  live: ProductUnlockLive,
  owned: boolean,
  t: Translator,
  timeZone: string,
): ProductUnlockRow {
  return {
    id: live.id,
    name: live.title,
    coverAssetId: live.coverAssetId,
    href: owned ? liveHref(live.id) : null,
    ariaLabel: owned
      ? t('store.product.unlocks.rowOpenLive', { live: live.title })
      : t('store.product.unlocks.rowLockedLive', { live: live.title }),
    kind: 'live',
    thumbRatio: UNLOCK_THUMB_RATIO.live,
    meta: liveKindMeta(live.startsAt, t, timeZone),
  };
}

/**
 * The owned block's DOM id on the product page: where focus lands once the refresh after a
 * purchase replaces "Comprar" with it (UI-D-386). Shared here because a server page cannot read a
 * value exported from a client module.
 */
export const STORE_OWNED_BLOCK_ID = 'store-product-owned';

/** The most target names the confirm body spells out before "e mais {n}" (UI-D-370, UI-D-440). */
const PURCHASE_BODY_NAMES = 2;

/**
 * The confirm step's target list (UI-D-370, UI-D-440): `Intl.ListFormat('pt-BR', conjunction)` of
 * at most two names; with more, the two names keep the list's own separator and the catalog's
 * "e mais {n}" closes it: "A e B", "A, B e mais 2". The catalog phrase carries its own "e", so it
 * is appended after the two names rather than formatted as a third list item, which would read
 * "A, B e e mais 2".
 */
function targetsList(names: readonly string[], t: Translator): string {
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
 * The confirm body (UI-D-370, D-361, UI-D-388, UI-D-440): the price ("Grátis" at R$ 0, through
 * `priceLabel`, the SAME `priceCents` the page shows and the action sends, P26), then, only when
 * the product unlocks something, the names of every target in the shipped `{communities}` slot,
 * communities first, then courses, then lives (EP-59), two names then "e mais {n}". It promises the
 * access and nothing else: no payment word, since no payment is taken (UI-D-388).
 */
export function purchaseBodyText(
  product: Pick<ProductDetail, 'priceCents' | 'communities' | 'unlockedCourses' | 'unlockedLives'>,
  t: Translator,
): string {
  const price = priceLabel(product.priceCents, t);
  const names = [
    ...product.communities.map((community) => community.name),
    ...product.unlockedCourses.map((course) => course.title),
    ...product.unlockedLives.map((live) => live.title),
  ];
  if (names.length === 0) return t('store.purchase.body', { price });
  return t('store.purchase.bodyCommunities', { price, communities: targetsList(names, t) });
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
  product: Pick<
    ProductDetail,
    'name' | 'priceCents' | 'communities' | 'unlockedCourses' | 'unlockedLives'
  >,
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

/**
 * One target of the success list, still data (UI-D-440): the host draws the thumb at `thumbRatio`
 * (the store UI's `UnlockThumb`). `meta` is the kind word ("Comunidade", "Curso", "Live · {date},
 * {time}") on a MIXED list only: a communities-only list carries none, so it renders exactly as the
 * 08.2 list did.
 */
export interface PurchaseSuccessItem {
  id: string;
  kind: UnlockKind;
  href: string;
  name: string;
  coverAssetId: string | null;
  thumbRatio: UnlockThumbRatio;
  meta: string | null;
}

/** The success step (UI-D-370 b, UI-D-440), by the number of targets the purchase answered. */
export interface PurchaseSuccessView {
  variant: 'none' | 'one' | 'several';
  title: string;
  body: string;
  /** `several` only: the link list, communities, then courses, then lives (EP-59). */
  items: PurchaseSuccessItem[];
  /** `one` only: "Ir para a comunidade" / "Ir para o curso" / "Ir para a live". */
  primary: { href: string; label: string } | null;
  closeLabel: string;
}

/** What the purchase ANSWERED (a first purchase and an `owned` replay answer the same lists). */
export interface PurchaseAnswerTargets {
  communities: readonly ProductCommunity[];
  courses: readonly ProductUnlockCourse[];
  lives: readonly ProductUnlockLive[];
}

/** The one-target sentence and link per kind (UI-D-440): gendered, the community's shipped. */
const SUCCESS_ONE: Record<UnlockKind, { body: string; arg: string; goTo: string }> = {
  community: {
    body: 'store.purchase.success.one',
    arg: 'community',
    goTo: 'store.purchase.success.goToCommunity',
  },
  course: {
    body: 'store.purchase.success.oneCourse',
    arg: 'course',
    goTo: 'store.purchase.success.goToCourse',
  },
  live: {
    body: 'store.purchase.success.oneLive',
    arg: 'live',
    goTo: 'store.purchase.success.goToLive',
  },
};

/**
 * The success step for the targets the purchase ANSWERED (UI-D-370 b, UI-D-440, P27): a first
 * purchase and an `owned` replay answer the same lists, so both draw the same step.
 *  - none → "{product} agora é seu." with only "Fechar" (P28, D-353, EP-58);
 *  - one → the gendered sentence ("{community} já está liberada…", "{course} já está liberado…",
 *    "{live} já está liberada…") with "Ir para a comunidade" / "o curso" / "a live" (EP-57);
 *  - several → "Estas comunidades já estão liberadas para você:" when every target is a community
 *    (the 08.2 step, unchanged), else "Estes conteúdos já estão liberados para você:" and the list
 *    with each row's kind meta; never a primary link beside the list (EP-57).
 * Every href is built from the answered row (`encodeURIComponent`), never from the URL (T-08.2-37).
 * `timeZone` is the tenant's: a live's meta reads the same as on the product page.
 */
export function successView(
  product: Pick<ProductDetail, 'name'>,
  answer: PurchaseAnswerTargets,
  t: Translator,
  timeZone: string,
): PurchaseSuccessView {
  const base = {
    title: t('store.purchase.success.title'),
    closeLabel: t('store.purchase.success.close'),
  };
  const mixed = answer.courses.length > 0 || answer.lives.length > 0;
  const items: PurchaseSuccessItem[] = [
    ...answer.communities.map((community) => ({
      id: community.id,
      kind: 'community' as const,
      href: `/comunidades/${encodeURIComponent(community.id)}`,
      name: community.name,
      coverAssetId: community.coverAssetId,
      thumbRatio: UNLOCK_THUMB_RATIO.community,
      meta: mixed ? t('store.product.unlocks.kindCommunity') : null,
    })),
    ...answer.courses.map((course) => ({
      id: course.id,
      kind: 'course' as const,
      href: courseHref(course.id),
      name: course.title,
      coverAssetId: course.coverAssetId,
      thumbRatio: UNLOCK_THUMB_RATIO.course,
      meta: t('store.product.unlocks.kindCourse'),
    })),
    ...answer.lives.map((live) => ({
      id: live.id,
      kind: 'live' as const,
      href: liveHref(live.id),
      name: live.title,
      coverAssetId: live.coverAssetId,
      thumbRatio: UNLOCK_THUMB_RATIO.live,
      meta: liveKindMeta(live.startsAt, t, timeZone),
    })),
  ];

  const [first] = items;
  if (!first) {
    return {
      ...base,
      variant: 'none',
      body: t('store.purchase.success.none', { product: product.name }),
      items: [],
      primary: null,
    };
  }
  if (items.length === 1) {
    const keys = SUCCESS_ONE[first.kind];
    return {
      ...base,
      variant: 'one',
      body: t(keys.body, { [keys.arg]: first.name }),
      items: [],
      primary: { href: first.href, label: t(keys.goTo) },
    };
  }
  return {
    ...base,
    variant: 'several',
    body: mixed ? t('store.purchase.success.severalMixed') : t('store.purchase.success.several'),
    items,
    primary: null,
  };
}

/**
 * The return to a locked course or live (UI-D-440, STORE-07, T-08.2-37 extended as T-08.5-09):
 * the page's `?curso=` / `?live=` steers ONLY when the purchase ANSWER lists that id, and the
 * href and the toast are built from the answered row, never from the URL. `null` → show the normal
 * success step (E14 partial). A community origin is checked first by the caller (the 08.2 rule).
 */
export interface PurchaseReturn {
  href: string;
  toast: string;
}

export function purchaseReturnView(
  answer: Pick<PurchaseAnswerTargets, 'courses' | 'lives'>,
  { fromCourse, fromLive }: { fromCourse?: string | undefined; fromLive?: string | undefined },
  t: Translator,
): PurchaseReturn | null {
  const course =
    fromCourse !== undefined ? answer.courses.find((row) => row.id === fromCourse) : undefined;
  if (course) {
    return {
      href: courseHref(course.id),
      toast: t('store.purchase.success.returnedCourse', { course: course.title }),
    };
  }
  const live = fromLive !== undefined ? answer.lives.find((row) => row.id === fromLive) : undefined;
  if (live) {
    return {
      href: liveHref(live.id),
      toast: t('store.purchase.success.returnedLive', { live: live.title }),
    };
  }
  return null;
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

/* ── 08.5-07: the locked course's buy section (UI-D-428, D-424, STORE-23) ───────────────────── */

/**
 * Everything a locked course's buy section says (08.5-07, UI-D-428, A-UI-2), the community
 * `lockedPageView`'s top section at course scale — that builder stays byte-identical:
 *  - `section`: `one` (one buyable product: a LINK to `/loja/{id}?curso={courseId}`), `many` (two or
 *    more: a button opens the "Opções de acesso" sheet, rows to `/loja/{id}?curso={courseId}`) or
 *    `none` (every linked product archived: no section, only "Este curso não está à venda no
 *    momento." in a card);
 *  - `body`: "Compre {product} para assistir a todas as aulas de {course}." — "Obtenha {product}
 *    grátis …" at R$ 0 — or "Escolha um produto …" with several.
 * The product ids come from the API's own answer and are encoded (T-08.5-30); the product page
 * steers back only when the purchase answer lists the course (plan 12). The words of the action
 * ("Comprar para liberar") are the host's (`courses.member.locked.buy`).
 *
 * **`mode: 'lesson'`** (08.5-08, UI-D-431, planning decision 4): the SAME section on a lesson's lock
 * page — title "Aula exclusiva" and the lesson bodies ("Compre {product} para assistir a esta aula e
 * a todo o curso.", the R$ 0 and several-products siblings); the hrefs, the sheet and the
 * not-for-sale line are the course's, so the buy path is one path whichever surface opened it.
 */
export type LockedCourseMode = 'course' | 'lesson';

const LOCKED_COURSE_KEYS: Record<
  LockedCourseMode,
  { title: string; bodyOne: string; bodyOneFree: string; bodyMany: string }
> = {
  course: {
    title: 'store.locked.course.title',
    bodyOne: 'store.locked.course.bodyOne',
    bodyOneFree: 'store.locked.course.bodyOneFree',
    bodyMany: 'store.locked.course.bodyMany',
  },
  lesson: {
    title: 'store.locked.course.lessonTitle',
    bodyOne: 'store.locked.course.lessonBodyOne',
    bodyOneFree: 'store.locked.course.lessonBodyOneFree',
    bodyMany: 'store.locked.course.lessonBodyMany',
  },
};

export interface LockedCourseView {
  section: 'one' | 'many' | 'none';
  /** "Curso exclusivo". */
  title: string;
  /** The section body (`one`, `many`) or the not-for-sale line (`none`). */
  body: string;
  /** `section: 'one'` only. */
  productHref: string | null;
  /** `section: 'many'` only, in the server's order (newest first). */
  choices: LockedChoiceView[];
  choiceTitle: string;
  /** "Qualquer um destes produtos libera {course}." */
  choiceHelper: string;
  archivedTag: boolean;
}

export function lockedCourseView(
  access: Pick<CourseAccess, 'archivedTag' | 'buyableProducts'>,
  { courseId, courseTitle }: { courseId: string; courseTitle: string },
  t: Translator,
  { mode = 'course' }: { mode?: LockedCourseMode } = {},
): LockedCourseView {
  const keys = LOCKED_COURSE_KEYS[mode];
  const query = `?curso=${encodeURIComponent(courseId)}`;
  const products = access.buyableProducts;
  const section: LockedCourseView['section'] =
    products.length === 0 ? 'none' : products.length === 1 ? 'one' : 'many';
  const first = products[0];

  let body: string;
  if (section === 'one' && first) {
    body = t(first.priceCents === 0 ? keys.bodyOneFree : keys.bodyOne, {
      product: first.name,
      course: courseTitle,
    });
  } else if (section === 'many') {
    body = t(keys.bodyMany, { course: courseTitle });
  } else {
    body = t('store.locked.course.unavailable');
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
    section,
    title: t(keys.title),
    body,
    productHref:
      section === 'one' && first ? `/loja/${encodeURIComponent(first.id)}${query}` : null,
    choices,
    choiceTitle: t('store.locked.choice.title'),
    choiceHelper: t('store.locked.choice.helperCourse', { course: courseTitle }),
    archivedTag: access.archivedTag,
  };
}

/* ── 08.5-09: the locked live's buy section (UI-D-435, UI-D-428, D-424, STORE-23) ───────────── */

/**
 * Everything a locked live's buy section says (08.5-09, UI-D-435): `lockedCourseView`'s shape at
 * live scale, so the live page renders the SAME plan-07 locked markup (`CourseActionZone`):
 *  - `section`: `one` (a LINK to `/loja/{id}?live={liveId}`), `many` (the "Opções de acesso" sheet,
 *    rows to `/loja/{id}?live={liveId}`, helper "Qualquer um destes produtos libera {live}.") or
 *    `none` ("Esta live não está à venda no momento." in a card);
 *  - `title` "Live exclusiva"; `body` "Compre {product} para entrar nesta live e assistir à
 *    gravação." — "Obtenha {product} grátis …" at R$ 0 — or "Escolha um produto …" with several.
 * The product ids come from the API's own answer and are encoded (T-08.5-30). A tap only navigates
 * (PR-4): the product page's shipped `PurchaseDialog` confirms.
 */
export type LockedLiveView = LockedCourseView;

export function lockedLiveView(
  access: Pick<LiveAccess, 'archivedTag' | 'buyableProducts'>,
  { liveId, liveTitle }: { liveId: string; liveTitle: string },
  t: Translator,
): LockedLiveView {
  const query = `?live=${encodeURIComponent(liveId)}`;
  const products = access.buyableProducts;
  const section: LockedLiveView['section'] =
    products.length === 0 ? 'none' : products.length === 1 ? 'one' : 'many';
  const first = products[0];

  let body: string;
  if (section === 'one' && first) {
    body = t(
      first.priceCents === 0 ? 'store.locked.live.bodyOneFree' : 'store.locked.live.bodyOne',
      {
        product: first.name,
        live: liveTitle,
      },
    );
  } else if (section === 'many') {
    body = t('store.locked.live.bodyMany', { live: liveTitle });
  } else {
    body = t('store.locked.live.unavailable');
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
    section,
    title: t('store.locked.live.title'),
    body,
    productHref:
      section === 'one' && first ? `/loja/${encodeURIComponent(first.id)}${query}` : null,
    choices,
    choiceTitle: t('store.locked.choice.title'),
    choiceHelper: t('store.locked.choice.helperLive', { live: liveTitle }),
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

/**
 * A course as the product form draws it (08.4, UI-D-414): a selected row and a picker row share this
 * shape. `meta` is finished on the server: "Rascunho" on a draft, `null` on a published course.
 */
export interface ProductFormCourse {
  id: string;
  title: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  meta: string | null;
}

/**
 * One product-form picker list as the page hands it to the form (08.4, UI-D-415, UI-D-419): the
 * rows, `failed` when the list could not be read (the sheet says so; the saved rows still show), and
 * `capped` when the walk stopped at its page cap (the helper says only the most recent are shown).
 */
export interface ProductFormLinkList<T> {
  items: readonly T[];
  failed: boolean;
  capped: boolean;
}

/** The course fields the product form needs: a picker row (`CourseRow`) and a linked course share them. */
export interface ProductFormCourseInput {
  id: string;
  title: string;
  coverAssetId: string | null;
  status: string;
}

/**
 * A course -> the product form's row (08.4, UI-D-414, UI-D-415): the `cover` ladder for the 32px 3:4
 * thumb, and the meta "Rascunho" (the shipped `courses.status.draft`) on a draft only. Built on the
 * server with the full-key translator (UI-D-288).
 */
export function productFormCourseView(
  row: ProductFormCourseInput,
  t: Translator,
): ProductFormCourse {
  return {
    id: row.id,
    title: row.title,
    coverAssetId: row.coverAssetId,
    coverVariantWidths: PURPOSE_WIDTHS.cover,
    meta: row.status === 'draft' ? t('courses.status.draft') : null,
  };
}

/**
 * A live as the product form draws it (08.4, UI-D-414): a selected row and a picker row share this
 * shape. `meta` is "{date}, {time} · {status}", finished on the server in the tenant's timezone.
 */
export interface ProductFormLive {
  id: string;
  title: string;
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
  meta: string;
}

/** The live fields the product form needs: a picker row (`LiveRow`) and a linked live share them. */
export interface ProductFormLiveInput {
  id: string;
  title: string;
  coverAssetId: string | null;
  startsAt: string;
  status: 'scheduled' | 'live' | 'recorded' | 'cancelled';
}

/**
 * A live -> the product form's row (08.4, UI-D-414, UI-D-415): the `cover` ladder for the 48px 16:10
 * thumb, and the meta "{date}, {time} · {status}" with the 08.3 live row's date halves
 * (`liveDateParts`, the TENANT's timezone, never the device's) and the shipped status words
 * (Agendada / Ao vivo / Gravada). The status is the API's projection; nothing here reads the clock.
 */
export function productFormLiveView(
  row: ProductFormLiveInput,
  t: Translator,
  timeZone: string,
): ProductFormLive {
  const { date, time } = liveDateParts(row.startsAt, timeZone);
  return {
    id: row.id,
    title: row.title,
    coverAssetId: row.coverAssetId,
    coverVariantWidths: PURPOSE_WIDTHS.cover,
    meta: t('store.form.lives.meta', { date, time, status: t(`courses.status.${row.status}`) }),
  };
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
  /**
   * The product's linked DRAFT and PUBLISHED courses, in the API's order (08.4; manager-only in the
   * detail, `[]` when absent). A link to an archived course is not listed and is kept on save.
   */
  courses: ProductFormCourse[];
  /**
   * The product's linked NON-CANCELLED lives, in the API's order (08.4; manager-only in the detail,
   * `[]` when absent). A link to a cancelled live is not listed and is kept on save.
   */
  lives: ProductFormLive[];
  status: ProductDetail['status'];
}

/**
 * `ProductDetail` -> the edit form's defaults (UI-D-377): the price shown as "19,90" from cents, the
 * linked communities with the `cover` ladder the product page also uses for their 32px thumbs, and
 * (08.4) the linked courses and lives as `productFormCourseView` / `productFormLiveView` rows. `t` is the full-key translator and
 * `timeZone` the tenant's, so every meta line is finished on the server (UI-D-288).
 */
export function productFormDefaults(
  product: ProductDetail,
  t: Translator,
  timeZone: string,
): ProductFormDefaults {
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
    courses: (product.courses ?? []).map((course) => productFormCourseView(course, t)),
    lives: (product.lives ?? []).map((live) => productFormLiveView(live, t, timeZone)),
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
/* ── 08.4: the same block on the course and live forms (D-418, UI-D-417, UI-D-418) ─────────── */

/** One product in "Liberada pelos produtos: …", with the archived suffix already decided. */
export interface CommunityAccessProductView {
  id: string;
  name: string;
  href: string;
  archived: boolean;
}

/** The same view, named for the course and live forms' read-only "Acesso" line (08.4). */
export type AccessProductView = CommunityAccessProductView;

/** What the builder reads: a community's `CommunityProduct` and a course's `CourseProduct` both fit. */
type AccessProductInput = Pick<CommunityProduct, 'id' | 'name'> & {
  status: 'active' | 'archived';
};

/**
 * The manager's `products` (every linked product, archived included) -> the block's links, in the
 * API's order. `/loja/{id}` is built from the id only (never from tenant text).
 */
export function communityAccessProductsView(
  products: readonly AccessProductInput[],
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

/** The catalog sentences the builder fills: the community form's, the course form's, the live form's. */
export type AccessValueKey =
  | 'communities.form.access.value'
  | 'courses.form.access.value'
  | 'courses.live.form.access.value';

/**
 * "Liberada pelos produtos: {products}" (UI-D-379) as segments the form renders: the catalog text
 * (`valueKey`: the community, course or live sentence) around the list, and each product as its own
 * segment between the `Intl.ListFormat` (pt-BR, conjunction) separators, so every name can be a
 * link while the sentence stays the catalog's. Call it with at least one product; the community
 * form's empty case is the "Aberta para todos os membros." line, and the course and live forms
 * render nothing at all for it (08.4, UI-D-417, UI-D-418).
 */
export function communityAccessSegments(
  products: readonly CommunityAccessProductView[],
  t: Translator,
  valueKey: AccessValueKey,
): CommunityAccessSegment[] {
  const [before = '', after = ''] = t(valueKey, {
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
