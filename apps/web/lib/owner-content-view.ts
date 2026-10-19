import type {
  ContentCommentMeta,
  ContentKindId,
  OwnerContentPeopleId,
} from '@rede-social/module-dashboard/contracts';
import { z } from 'zod';
import {
  OWNER_MEASURED_LISTS,
  type OwnerMeasuredListSlug,
  ownerInsightAnchor,
} from './owner-band-scope';
import { type OwnerPanelFlags, ownerAreaHref } from './owner-panel';

/*
 * The Conteúdo area's URL (08.7-07, R-Pitfall 7): SYNTACTIC. Tabs, kinds, numbers and people are
 * slugs; a publication and a member are uuids. Whether an id is the tenant's and sits in the opened
 * list is the API's to say: its 404 falls back to the list (D-06). No fixture is read here.
 */

type SearchParams = Record<string, string | string[] | undefined>;

/** The three tabs of the Conteúdo area (quick 261013-h51 D-01). */
export type ContentTab = 'overview' | 'types' | 'posts';

/**
 * The overview numbers that open a list (D-02): the publications and the interactions. "Taxa de
 * engajamento", "Visualizações" and "Alcance por publicação" are "Em breve" (D-455) and never open;
 * "Membros que interagiram" is measured but has no list behind it.
 */
export type ContentNumber = 'posts' | 'interactions';

/** A publication's kind (the contract's six). */
export type ContentKind = ContentKindId;

/** Who did one of a publication's numbers: likes and comments only (saves and shares never open). */
export type ContentWho = OwnerContentPeopleId;

/**
 * Where the Conteúdo area stands in its cascade (D-01): the tab; on Visão geral, the number whose
 * list is open; the type opened under Por tipo; the publication; who did one of its numbers; the
 * member opened from a people list or the interactions; the list behind one of the member's
 * numbers. Each level is only ever set with the levels above it. `replies` is the screen of the
 * comments waiting for the team: only on Visão geral, and alone.
 */
export interface OwnerContentView {
  tab: ContentTab;
  number: ContentNumber | null;
  kind: ContentKind | null;
  postId: string | null;
  who: ContentWho | null;
  memberId: string | null;
  list: OwnerMeasuredListSlug | null;
  replies: boolean;
}

/** `?vista=` per tab; Visão geral has none. */
const TAB_SLUGS = { types: 'tipos', posts: 'publicacoes' } as const;

