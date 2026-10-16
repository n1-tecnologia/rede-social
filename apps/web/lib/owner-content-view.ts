import {
  type ContentItem,
  type ContentKind,
  type ContentWho,
  type EngagementBand,
  ownerContent,
  ownerContentIncludes,
  ownerContentInteractorIncludes,
  ownerContentItem,
  ownerContentItems,
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
 * Kept apart from owner-panel.ts on purpose (as owner-band-scope.ts): that file holds no fixture.
 * This module imports it, never the reverse.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** The three tabs of the Conteúdo area (quick 261013-h51 D-01). */
export type ContentTab = 'overview' | 'types' | 'posts';

/** The six numbers of Visão geral, each opening its list (D-02). */
export type ContentNumber = 'posts' | 'interactions' | 'rate' | 'members' | 'views' | 'reach';

/**
 * Where the Conteúdo area stands in its cascade (D-01): the tab; on Visão geral, the number whose
 * list is open or the band of "Quem interage" that is open; the type opened under Por tipo; the
 * publication; who did one of its numbers; the member opened from a list (a publication's people,
 * the interactors or a band) and the list behind one of the member's insight numbers. Each level is
 * only ever set with the levels above it. `reply` (quick 261013-orf E-02) is the post of "Precisa de
 * atenção" whose unanswered comments are open: only on Visão geral, and alone.
 */
export interface OwnerContentView {
  tab: ContentTab;
  number: ContentNumber | null;
  band: EngagementBand | null;
  kind: ContentKind | null;
  postId: string | null;
  who: ContentWho | null;
  memberId: string | null;
  list: OwnerMemberListSlug | null;
  reply: string | null;
}

/** `?vista=` per tab; Visão geral has none. */
const TAB_SLUGS = { types: 'tipos', posts: 'publicacoes' } as const;

/** The `?numero=` slug of each overview number (D-02). */
export const CONTENT_NUMBER_SLUGS: Readonly<Record<ContentNumber, string>> = {
  posts: 'publicacoes',
  interactions: 'interacoes',
  rate: 'taxa',
  members: 'membros',
  views: 'visualizacoes',
  reach: 'alcance',
};

/** The `?tipo=` slug of each kind (D-03). */
export const CONTENT_KIND_SLUGS: Readonly<Record<ContentKind, string>> = {
  video: 'video',
  photo: 'foto',
  carousel: 'carrossel',
  text: 'texto',
  link: 'link',
  story: 'story',
};

/** The `?quem=` slug of each interaction: there is no views or reach value (P3). */
export const CONTENT_WHO_SLUGS: Readonly<Record<ContentWho, string>> = {
  likes: 'curtidas',
  comments: 'comentarios',
  saves: 'salvamentos',
  shares: 'compartilhamentos',
};

/** The id of a publication card: Voltar from its detail lands on it. */
export function contentPostAnchor(postId: string): string {
  return `post-${postId}`;
}

/**
 * The id of a "Precisa de atenção" row: Voltar from its unanswered comments lands on it. Its own
 * prefix, so it never repeats the `post-` id of the same post's card below (E-03.10).
 */
export function contentAttentionAnchor(postId: string): string {
  return `atencao-${postId}`;
}

/** A comment waiting longer than this for the team's answer needs attention. */
const ATTENTION_HOURS = 24;

/** Whether a publication has a comment unanswered for over 24 hours ("Precisa de atenção"). */
export function needsAttention(item: Pick<ContentItem, 'kind' | 'commentMeta'>): boolean {
  return item.kind !== 'story' && (item.commentMeta.oldestUnansweredHours ?? 0) > ATTENTION_HOURS;
}

/** The id of a type card: Voltar from an opened type lands on it. */
export function contentKindAnchor(kind: ContentKind): string {
  return `tipo-${CONTENT_KIND_SLUGS[kind]}`;
}

/** The id of an interaction number on the detail: Voltar from its people lands on it. */
export function contentWhoAnchor(who: ContentWho): string {
  return `quem-${CONTENT_WHO_SLUGS[who]}`;
}

/** The id of a member card in a people list: Voltar from the insights lands on it. */
export function contentMemberAnchor(memberId: string): string {
  return `membro-${memberId}`;
}

/** The id of an overview number: Voltar from its list lands on it. */
export function contentNumberAnchor(number: ContentNumber): string {
  return `numero-${CONTENT_NUMBER_SLUGS[number]}`;
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

const ITEM_IDS: readonly string[] = ownerContentItems.map((item) => item.id);

/** The posts whose unanswered comments `responder` may open. */
const REPLY_IDS: readonly string[] = ownerContentItems
  .filter(needsAttention)
  .map((item) => item.id);

function itemOf(id: string): ContentItem {
  const item = ownerContentItems.find((row) => row.id === id);
  if (!item) throw new Error(`no content item ${id}`);
  return item;
}

/** The band of "Quem interage" the query opens: one with interactors (em risco and inativos have none). */
function parseBand(params: SearchParams): EngagementBand | null {
  const raw = params.faixa;
  if (typeof raw !== 'string') return null;
  const band = ENGAGEMENT_BAND_ORDER.find((row) => OWNER_BAND_SLUGS[row] === raw);
  return band && ownerContent.interactorsByBand[band] > 0 ? band : null;
}

/** The publication the query names, when the opened list holds it. */
function parsePost(
  params: SearchParams,
  view: Pick<OwnerContentView, 'tab' | 'number' | 'band' | 'kind'>,
): string | null {
  const id = pick(params.post, ITEM_IDS);
  if (!id) return null;
  const item = itemOf(id);
  if (view.tab === 'types') return view.kind !== null && item.kind === view.kind ? id : null;
  // The interactors and a band list people, not publications.
  if (view.number === 'members' || view.band !== null) return null;
  // Publicações and Visão geral list the 61 feed posts; stories live under Por tipo only (PD-1).
  return item.kind === 'story' ? null : id;
}

/** The member the query names, when the opened list holds them (no names read here). */
function parseMember(
  params: SearchParams,
  view: Pick<OwnerContentView, 'number' | 'band' | 'postId' | 'who'>,
): string | null {
  const id = typeof params.membro === 'string' ? params.membro : undefined;
  if (!id) return null;
  if (view.postId) return view.who && ownerContentIncludes(view.postId, view.who, id) ? id : null;
  if (view.number === 'members') return ownerContentInteractorIncludes(null, id) ? id : null;
  if (view.band) return ownerContentInteractorIncludes(view.band, id) ? id : null;
  return null;
}

/**
 * The view the query asks for (untrusted), read level by level; an invalid value at any level falls
 * to the level above, never to an error (D-01):
 * 1. `vista` is `tipos` or `publicacoes`, else Visão geral.
 * 2. On Visão geral, `numero` is one of CONTENT_NUMBER_SLUGS; else `faixa` opens a band of "Quem
 *    interage" that has interactors (em risco and inativos never do).
 * 3. `tipo` (Por tipo only) is one of CONTENT_KIND_SLUGS.
 * 4. `post` is a publication of the opened list: of the opened type under Por tipo (a story only
 *    there), any feed post under Publicações, Visão geral and its numbers of publications; none
 *    under the interactors or a band.
 * 5. `quem` is one of CONTENT_WHO_SLUGS, only with a post that has that number (a story has no
 *    saves). There is no views or reach value: those never open people (P3).
 * 6. `membro` must be in the opened list: the post's people (`ownerContentIncludes`), the
 *    interactors or that band's interactors (`ownerContentInteractorIncludes`).
 * 7. `lista` is one of OWNER_MEMBER_LISTS, only with a member.
 * `responder` (quick 261013-orf E-02) is read right after `faixa`: on Visão geral with no `numero` and
 * no `faixa`, the id of a post that `needsAttention`; with it every deeper param is ignored.
 * Only allow-listed constants ever reach markup or URLs.
 */
export function parseOwnerContentView(params: SearchParams): OwnerContentView {
  const tab = bySlug(params.vista, TAB_SLUGS) ?? 'overview';
  const number = tab === 'overview' ? (bySlug(params.numero, CONTENT_NUMBER_SLUGS) ?? null) : null;
  const band = tab === 'overview' && number === null ? parseBand(params) : null;
  const reply =
    tab === 'overview' && number === null && band === null
      ? (pick(params.responder, REPLY_IDS) ?? null)
      : null;
  if (reply) return { ...contentTabView('overview'), reply };
  const kind = tab === 'types' ? (bySlug(params.tipo, CONTENT_KIND_SLUGS) ?? null) : null;
  const postId = parsePost(params, { tab, number, band, kind });
  const rawWho = postId ? bySlug(params.quem, CONTENT_WHO_SLUGS) : undefined;
  const who =
    postId && rawWho && !(rawWho === 'saves' && itemOf(postId).saves === null) ? rawWho : null;
  const memberId = parseMember(params, { number, band, postId, who });
  const list = memberId ? (pick(params.lista, OWNER_MEMBER_LISTS) ?? null) : null;
  return { tab, number, band, kind, postId, who, memberId, list, reply: null };
}

/**
 * The link to a cascade view: the area, then `vista`, `numero`, `faixa`, `responder`, `tipo`, `post`,
 * `quem`, `membro` and `lista` in that order.
 */
export function ownerContentHref(view: OwnerContentView): string {
  let query = '';
  if (view.tab !== 'overview') query += `&vista=${TAB_SLUGS[view.tab]}`;
  if (view.number) query += `&numero=${CONTENT_NUMBER_SLUGS[view.number]}`;
  if (view.band) query += `&faixa=${OWNER_BAND_SLUGS[view.band]}`;
  if (view.reply) query += `&responder=${view.reply}`;
  if (view.kind) query += `&tipo=${CONTENT_KIND_SLUGS[view.kind]}`;
  if (view.postId) query += `&post=${view.postId}`;
  if (view.who) query += `&quem=${CONTENT_WHO_SLUGS[view.who]}`;
  if (view.memberId) query += `&membro=${view.memberId}`;
  if (view.list) query += `&lista=${view.list}`;
  return `${ownerAreaHref('conteudo')}${query}`;
}

/**
 * "Voltar" one level up (D-01): the parent view's link landing on what was closed (the insight
 * number, the member card, the interaction number, the publication card, the type card, the overview
 * number). Null on a tab screen (an opened band and an opened type are tab screens only when nothing
 * deeper is open; an opened type still goes back to the six types). The unanswered comments go back
 * to Visão geral, on their attention row.
 */
export function contentBackHref(view: OwnerContentView): string | null {
  if (view.reply) {
    return `${ownerContentHref({ ...view, reply: null })}#${contentAttentionAnchor(view.reply)}`;
  }
  if (view.list) {
    return `${ownerContentHref({ ...view, list: null })}#${ownerInsightAnchor(view.list)}`;
  }
  if (view.memberId) {
    return `${ownerContentHref({ ...view, memberId: null })}#${contentMemberAnchor(view.memberId)}`;
  }
  if (view.who) {
    return `${ownerContentHref({ ...view, who: null })}#${contentWhoAnchor(view.who)}`;
  }
  if (view.postId) {
    // Visão geral has no `post-` card for a post that needs attention (only its attention row):
    // its detail, opened from the unanswered comments screen, goes back to that row (quick
    // 261013-uoi F-7).
    const fromAttention =
      view.tab === 'overview' &&
      view.number === null &&
      view.band === null &&
      needsAttention(ownerContentItem(view.postId));
    const anchor = fromAttention
      ? contentAttentionAnchor(view.postId)
      : contentPostAnchor(view.postId);
    return `${ownerContentHref({ ...view, postId: null })}#${anchor}`;
  }
  if (view.kind) {
    return `${ownerContentHref({ ...view, kind: null })}#${contentKindAnchor(view.kind)}`;
  }
  if (view.number) {
    return `${ownerContentHref({ ...view, number: null })}#${contentNumberAnchor(view.number)}`;
  }
  return null;
}

/*
 * The cover takes the ratio the feed draws the media at (PD-2). The feed's own helpers live in client
 * files a server component cannot call, so their constants are repeated here:
 * apps/web/components/media/FeedVideo.tsx:33-46 (a video's own ratio clamped to [9:16, 1.91], 4:5
 * until the size is known) and packages/modules/feed/ui/PostMedia.tsx:97-115 (a gallery's first
 * image clamped to [4:5, 1.91], square without a size). A text post draws no media frame
 * (PostMedia.tsx:285-288); the link card is `aspect-video`; a story fills the 9:16 screen.
 */
const VIDEO_RANGE = [9 / 16, 1.91] as const;
const VIDEO_FALLBACK = 4 / 5;
const GALLERY_RANGE = [4 / 5, 1.91] as const;
const GALLERY_FALLBACK = 1;
const LINK_RATIO = 16 / 9;
const STORY_RATIO = 9 / 16;

function clampRatio(
  media: ContentItem['media'],
  [min, max]: readonly [number, number],
  fallback: number,
): number {
  if (!media || media.width <= 0 || media.height <= 0) return fallback;
  return Math.min(max, Math.max(min, media.width / media.height));
}

/** width / height of a publication's cover, or null when it has none (text). */
export function contentCoverRatio(item: Pick<ContentItem, 'kind' | 'media'>): number | null {
  switch (item.kind) {
    case 'video':
      return clampRatio(item.media, VIDEO_RANGE, VIDEO_FALLBACK);
    case 'photo':
    case 'carousel':
      return clampRatio(item.media, GALLERY_RANGE, GALLERY_FALLBACK);
    case 'link':
      return LINK_RATIO;
    case 'story':
      return STORY_RATIO;
    default:
      return null;
  }
}

/** What the detail recommends (D-06): push it now, repeat it as a series, or remake it as a reel. */
export type ContentRecommendation = 'push' | 'series' | 'reel';

/** A video up to this long is already a reel. */
const REEL_MAX_SECONDS = 90;
/** At this multiple of its kind's average, a publication is worth a series. */
const SERIES_FACTOR = 1.5;
/** Under this many days a publication is still collecting (the header's "Em andamento"). */
const IN_PROGRESS_DAYS = 2;

/**
 * The deterministic rule behind the detail's Recomendação: still in its first 48 hours → push it to
 * more members; 1,5× its kind's average or more → a series; a story or a short video → push; anything
 * else → remake it as a short reel.
 */
export function contentRecommendation({
  kind,
  interactions,
  kindAverage,
  daysAgo,
  durationSeconds,
}: {
  kind: ContentKind;
  interactions: number;
  kindAverage: number;
  daysAgo: number;
  durationSeconds: number | null;
}): ContentRecommendation {
  if (daysAgo < IN_PROGRESS_DAYS) return 'push';
  if (kindAverage > 0 && interactions >= SERIES_FACTOR * kindAverage) return 'series';
  if (kind === 'story') return 'push';
  if (kind === 'video' && durationSeconds !== null && durationSeconds <= REEL_MAX_SECONDS) {
    return 'push';
  }
  return 'reel';
}

/** A tab screen with nothing open below it. */
export function contentTabView(tab: ContentTab): OwnerContentView {
  return {
    tab,
    number: null,
    band: null,
    kind: null,
    postId: null,
    who: null,
    memberId: null,
    list: null,
    reply: null,
  };
}
