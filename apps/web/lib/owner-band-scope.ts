import type {
  EngagementBandId,
  OwnerBandScopeId,
  OwnerMemberListId,
} from '@rede-social/module-dashboard/contracts';
import { ENGAGEMENT_BAND_ORDER } from '@rede-social/module-dashboard/ui';
import { z } from 'zod';
import { type OwnerPanelFlags, ownerAreaHref } from './owner-panel';

/*
 * The Membros cascade's URL (08.7-05, R-Pitfall 7). Since 08.7-05 it holds no fixture: the parser is
 * SYNTACTIC (slugs from closed lists, ids that are uuids), and whether an id is a community, an event
 * or a member of the opened list is the API's answer — a 404 falls one level up (D-06).
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** An engagement band (the contract's id). */
export type EngagementBand = EngagementBandId;

/** The id of the "Faixas de engajamento" section: every cascade link lands on it. */
export const OWNER_BANDS_ANCHOR = 'faixas';

/** The `?faixa=` slug of each band (quick 261012-qer B-3): the band a member link came from. */
export const OWNER_BAND_SLUGS: Readonly<Record<EngagementBand, string>> = {
  new: 'novos',
  superfan: 'superfas',
  engaged: 'engajados',
  occasional: 'ocasionais',
  at_risk: 'em-risco',
  inactive: 'inativos',
};

/**
 * The `?lista=` slug of each list behind a member's insight numbers (quick 261012-tru D-07). The
 * Conteúdo and Financeiro sample areas still open all five; Membros opens the measured four.
 */
export const OWNER_MEMBER_LISTS = [
  'dias-ativos',
  'curtidas',
  'comentarios',
  'acoes-fortes',
  'posts-vistos',
] as const;

export type OwnerMemberListSlug = (typeof OWNER_MEMBER_LISTS)[number];

/** A list the API measures: its pt-BR slug at the web, its id at the API (08.7-04 decision 4). */
export type OwnerMeasuredListSlug = Exclude<OwnerMemberListSlug, 'posts-vistos'>;

/**
 * The four measured lists (D-461) and their API ids. "Publicações vistas" is "Em breve" (D-455): it
 * never opens, and a hand-typed `&lista=posts-vistos` falls to the member detail.
 */
export const OWNER_MEASURED_LISTS: Readonly<Record<OwnerMeasuredListSlug, OwnerMemberListId>> = {
  'dias-ativos': 'active-days',
  curtidas: 'likes',
  comentarios: 'comments',
  'acoes-fortes': 'strong-actions',
};

/** The id of a member list's wrapper: a list link lands on it. */
export const OWNER_MEMBER_LIST_ANCHOR = 'lista';

/** The id of the insight card a list's "Voltar" returns to. */
export function ownerInsightAnchor(slug: OwnerMemberListSlug): string {
  return `insight-${slug}`;
}

/** The three tabs of the bands: Por membro, Por comunidade, Por evento. */
export type OwnerMembersKind = 'member' | 'community' | 'event';

/** Where a band's member list is counted: the whole base, a community or an event. */
export type OwnerListScope = { kind: 'member' } | { kind: 'community' | 'event'; id: string };

/**
 * Where the Membros area stands in the cascade (quick 261012-tru D-05..D-07): the tab (`kind`), the
 * open band (null = all closed), the community or event opened inside that band (Por comunidade and
 * Por evento only; null = the band lists the cards), the member whose detail replaces the area
 * (null = the area itself) and the list behind one of their numbers (null = the detail). Each level
 * is only ever set with the levels above it.
 */
export interface OwnerMembersView {
  kind: OwnerMembersKind;
  band: EngagementBand | null;
  itemId: string | null;
  memberId: string | null;
  list: OwnerMeasuredListSlug | null;
}

const RECORTES = ['membro', 'comunidade', 'evento'] as const;

const KIND_OF_RECORTE = {
  membro: 'member',
  comunidade: 'community',
  evento: 'event',
} as const satisfies Record<(typeof RECORTES)[number], OwnerMembersKind>;

const MEASURED_SLUGS = Object.keys(OWNER_MEASURED_LISTS) as OwnerMeasuredListSlug[];

const UUID = z.uuid();

/** A query value only when it is a single string, exactly one of `allowed`. */
function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]) {
  return typeof raw === 'string' ? allowed.find((value) => value === raw) : undefined;
}

