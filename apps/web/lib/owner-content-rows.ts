import type {
  ContentItemAnswer,
  ContentKindId,
  OwnerContentInteractionRow,
  OwnerContentPeopleReady,
  OwnerContentPerson,
  OwnerContentReady,
  OwnerContentUnansweredRow,
} from '@rede-social/module-dashboard/contracts';
import {
  bandLabel,
  type DashboardT,
  formatClock,
  formatCount,
  formatDayMonth,
  initials,
  momentText,
} from '@/components/dashboard/format';
import {
  contentCoverRatio,
  contentMemberAnchor,
  contentPostAnchor,
  contentTabView,
  type OwnerContentView,
  ownerContentHref,
} from './owner-content-view';
import type {
  ContentPlace,
  ContentPostListId,
  InteractionRowView,
  MemberRowView,
  PostRowView,
  ReplyRowView,
} from './owner-list-view';
import { localDate, localMoment } from './owner-list-view';
import type { OwnerPanelFlags } from './owner-panel';

/*
 * Conteúdo's finished row views (08.7-07): the server's first page and every page the "Ver todos"
 * island appends are built by these SAME functions from the API's answers, so the client formats
 * nothing (the `owner-list-view.ts` posture). A view carries only what the admin reads on the page.
 */

const KEY = 'tenantOwner.content';

/** A publications list's first page, then pages of 20 (UI-D-477). */
export const CONTENT_FIRST_PAGE = 10;

/** Likes + comments of a publication (members only, UI-D-484). */
export function interactionsOf(item: Pick<ContentItemAnswer, 'likes' | 'comments'>): number {
  return item.likes + item.comments;
}