/** The `?numero=` slug of each overview number that opens a list (D-02). */
export const CONTENT_NUMBER_SLUGS: Readonly<Record<ContentNumber, string>> = {
  posts: 'publicacoes',
  interactions: 'interacoes',
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

/** The `?quem=` slug of each people list: no views, reach, saves or shares list exists (P3, D-455). */
export const CONTENT_WHO_SLUGS: Readonly<Record<ContentWho, string>> = {
  likes: 'curtidas',
  comments: 'comentarios',
};

/** `?responder=` of the unanswered comments screen. */
const REPLIES_SLUG = 'comentarios';

/** The id of "Precisa de atenção": "Voltar" from the unanswered comments lands on it. */
export const CONTENT_ATTENTION_ANCHOR = 'precisa-de-atencao';

/** The id of a publication card: "Voltar" from its detail lands on it. */
export function contentPostAnchor(postId: string): string {
  return `post-${postId}`;
}

/** The id of a type card: "Voltar" from an opened type lands on it. */
export function contentKindAnchor(kind: ContentKind): string {
  return `tipo-${CONTENT_KIND_SLUGS[kind]}`;
}

/** The id of an interaction number on the detail: "Voltar" from its people lands on it. */
export function contentWhoAnchor(who: ContentWho): string {
  return `quem-${CONTENT_WHO_SLUGS[who]}`;
}

/** The id of a member card in a people list: "Voltar" from the member lands on it. */
export function contentMemberAnchor(memberId: string): string {
  return `membro-${memberId}`;
}

/** The id of an overview number: "Voltar" from its list lands on it. */
export function contentNumberAnchor(number: ContentNumber): string {
  return `numero-${CONTENT_NUMBER_SLUGS[number]}`;
}

/** A comment waiting longer than this for the team's answer needs attention. */
const ATTENTION_HOURS = 24;

/**
 * Whether a publication has a comment unanswered for over 24 hours ("Precisa de atenção"). Never a
 * story: story replies are flat, with no thread to answer (UI-D-489 b).
 */
export function needsAttention(item: {
  kind: ContentKind;
  commentMeta?: ContentCommentMeta;
}): boolean {
  if (item.kind === 'story' || !item.commentMeta) return false;
  return (item.commentMeta.oldestUnansweredHours ?? 0) > ATTENTION_HOURS;
}

const UUID = z.uuid();

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

const MEASURED_SLUGS = Object.keys(OWNER_MEASURED_LISTS) as OwnerMeasuredListSlug[];

/** The modules the URL reads: a kind whose module is off is not there (UI-D-473). */
export type ContentFlags = Pick<OwnerPanelFlags, 'feed' | 'stories'>;

const ALL_KINDS_ON: ContentFlags = { feed: true, stories: true };

/** Whether a kind is shown with these modules: a story needs `stories`, a post kind `feed`. */
export function contentKindShown(kind: ContentKind, flags: ContentFlags): boolean {
  return kind === 'story' ? flags.stories : flags.feed;
}

/**
 * The view the query asks for (untrusted), read level by level; an invalid value at any level falls
 * to the level above with no notice (D-06):
 * 1. `vista` is `tipos` or `publicacoes`, else Visão geral; with `feed` off only Por tipo remains
 *    (the stories: Visão geral and Publicações are the feed's, UI-D-473).
 * 2. On Visão geral, `numero` is `publicacoes` or `interacoes`; a typed "Em breve" number (`taxa`,
 *    `visualizacoes`, `alcance`) or `membros` (no list behind it) opens nothing.
 * 3. `responder=comentarios` on Visão geral with no number opens the unanswered comments alone.
 * 4. `tipo` (Por tipo only) is a kind slug whose module is on.
 * 5. `post` is a uuid: inside an opened type, under Publicações, on Visão geral and under the
 *    publications number; never under the interactions (their rows open members).
 * 6. `quem` is `curtidas` or `comentarios`, only with a post (saves and shares never open, D-455).
 * 7. `membro` is a uuid: with a people list, or under the interactions.
 * 8. `lista` is one of the four measured lists, only with a member.
 */
export function parseOwnerContentView(
  params: SearchParams,
  flags: ContentFlags = ALL_KINDS_ON,
): OwnerContentView {
  const tab: ContentTab = flags.feed ? (bySlug(params.vista, TAB_SLUGS) ?? 'overview') : 'types';
  const number = tab === 'overview' ? (bySlug(params.numero, CONTENT_NUMBER_SLUGS) ?? null) : null;
  if (tab === 'overview' && number === null && pick(params.responder, [REPLIES_SLUG])) {
    return { ...contentTabView('overview'), replies: true };
  }
  const rawKind = tab === 'types' ? bySlug(params.tipo, CONTENT_KIND_SLUGS) : undefined;
  const kind = rawKind && contentKindShown(rawKind, flags) ? rawKind : null;
  const opensPost =
    (tab === 'types' && kind !== null) ||
    tab === 'posts' ||
    (tab === 'overview' && number !== 'interactions');
  const postId = opensPost ? uuidOf(params.post) : null;
  const who = postId ? (bySlug(params.quem, CONTENT_WHO_SLUGS) ?? null) : null;
  const opensMember = (postId !== null && who !== null) || (number === 'interactions' && !postId);
  const memberId = opensMember ? uuidOf(params.membro) : null;
  const list = memberId ? (pick(params.lista, MEASURED_SLUGS) ?? null) : null;
  return { tab, number, kind, postId, who, memberId, list, replies: false };
}

/**
 * The link to a cascade view: the area, then `vista`, `numero`, `responder`, `tipo`, `post`, `quem`,
 * `membro` and `lista` in that order.
 */
export function ownerContentHref(view: OwnerContentView): string {
  let query = '';
  if (view.tab !== 'overview') query += `&vista=${TAB_SLUGS[view.tab]}`;
  if (view.number) query += `&numero=${CONTENT_NUMBER_SLUGS[view.number]}`;
  if (view.replies) query += `&responder=${REPLIES_SLUG}`;
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
 * number). Null on a tab screen. The unanswered comments go back to "Precisa de atenção".
 */
export function contentBackHref(view: OwnerContentView): string | null {
  if (view.replies) {
    return `${ownerContentHref({ ...view, replies: false })}#${CONTENT_ATTENTION_ANCHOR}`;
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
    return `${ownerContentHref({ ...view, postId: null })}#${contentPostAnchor(view.postId)}`;
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

type MediaSize = { width: number; height: number } | null;

function clampRatio(media: MediaSize, [min, max]: readonly [number, number], fallback: number) {
  if (!media || media.width <= 0 || media.height <= 0) return fallback;
  return Math.min(max, Math.max(min, media.width / media.height));
}

/** width / height of a publication's cover, or null when it has none (text). */
export function contentCoverRatio(item: { kind: ContentKind; media: MediaSize }): number | null {
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
    kind: null,
    postId: null,
    who: null,
    memberId: null,
    list: null,
    replies: false,
  };
}
