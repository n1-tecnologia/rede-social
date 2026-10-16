import {
  type EngagementBand,
  type OwnerBandScope,
  ownerBandIncludes,
  ownerBandRoster,
  ownerScopeBands,
  tenantOwnerPanel,
} from '@rede-social/module-dashboard/fixtures';
import { ENGAGEMENT_BAND_ORDER } from '@rede-social/module-dashboard/ui';
import { ownerAreaHref } from './owner-panel';

/*
 * Kept apart from owner-panel.ts on purpose: that file holds no fixture, so a screen can read the
 * areas cheaply. This module imports it, never the reverse.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** The id of the "Faixas de engajamento" section: every cascade link lands on it. */
export const OWNER_BANDS_ANCHOR = 'faixas';

/**
 * The communities the level-4 bands can be scoped to (quick 261012-pkd D-01), in the fixture's order.
 * The `?comunidade=` value is the fixture id without its `c-` prefix.
 */
export const OWNER_COMMUNITIES: readonly { id: string; slug: string }[] =
  tenantOwnerPanel.byCommunity.map(({ id }) => ({ id, slug: id.replace(/^c-/, '') }));

/**
 * The events the level-4 bands can be scoped to (quick 261012-qer B-2): the panel's upcoming events
 * soonest first, then its past ones most recent first. The `?evento=` value is the fixture id.
 */
export const OWNER_EVENTS: readonly { id: string; name: string; date: string }[] = [
  ...tenantOwnerPanel.events.upcoming,
  ...[...tenantOwnerPanel.events.past].reverse(),
].map(({ id, name, date }) => ({ id, name, date }));

/** The id of an event's row in the Eventos area's "Lista de espera" (quick 261014-ia8 F-1). */
export function ownerWaitlistAnchor(eventId: string): string {
  return `espera-${eventId}`;
}

/** The Eventos area, landing on an event's waiting-list row: where a full event's links lead. */
export function ownerWaitlistHref(eventId: string): string {
  return `${ownerAreaHref('eventos')}#${ownerWaitlistAnchor(eventId)}`;
}

/** The `?faixa=` slug of each band (quick 261012-qer B-3): the band a member link came from. */
export const OWNER_BAND_SLUGS: Readonly<Record<EngagementBand, string>> = {
  new: 'novos',
  superfan: 'superfas',
  engaged: 'engajados',
  occasional: 'ocasionais',
  at_risk: 'em-risco',
  inactive: 'inativos',
};

const OWNER_MEMBER_IDS: readonly string[] = ownerBandRoster.map((row) => row.id);

/** The `?lista=` slug of each list behind a member's insight numbers (quick 261012-tru D-07). */
export const OWNER_MEMBER_LISTS = [
  'dias-ativos',
  'curtidas',
  'comentarios',
  'acoes-fortes',
  'posts-vistos',
] as const;

export type OwnerMemberListSlug = (typeof OWNER_MEMBER_LISTS)[number];

/** The id of a member list's wrapper: a list link lands on it. */
export const OWNER_MEMBER_LIST_ANCHOR = 'lista';

/** The id of the insight card a list's "Voltar" returns to. */
export function ownerInsightAnchor(slug: OwnerMemberListSlug): string {
  return `insight-${slug}`;
}

/**
 * Where the Membros area stands in the cascade (quick 261012-tru D-05..D-07): the tab (`kind`), the
 * open band (null = all closed), the community or event opened inside that band (Por comunidade and
 * Por evento only; null = the band lists the cards), the member whose insights replace the area
 * (null = the area itself) and the list behind one of their numbers (null = the insights). Each
 * level is only ever set with the levels above it.
 */
export interface OwnerMembersView {
  kind: OwnerBandScope['kind'];
  band: EngagementBand | null;
  itemId: string | null;
  memberId: string | null;
  list: OwnerMemberListSlug | null;
}

const RECORTES = ['membro', 'comunidade', 'evento'] as const;

const KIND_OF_RECORTE = {
  membro: 'member',
  comunidade: 'community',
  evento: 'event',
} as const satisfies Record<(typeof RECORTES)[number], OwnerBandScope['kind']>;

/** A query value only when it is a single string, exactly one of `allowed`. */
function pick<T extends string>(raw: string | string[] | undefined, allowed: readonly T[]) {
  return typeof raw === 'string' ? allowed.find((value) => value === raw) : undefined;
}

