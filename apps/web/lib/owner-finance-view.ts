import {
  type EngagementBand,
  FINANCE_OFFERS,
  type FinanceOfferId,
  type FinancePeopleList,
  financeProductOffers,
  ownerFinanceBands,
  ownerFinanceIncludes,
  ownerFinanceNeverAgain,
  ownerFinanceWindow,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import { ENGAGEMENT_BAND_ORDER } from '@rede-social/module-dashboard/ui';
import {
  OWNER_BAND_SLUGS,
  OWNER_MEMBER_LISTS,
  type OwnerMemberListSlug,
  ownerInsightAnchor,
} from './owner-band-scope';
import { ownerAreaHref } from './owner-panel';

/*
 * Kept apart from owner-panel.ts on purpose (as owner-content-view.ts): that file holds no fixture.
 * This module imports it, never the reverse.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** The three tabs of the Financeiro area (quick 261014-dwc D-01). */
export type FinanceTab = 'overview' | 'products' | 'buyers';

/** The six numbers of Visão geral, each opening its list (D-07). */
export type FinanceNumber =
  | 'primary'
  | 'secondary'
  | 'share'
  | 'rebought'
  | 'timeToSecond'
  | 'lifetime';

/** The rows of "Precisa de atenção" that open a list of members (D-07). */
export type FinanceAttentionList = 'vipFading' | 'expiring';

/**
 * Where the Financeiro area stands in its cascade (D-01): the tab; on Visão geral, the number or the
 * attention row whose list is open; under Quem compra, the open band or the never-again list of a
 * band; a product (under Produtos, or opened from Visão geral: PD-10), one of its offers; a member
 * of the open list and the list behind one of their insight numbers.
 * Each level is only ever set with the levels above it.
 */
export interface OwnerFinanceView {
  tab: FinanceTab;
  number: FinanceNumber | null;
  attention: FinanceAttentionList | null;
  /** Quem compra: the band whose buyers are open (still a tab screen). */
  band: EngagementBand | null;
  /** Quem compra: the band whose members never bought again are listed. */
  neverBand: EngagementBand | null;
  productId: string | null;
  offerId: FinanceOfferId | null;
  memberId: string | null;
  list: OwnerMemberListSlug | null;
}

/** `?vista=` per tab; Visão geral has none. */
const TAB_SLUGS = { products: 'produtos', buyers: 'quem-compra' } as const;

/** The `?numero=` slug of each overview number. */
export const FINANCE_NUMBER_SLUGS: Readonly<Record<FinanceNumber, string>> = {
  primary: 'primaria',
  secondary: 'secundaria',
  share: 'parte-secundaria',
  rebought: 'recompra',
  timeToSecond: 'tempo-recompra',
  lifetime: 'por-membro',
};

/** The `?atencao=` slug of each attention row that opens members. */
export const FINANCE_ATTENTION_SLUGS: Readonly<Record<FinanceAttentionList, string>> = {
  vipFading: 'pagantes-sumindo',
  expiring: 'vencendo',
};

const PRODUCT_IDS: readonly string[] = tenantOwnerPanel.store.products.map((row) => row.id);
const OFFER_IDS: readonly FinanceOfferId[] = FINANCE_OFFERS.map((offer) => offer.id);

/** The offers that sold in the last 30 days: only those open a list of buyers. */
const SOLD_OFFERS: ReadonlySet<FinanceOfferId> = (() => {
  const { byOffer } = ownerFinanceWindow(0, 29);
  return new Set(OFFER_IDS.filter((id) => byOffer[id].orders > 0));
})();

/** The id of a product card (or of its row on Visão geral): Voltar from its detail lands on it. */
export function financeProductAnchor(productId: string): string {
  return `produto-${productId}`;
}

/** The id of an offer card on a product's detail: Voltar from its buyers lands on it. */
export function financeOfferAnchor(offerId: FinanceOfferId): string {
  return `oferta-${offerId}`;
}

/** The id of a member card in a list: Voltar from the insights lands on it. */
export function financeMemberAnchor(memberId: string): string {
  return `membro-${memberId}`;
}

/** The id of an overview number: Voltar from its list lands on it. */
export function financeNumberAnchor(number: FinanceNumber): string {
  return `numero-${FINANCE_NUMBER_SLUGS[number]}`;
}

/** The id of a never-again row of Quem compra: Voltar from its list lands on it. */
export function financeNeverAnchor(band: EngagementBand): string {
  return `nunca-${OWNER_BAND_SLUGS[band]}`;
}

/** The bands with buyers in the month (em risco and inativos never have: PD-4). */
const BUYING_BANDS: readonly EngagementBand[] = (() => {
  const bands = ownerFinanceBands();
  return ENGAGEMENT_BAND_ORDER.filter((band) => bands[band].buyers > 0);
})();

/** The bands with someone who entered and never bought again. */
const NEVER_BANDS: readonly EngagementBand[] = (() => {
  const never = ownerFinanceNeverAgain();
  return ENGAGEMENT_BAND_ORDER.filter((band) => never[band] > 0);
})();

/** The id of an attention row: Voltar from its list lands on it. */
export function financeAttentionAnchor(attention: FinanceAttentionList): string {
  return `atencao-${FINANCE_ATTENTION_SLUGS[attention]}`;
}

/** The people list behind an open number or attention row; null for one that lists no one. */
export function financePeopleListOf(
  view: Pick<OwnerFinanceView, 'number' | 'attention' | 'band' | 'neverBand'>,
): FinancePeopleList | null {
  if (view.number) return view.number === 'share' ? null : { kind: view.number };
  if (view.attention) return { kind: view.attention };
  if (view.band) return { kind: 'band', band: view.band };
  return view.neverBand ? { kind: 'never', band: view.neverBand } : null;
}

/** The band a query slug names, when it is one of `allowed`. */
function parseBand(
  raw: string | string[] | undefined,
  allowed: readonly EngagementBand[],
): EngagementBand | null {
  const band = bySlug(raw, OWNER_BAND_SLUGS);
  return band && allowed.includes(band) ? band : null;
}

/** A query value only when it is a single string, exactly one of `allowed`. */
function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]) {
  return typeof raw === 'string' ? allowed.find((value) => value === raw) : undefined;
}

