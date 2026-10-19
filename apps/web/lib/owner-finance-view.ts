import type { FinanceBuyerListId } from '@rede-social/module-dashboard/contracts';
import { z } from 'zod';
import {
  type EngagementBand,
  OWNER_BAND_SLUGS,
  OWNER_MEASURED_LISTS,
  type OwnerMeasuredListSlug,
  ownerInsightAnchor,
} from './owner-band-scope';
import { ownerAreaHref } from './owner-panel';

/*
 * The Financeiro area's URL (08.7-10, R-Pitfall 7): SYNTACTIC. Tabs, numbers, the attention row and
 * bands are slugs from closed lists; a product and a member are uuids. Whether a product is the
 * tenant's, or a member is in the opened list, is the API's to say: its 404 falls one level up
 * (D-06). Offers and the accesses that expire are "Em breve" (D-455, D-465): they are not a view, and
 * a hand-typed `&oferta=` or `&atencao=vencendo` falls one level up with no notice. No fixture is
 * read here.
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

/** The row of "Precisa de atenção" that opens a list of members: the VIP payers fading (UI-D-490). */
export type FinanceAttentionList = 'vipFading';

/**
 * Where the Financeiro area stands in its cascade (D-01): the tab; on Visão geral, the number or the
 * attention row whose list is open; under Quem compra, the open band or the never-again list of a
 * band; a product (under Produtos, or opened from Visão geral); a member of the open list and the
 * list behind one of their insight numbers. Each level is only ever set with the levels above it.
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
  memberId: string | null;
  list: OwnerMeasuredListSlug | null;
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

/** The `?atencao=` slug of the attention row that opens members. */
export const FINANCE_ATTENTION_SLUGS: Readonly<Record<FinanceAttentionList, string>> = {
  vipFading: 'pagantes-sumindo',
};

/** The API buyers list behind each overview number; the share of add-ons lists products. */
const NUMBER_LISTS: Readonly<Record<FinanceNumber, FinanceBuyerListId | null>> = {
  primary: 'primary',
  secondary: 'secondary',
  share: null,
  rebought: 'rebought',
  timeToSecond: 'time-to-second',
  lifetime: 'lifetime',
};

/** The id of a product card (or of its row on Visão geral): Voltar from its detail lands on it. */
export function financeProductAnchor(productId: string): string {
  return `produto-${productId}`;
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

/** The id of an attention row: Voltar from its list lands on it. */
export function financeAttentionAnchor(attention: FinanceAttentionList): string {
  return `atencao-${FINANCE_ATTENTION_SLUGS[attention]}`;
}

/** One of the API's buyers lists (`GET …/finance/buyers/{list}`) and its band. */
export interface FinancePeopleList {
  list: FinanceBuyerListId;
  band?: EngagementBand;
}

/** The API buyers list behind an open number, attention row, band or never-again band; else null. */
export function financePeopleListOf(
  view: Pick<OwnerFinanceView, 'number' | 'attention' | 'band' | 'neverBand'>,
): FinancePeopleList | null {
  if (view.number) {
    const list = NUMBER_LISTS[view.number];
    return list ? { list } : null;
  }
  if (view.attention) return { list: 'vip-fading' };
  if (view.band) return { list: 'band', band: view.band };
  return view.neverBand ? { list: 'never', band: view.neverBand } : null;
}

/**
 * The view a buyers list's rows open into, from the list alone (the pages the "Ver todos" island
 * appends, UI-D-477); null for a list the panel does not show (`product`, D-461: a product's buyers
 * are the store's screen) or a band list with no band.
 */
export function financeViewOfList(
  list: FinanceBuyerListId,
  band: EngagementBand | undefined,
): OwnerFinanceView | null {
  if (list === 'vip-fading') return { ...financeTabView('overview'), attention: 'vipFading' };
  if (list === 'band' || list === 'never') {
    if (!band) return null;
    return list === 'band'
      ? { ...financeTabView('buyers'), band }
      : { ...financeTabView('buyers'), neverBand: band };
  }
  const number = (Object.keys(NUMBER_LISTS) as FinanceNumber[]).find(
    (key) => NUMBER_LISTS[key] === list,
  );
  return number ? { ...financeTabView('overview'), number } : null;
}

const UUID = z.uuid();
const MEASURED_SLUGS = Object.keys(OWNER_MEASURED_LISTS) as OwnerMeasuredListSlug[];

/** A query value only when it is a single string, exactly one of `allowed`. */
function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]) {
  return typeof raw === 'string' ? allowed.find((value) => value === raw) : undefined;
}