/** A query value only when it is a single string that is a uuid. */
function uuidOf(raw: string | string[] | undefined): string | null {
  return typeof raw === 'string' && UUID.safeParse(raw).success ? raw : null;
}

/** The band of a `faixa` slug: exact and single, else null. */
function parseBand(params: SearchParams): EngagementBand | null {
  const raw = params.faixa;
  if (typeof raw !== 'string') return null;
  return ENGAGEMENT_BAND_ORDER.find((band) => OWNER_BAND_SLUGS[band] === raw) ?? null;
}

/**
 * The list a member card of the view comes from: the whole base in Por membro, the opened community
 * or event otherwise, and none while a band only lists its cards.
 */
export function ownerListScope(
  view: Pick<OwnerMembersView, 'kind' | 'itemId'>,
): OwnerListScope | null {
  if (view.kind === 'member') return { kind: 'member' };
  return view.itemId === null ? null : { kind: view.kind, id: view.itemId };
}

/** The API band list behind a view's band: `GET /v1/dashboard/owner/members/bands/{band}`. */
export interface OwnerBandListParams {
  band: EngagementBand;
  scope: OwnerBandScopeId;
  scopeId?: string;
}

/** The band list a view's band reads, or null while a band only lists its cards. */
export function ownerBandListParams(
  view: Pick<OwnerMembersView, 'kind' | 'itemId'>,
  band: EngagementBand,
): OwnerBandListParams | null {
  const scope = ownerListScope(view);
  if (scope === null) return null;
  if (scope.kind === 'member') return { band, scope: 'base' };
  return { band, scope: scope.kind, scopeId: scope.id };
}

/**
 * The view the query asks for (untrusted), read level by level; an invalid value at any level falls
 * to the level above, never to an error (D-06):
 * 1. `recorte` picks Por membro, Por comunidade or Por evento; anything else is Por membro, and so is
 *    a tab whose module is off (`communities`, `events`; UI-D-471: no notice).
 * 2. `faixa` is a band slug, else every band is closed.
 * 3. `comunidade` (Por comunidade) or `evento` (Por evento) is a uuid, only with a band.
 * 4. `membro` is a uuid, only with a band (and the opened item off Por membro).
 * 5. `lista` is one of the four measured lists, only with a member.
 * Whether an id is the tenant's and sits in the opened list is decided by the API's answer.
 */
export function parseOwnerMembersView(
  params: SearchParams,
  flags: Pick<OwnerPanelFlags, 'communities' | 'events'>,
): OwnerMembersView {
  const recorte = pick(params.recorte, RECORTES);
  let kind: OwnerMembersKind = recorte ? KIND_OF_RECORTE[recorte] : 'member';
  if ((kind === 'community' && !flags.communities) || (kind === 'event' && !flags.events)) {
    kind = 'member';
  }
  const band = parseBand(params);
  const itemId =
    band && kind !== 'member'
      ? uuidOf(kind === 'community' ? params.comunidade : params.evento)
      : null;
  const opens = band !== null && ownerListScope({ kind, itemId }) !== null;
  const memberId = opens ? uuidOf(params.membro) : null;
  const list = memberId ? (pick(params.lista, MEASURED_SLUGS) ?? null) : null;
  return { kind, band, itemId, memberId, list };
}

/**
 * The link to a cascade view: the Membros area, then `recorte`, the item, `faixa`, `membro` and
 * `lista` in that order. Landing on the bands (`#faixas`) until a member opens, whose detail starts
 * the area; a list lands on itself (`#lista`).
 */
export function ownerMembersHref(view: OwnerMembersView): string {
  let query = '';
  if (view.kind === 'community') query += '&recorte=comunidade';
  if (view.kind === 'event') query += '&recorte=evento';
  if (view.itemId !== null) {
    query += view.kind === 'community' ? `&comunidade=${view.itemId}` : `&evento=${view.itemId}`;
  }
  if (view.band) query += `&faixa=${OWNER_BAND_SLUGS[view.band]}`;
  if (view.memberId === null) return `${ownerAreaHref('membros')}${query}#${OWNER_BANDS_ANCHOR}`;
  query += `&membro=${view.memberId}`;
  if (view.list === null) return `${ownerAreaHref('membros')}${query}`;
  return `${ownerAreaHref('membros')}${query}&lista=${view.list}#${OWNER_MEMBER_LIST_ANCHOR}`;
}