/** The key whose slug the query names exactly, else undefined. */
function bySlug<K extends string>(
  raw: string | string[] | undefined,
  slugs: Readonly<Record<K, string>>,
): K | undefined {
  if (typeof raw !== 'string') return undefined;
  return (Object.keys(slugs) as K[]).find((key) => slugs[key] === raw);
}

/** The offer the query names: one of the opened product's that sold in the month. */
function parseOffer(params: SearchParams, productId: string | null): FinanceOfferId | null {
  if (!productId) return null;
  const id = pick(params.oferta, OFFER_IDS);
  if (!id || !SOLD_OFFERS.has(id)) return null;
  return financeProductOffers(productId).some((offer) => offer.id === id) ? id : null;
}

/** The member the query names, when the open list holds them (no names read here). */
function parseMember(params: SearchParams, list: FinancePeopleList | null): string | null {
  const id = typeof params.membro === 'string' ? params.membro : undefined;
  if (!id || !list) return null;
  return ownerFinanceIncludes(list, id) ? id : null;
}

/**
 * The view the query asks for (untrusted), read level by level; an invalid value at any level falls
 * to the level above, never to an error (D-01):
 * 1. `vista` is `produtos` or `quem-compra`, else Visão geral.
 * 2. On Visão geral, `numero` is one of FINANCE_NUMBER_SLUGS; else `atencao` one of
 *    FINANCE_ATTENTION_SLUGS.
 * 3. Under Quem compra, `faixa` is a band with buyers in the month; else `nunca` a band with
 *    someone who never bought again.
 * 4. `produto` is a store product, under Produtos or on Visão geral with no number nor attention
 *    (PD-10: the stalled product's row and the VIP line open it).
 * 5. `oferta` is one of the opened product's offers with orders in the last 30 days.
 * 6. `membro` must be in the open list (`ownerFinanceIncludes`): the offer's buyers, the people of
 *    the number or attention row (the share of add-ons lists products, not people), the band's
 *    buyers or its never-again members.
 * 7. `lista` is one of OWNER_MEMBER_LISTS, only with a member.
 * Only allow-listed constants ever reach markup or URLs.
 */