/** A query value only when it is a single string that is a uuid. */
function uuidOf(raw: string | string[] | undefined): string | null {
  return typeof raw === 'string' && UUID.safeParse(raw).success ? raw : null;
}

/** The key whose slug the query names exactly, else undefined. */
function bySlug<K extends string>(
  raw: string | string[] | undefined,
  slugs: Readonly<Record<K, string>>,
): K | undefined {
  if (typeof raw !== 'string') return undefined;
  return (Object.keys(slugs) as K[]).find((key) => slugs[key] === raw);
}

/**
 * The view the query asks for (untrusted), read level by level; an invalid value at any level falls
 * to the level above with no notice (D-06):
 * 1. `vista` is `produtos` or `quem-compra`, else Visão geral.
 * 2. On Visão geral, `numero` is one of FINANCE_NUMBER_SLUGS; else `atencao` is `pagantes-sumindo`
 *    (the expiring accesses are "Em breve", D-465).
 * 3. Under Quem compra, `faixa` is a band slug; else `nunca` a band slug.
 * 4. `produto` is a uuid, under Produtos or on Visão geral with no number nor attention row (the
 *    stalled product's row opens it).
 * 5. `membro` is a uuid, only with a list of people open (a number other than the share of add-ons,
 *    the VIP row, a band or a never-again band), never under a product.
 * 6. `lista` is one of the four measured lists, only with a member.
 * `oferta` is never read: offers are "Em breve" (D-455).
 */
export function parseOwnerFinanceView(params: SearchParams): OwnerFinanceView {
  const tab = bySlug(params.vista, TAB_SLUGS) ?? 'overview';
  const number = tab === 'overview' ? (bySlug(params.numero, FINANCE_NUMBER_SLUGS) ?? null) : null;
  const attention =
    tab === 'overview' && number === null
      ? (bySlug(params.atencao, FINANCE_ATTENTION_SLUGS) ?? null)
      : null;
  const band = tab === 'buyers' ? (bySlug(params.faixa, OWNER_BAND_SLUGS) ?? null) : null;
  const neverBand =
    tab === 'buyers' && band === null ? (bySlug(params.nunca, OWNER_BAND_SLUGS) ?? null) : null;
  const productId =
    tab === 'products' || (tab === 'overview' && number === null && attention === null)
      ? uuidOf(params.produto)
      : null;
  const people = productId ? null : financePeopleListOf({ number, attention, band, neverBand });
  const memberId = people ? uuidOf(params.membro) : null;
  const list = memberId ? (pick(params.lista, MEASURED_SLUGS) ?? null) : null;
  return { tab, number, attention, band, neverBand, productId, memberId, list };
}

/**
 * The link to a cascade view: the area, then `vista`, `numero`, `atencao`, `produto`, `faixa`,
 * `nunca`, `membro` and `lista` in that order.
 */
export function ownerFinanceHref(view: OwnerFinanceView): string {
  let query = '';
  if (view.tab !== 'overview') query += `&vista=${TAB_SLUGS[view.tab]}`;
  if (view.number) query += `&numero=${FINANCE_NUMBER_SLUGS[view.number]}`;
  if (view.attention) query += `&atencao=${FINANCE_ATTENTION_SLUGS[view.attention]}`;
  if (view.productId) query += `&produto=${view.productId}`;
  if (view.band) query += `&faixa=${OWNER_BAND_SLUGS[view.band]}`;
  if (view.neverBand) query += `&nunca=${OWNER_BAND_SLUGS[view.neverBand]}`;
  if (view.memberId) query += `&membro=${view.memberId}`;
  if (view.list) query += `&lista=${view.list}`;
  return `${ownerAreaHref('financeiro')}${query}`;
}

/**
 * "Voltar" one level up (D-01): the parent view's link landing on what was closed (the insight
 * number, the member card, the product card or row, the never-again row, the attention row, the
 * overview number). Null on a tab screen (an open band is one: its members' Voltar reopens it).
 */
export function financeBackHref(view: OwnerFinanceView): string | null {
  if (view.list) {
    return `${ownerFinanceHref({ ...view, list: null })}#${ownerInsightAnchor(view.list)}`;
  }
  if (view.memberId) {
    return `${ownerFinanceHref({ ...view, memberId: null })}#${financeMemberAnchor(view.memberId)}`;
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
    memberId: null,
    list: null,
  };
}