/** The band of a `faixa` slug: exact and single, else null. */
function parseBand(params: SearchParams): EngagementBand | null {
  const raw = params.faixa;
  if (typeof raw !== 'string') return null;
  return ENGAGEMENT_BAND_ORDER.find((band) => OWNER_BAND_SLUGS[band] === raw) ?? null;
}

/** The allow-listed community or event the query names for the tab, else null. */
function parseItem(params: SearchParams, kind: OwnerBandScope['kind']): string | null {
  if (kind === 'community') {
    const slug = pick(
      params.comunidade,
      OWNER_COMMUNITIES.map((row) => row.slug),
    );
    return OWNER_COMMUNITIES.find((row) => row.slug === slug)?.id ?? null;
  }
  if (kind === 'event') {
    return (
      pick(
        params.evento,
        OWNER_EVENTS.map((row) => row.id),
      ) ?? null
    );
  }
  return null;
}

/**
 * The list a member card of the view comes from: the whole base in Por membro, the opened community
 * or event otherwise, and none while a band only lists its cards.
 */
export function ownerListScope(
  view: Pick<OwnerMembersView, 'kind' | 'itemId'>,
): OwnerBandScope | null {
  if (view.kind === 'member') return { kind: 'member' };
  return view.itemId === null ? null : { kind: view.kind, id: view.itemId };
}

/**
 * The view the query asks for (untrusted), read level by level; an invalid value at any level falls
 * to the level above, never to an error (D-06):
 * 1. `recorte` picks Por membro, Por comunidade or Por evento; anything else is Por membro.
 * 2. `faixa` is a band slug, else every band is closed.
 * 3. `comunidade` (Por comunidade) or `evento` (Por evento) opens that item inside the band, only
 *    when the band is open, the value is exact and allow-listed, and the item has members in the
 *    band; else the band lists the cards.
 * 4. `membro` is a roster id that must sit in the band of the opened list (`ownerBandIncludes`);
 *    else the list shows with its band open.
 * 5. `lista` is one of OWNER_MEMBER_LISTS, only with a member; else the insights (or the level above).
 * Only allow-listed constants ever reach markup or URLs.
 */
export function parseOwnerMembersView(params: SearchParams): OwnerMembersView {
  const recorte = pick(params.recorte, RECORTES);
  const kind = recorte ? KIND_OF_RECORTE[recorte] : 'member';
  const band = parseBand(params);
  const item = band ? parseItem(params, kind) : null;
  const itemId =
    item !== null &&
    kind !== 'member' &&
    band &&
    ownerScopeBands({ kind, id: item }).counts[band] > 0
      ? item
      : null;
  const listScope = ownerListScope({ kind, itemId });
  const id = pick(params.membro, OWNER_MEMBER_IDS);
  const memberId = id && band && listScope && ownerBandIncludes(listScope, band, id) ? id : null;
  const list = memberId ? (pick(params.lista, OWNER_MEMBER_LISTS) ?? null) : null;
  return { kind, band, itemId, memberId, list };
}

/** A community's `?comunidade=` slug; an id the fixture does not have is a bug. */
function communitySlug(id: string): string {
  const slug = OWNER_COMMUNITIES.find((row) => row.id === id)?.slug;
  if (!slug) throw new Error(`no community ${id}`);
  return slug;
}

/**
 * The link to a cascade view: the Membros area, then `recorte`, the item, `faixa`, `membro` and
 * `lista` in that order. Landing on the bands (`#faixas`) until a member opens, whose insights start
 * the area; a list lands on itself (`#lista`).
 */
export function ownerMembersHref(view: OwnerMembersView): string {
  let query = '';
  if (view.kind === 'community') query += '&recorte=comunidade';
  if (view.kind === 'event') query += '&recorte=evento';
  if (view.itemId !== null) {
    query +=
      view.kind === 'community'
        ? `&comunidade=${communitySlug(view.itemId)}`
        : `&evento=${view.itemId}`;
  }
  if (view.band) query += `&faixa=${OWNER_BAND_SLUGS[view.band]}`;
  if (view.memberId === null) return `${ownerAreaHref('membros')}${query}#${OWNER_BANDS_ANCHOR}`;
  query += `&membro=${view.memberId}`;
  if (view.list === null) return `${ownerAreaHref('membros')}${query}`;
  return `${ownerAreaHref('membros')}${query}&lista=${view.list}#${OWNER_MEMBER_LIST_ANCHOR}`;
}