/** Best first: more likes + comments, then the newer, then the id (a stable, value-led order). */
export function byInteractions(a: ContentItemAnswer, b: ContentItemAnswer): number {
  return (
    interactionsOf(b) - interactionsOf(a) ||
    b.createdAt.localeCompare(a.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

/** Newest first, then the id. */
export function byNewest(a: ContentItemAnswer, b: ContentItemAnswer): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

/** The feed posts of the answer (every overview number counts them, PD-1). */
export function contentPosts(answer: OwnerContentReady): ContentItemAnswer[] {
  return answer.items.filter((item) => item.kind !== 'story');
}

/** The items of one kind. */
export function itemsOfKind(answer: OwnerContentReady, kind: ContentKindId): ContentItemAnswer[] {
  return answer.items.filter((item) => item.kind === kind);
}

/** Likes + comments per publication of a kind (the "média dos vídeos" of the detail). */
export function kindAverage(answer: OwnerContentReady, kind: ContentKindId): number {
  const items = itemsOfKind(answer, kind);
  if (items.length === 0) return 0;
  return Math.round(items.reduce((sum, item) => sum + interactionsOf(item), 0) / items.length);
}

/** The view a publications list opens its cards in. */
function postListView(
  list: ContentPostListId,
  contentKind: ContentKindId | null,
): OwnerContentView {
  if (list === 'kind') return { ...contentTabView('types'), kind: contentKind };
  if (list === 'newest') return { ...contentTabView('overview'), number: 'posts' };
  return contentTabView('posts');
}

/**
 * A publications list in its order (08.7-07): Publicações (`best`) the feed posts best first, the
 * publications number (`newest`) the feed posts newest first, an opened kind (`kind`) its items best
 * first. `hrefOf` opens a card's detail one level down.
 */
export function contentPostList(
  answer: OwnerContentReady,
  list: ContentPostListId,
  contentKind: ContentKindId | null,
): { items: ContentItemAnswer[]; hrefOf: (id: string) => string } {
  const items =
    list === 'kind'
      ? itemsOfKind(answer, contentKind ?? 'video').sort(byInteractions)
      : list === 'newest'
        ? contentPosts(answer).sort(byNewest)
        : contentPosts(answer).sort(byInteractions);
  const view = postListView(list, contentKind);
  return { items, hrefOf: (id) => ownerContentHref({ ...view, postId: id }) };
}

/** The live community names of the answer while `communities` is on (UI-D-473). */
export function contentCommunityNames(
  answer: OwnerContentReady,
  flags: Pick<OwnerPanelFlags, 'communities'>,
): Readonly<Record<string, string>> {
  if (!flags.communities) return {};
  const names: Record<string, string> = {};
  for (const row of answer.byCommunity ?? []) {
    if (row.communityId !== null && row.name !== null) names[row.communityId] = row.name;
  }
  return names;
}

/** The kind's name ("Vídeo"). */
export function contentKindLabel(t: DashboardT, kind: ContentKindId): string {
  return t(`${KEY}.kinds.${kind}`);
}

export interface ContentRowContext {
  flags: Pick<OwnerPanelFlags, 'communities'>;
  /** The live community names (`contentCommunityNames`). */
  communities: Readonly<Record<string, string>>;
  /** `bootstrap.tenant.timezone`: a publication's date is the tenant's. */
  timeZone: string;
}

/**
 * `08/10 · Geral · Vídeo`; `08/10 · Início · Foto` for the tenant-wide feed (UI-D-475); `09/10 ·
 * Story` for a story, and with `communities` off for every card (UI-D-473); a community gone since
 * the build drops its part.
 */
export function contentMeta(
  t: DashboardT,
  item: Pick<ContentItemAnswer, 'kind' | 'communityId' | 'createdAt'>,
  ctx: ContentRowContext,
): string {
  const date = formatDayMonth(localDate(item.createdAt, ctx.timeZone));
  const kind = contentKindLabel(t, item.kind);
  const community =
    !ctx.flags.communities || item.kind === 'story'
      ? undefined
      : item.communityId === null
        ? t('report.tenantFeed')
        : ctx.communities[item.communityId];
  if (community === undefined) return t(`${KEY}.card.metaStory`, { date, kind });
  return t(`${KEY}.card.meta`, { date, community, kind });
}

/**
 * One publication as a compact card's view (D-05): likes and comments measured, saves and shares
 * in the compact "Em breve" line (D-455); a story has its comment count only (no saves, no thread
 * line, UI-D-489 b). `href` opens the panel's post detail.
 */
export function contentPostRowView(
  t: DashboardT,
  item: ContentItemAnswer,
  ctx: ContentRowContext & { href: string | null },
): PostRowView {
  const count = (name: 'likes' | 'comments', value: number) => ({
    name,
    value: formatCount(value),
    label: t(`${KEY}.card.compact.${name}`, { count: value }),
  });
  const metric = (name: 'saves' | 'shares') =>
    t('report.comingSoon.inline', { metric: t(`${KEY}.card.compact.${name}`, { count: 2 }) });
  return {
    type: 'post',
    id: item.id,
    href: ctx.href,
    anchor: contentPostAnchor(item.id),
    excerpt: item.excerpt,
    meta: contentMeta(t, item, ctx),
    cover: {
      kind: item.kind,
      seed: item.id,
      ratio: contentCoverRatio(item),
      duration: item.durationSeconds === null ? null : formatClock(t, item.durationSeconds),
    },
    counts: [count('likes', item.likes), count('comments', item.comments)],
    comingSoon: item.kind === 'story' ? null : `${metric('saves')} · ${metric('shares')}`,
    seeDetail: t('tenantOwner.seeDetail'),
  };
}

/** The view a people list sits on. */
export function contentPlaceView(place: ContentPlace): OwnerContentView {
  return { ...contentTabView(place.tab), number: place.number, kind: place.kind };
}

/** The view's place, for the island's request. */
export function contentPlaceOf(view: OwnerContentView): ContentPlace {
  return { tab: view.tab, number: view.number === 'posts' ? 'posts' : null, kind: view.kind };
}

/** "Faixa: Engajados", or nothing for a person with no member row today. */
function bandLine(t: DashboardT, person: OwnerContentPerson) {
  return person.band === null
    ? []
    : [{ label: t('tenantOwner.bandMembers.band'), value: bandLabel(t, person.band) }];
}

/**
 * Who liked or commented a publication, as member cards (D-461, P1): when they did it, their band,
 * and — a root comment the team has not answered — the "Sem resposta" pill (never the comment's
 * text, P4). Each card opens the panel's member detail; the first card of a member carries its
 * anchor, so the member's "Voltar" lands on it.
 */
export function contentPeopleRowViews(
  t: DashboardT,
  page: OwnerContentPeopleReady,
  ctx: { place: ContentPlace; itemId: string; timeZone: string; nowMs: number; seen?: Set<string> },
): MemberRowView[] {
  const view = { ...contentPlaceView(ctx.place), postId: ctx.itemId, who: page.who };
  const seen = ctx.seen ?? new Set<string>();
  return page.rows.map((row) => {
    const { member } = row;
    const first = !seen.has(member.membershipId);
    seen.add(member.membershipId);
    const when = momentText(t, localMoment(row.at, ctx.timeZone, ctx.nowMs));
    return {
      type: 'member',
      id: row.id,
      href: ownerContentHref({ ...view, memberId: member.membershipId }),
      name: member.displayName,
      initials: initials(member.displayName),
      lead: t(`${KEY}.people.when.${page.who}`, { when }),
      lines: bandLine(t, member),
      status:
        'answered' in row && row.answered === false ? t(`${KEY}.people.unanswered`) : undefined,
      anchor: first ? contentMemberAnchor(member.membershipId) : undefined,
    };
  });
}

/**
 * The interactions behind the number (PD-7): who, their band, liked or commented and when, and the
 * publication (its excerpt and decorative cover, when it is still in the answer). The row opens the
 * member (D-461); a member's first row carries the anchor their "Voltar" lands on.
 */
export function contentInteractionRowViews(
  t: DashboardT,
  rows: readonly OwnerContentInteractionRow[],
  ctx: {
    items: ReadonlyMap<string, ContentItemAnswer>;
    timeZone: string;
    nowMs: number;
    seen?: Set<string>;
  },
): InteractionRowView[] {
  const key = `${KEY}.interactions`;
  const seen = ctx.seen ?? new Set<string>();
  const view: OwnerContentView = { ...contentTabView('overview'), number: 'interactions' };
  return rows.map((row) => {
    const { member } = row;
    const first = !seen.has(member.membershipId);
    seen.add(member.membershipId);
    const when = momentText(t, localMoment(row.at, ctx.timeZone, ctx.nowMs));
    const action = t(`${key}.${row.kind}`);
    const item = ctx.items.get(row.itemId);
    return {
      type: 'interaction',
      id: `${row.kind}-${row.id}`,
      href: ownerContentHref({ ...view, memberId: member.membershipId }),
      anchor: first ? contentMemberAnchor(member.membershipId) : undefined,
      name: member.displayName,
      line:
        member.band === null
          ? t(`${key}.lineNoBand`, { action, when })
          : t(`${key}.line`, { band: bandLabel(t, member.band), action, when }),
      excerpt: item?.excerpt ?? null,
      thumb: item ? { kind: item.kind, seed: item.id } : null,
    };
  });
}

/**
 * The comments waiting for the team, oldest first (P4: with their text, admin only): who wrote it,
 * their band, the text, when, the publication when it is still in the answer, and "Responder" to
 * `/post/[postId]` (D-461), where the team answers.
 */
export function contentReplyRowViews(
  t: DashboardT,
  rows: readonly OwnerContentUnansweredRow[],
  ctx: { items: ReadonlyMap<string, ContentItemAnswer>; timeZone: string; nowMs: number },
): ReplyRowView[] {
  return rows.map((row) => ({
    type: 'reply',
    id: row.id,
    name: row.member.displayName,
    band: row.member.band === null ? null : t(`tenantOwner.memberDetail.band.${row.member.band}`),
    text: row.text,
    when: t(`${KEY}.replies.when`, {
      when: momentText(t, localMoment(row.at, ctx.timeZone, ctx.nowMs)),
    }),
    post: ctx.items.get(row.postId)?.excerpt ?? null,
    replyHref: `/post/${row.postId}`,
    replyLabel: t(`${KEY}.replies.reply`),
  }));
}

/** The answer's items by id. */
export function contentItemsById(
  answer: OwnerContentReady | null,
): ReadonlyMap<string, ContentItemAnswer> {
  return new Map((answer?.items ?? []).map((item) => [item.id, item]));
}