export function parseOwnerFinanceView(params: SearchParams): OwnerFinanceView {
  const tab = bySlug(params.vista, TAB_SLUGS) ?? 'overview';
  const number = tab === 'overview' ? (bySlug(params.numero, FINANCE_NUMBER_SLUGS) ?? null) : null;
  const attention =
    tab === 'overview' && number === null
      ? (bySlug(params.atencao, FINANCE_ATTENTION_SLUGS) ?? null)
      : null;
  const band = tab === 'buyers' ? parseBand(params.faixa, BUYING_BANDS) : null;
  const neverBand = tab === 'buyers' && band === null ? parseBand(params.nunca, NEVER_BANDS) : null;
  const productId =
    tab === 'products' || (tab === 'overview' && number === null && attention === null)
      ? (pick(params.produto, PRODUCT_IDS) ?? null)
      : null;
  const offerId = parseOffer(params, productId);
  const people: FinancePeopleList | null = offerId
    ? { kind: 'offer', offerId }
    : productId
      ? null
      : financePeopleListOf({ number, attention, band, neverBand });
  const memberId = parseMember(params, people);
  const list = memberId ? (pick(params.lista, OWNER_MEMBER_LISTS) ?? null) : null;
  return { tab, number, attention, band, neverBand, productId, offerId, memberId, list };
}

/**
 * The link to a cascade view: the area, then `vista`, `numero`, `atencao`, `produto`, `oferta`,
 * `faixa`, `nunca`, `membro` and `lista` in that order.
 */
export function ownerFinanceHref(view: OwnerFinanceView): string {
  let query = '';
  if (view.tab !== 'overview') query += `&vista=${TAB_SLUGS[view.tab]}`;
  if (view.number) query += `&numero=${FINANCE_NUMBER_SLUGS[view.number]}`;
  if (view.attention) query += `&atencao=${FINANCE_ATTENTION_SLUGS[view.attention]}`;
  if (view.productId) query += `&produto=${view.productId}`;
  if (view.offerId) query += `&oferta=${view.offerId}`;
  if (view.band) query += `&faixa=${OWNER_BAND_SLUGS[view.band]}`;
  if (view.neverBand) query += `&nunca=${OWNER_BAND_SLUGS[view.neverBand]}`;
  if (view.memberId) query += `&membro=${view.memberId}`;
  if (view.list) query += `&lista=${view.list}`;
  return `${ownerAreaHref('financeiro')}${query}`;
}

/**
 * "Voltar" one level up (D-01): the parent view's link landing on what was closed (the insight
 * number, the member card, the offer card, the product card or row, the never-again row, the
 * attention row, the overview number). Null on a tab screen (an open band is one: its members'
 * Voltar reopens it).
 */
export function financeBackHref(view: OwnerFinanceView): string | null {
  if (view.list) {
    return `${ownerFinanceHref({ ...view, list: null })}#${ownerInsightAnchor(view.list)}`;
  }
  if (view.memberId) {
    return `${ownerFinanceHref({ ...view, memberId: null })}#${financeMemberAnchor(view.memberId)}`;
  }
  if (view.offerId) {
    return `${ownerFinanceHref({ ...view, offerId: null })}#${financeOfferAnchor(view.offerId)}`;
  }
  if (view.productId) {
    return `${ownerFinanceHref({ ...view, productId: null })}#${financeProductAnchor(view.productId)}`;
  }
  if (view.neverBand) {
    return `${ownerFinanceHref({ ...view, neverBand: null })}#${financeNeverAnchor(view.neverBand)}`;
  }
  if (view.attention) {
    return `${ownerFinanceHref({ ...view, attention: null })}#${financeAttentionAnchor(view.attention)}`;
  }
  if (view.number) {
    return `${ownerFinanceHref({ ...view, number: null })}#${financeNumberAnchor(view.number)}`;
  }
  return null;
}

/** A tab screen with nothing open below it. */
export function financeTabView(tab: FinanceTab): OwnerFinanceView {
  return {
    tab,
    number: null,
    attention: null,
    band: null,
    neverBand: null,
    productId: null,
    offerId: null,
    memberId: null,
    list: null,
  };
}
