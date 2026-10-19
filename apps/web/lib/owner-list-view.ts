import { formatBrl } from '@rede-social/contracts/money';
import {
  CONTENT_KINDS,
  engagementBandSchema,
  OWNER_BAND_SCOPES,
  OWNER_CONTENT_PEOPLE,
  OWNER_LIST_MAX_CURSOR_LENGTH,
  OWNER_MEMBER_LISTS,
  type OwnerBandMemberRow,
  type OwnerListPost,
  type OwnerMemberListId,
  type OwnerMemberListReady,
} from '@rede-social/module-dashboard/contracts';
import { z } from 'zod';
import {
  type DashboardT,
  formatMonthYear,
  initials,
  momentText,
} from '@/components/dashboard/format';
import {
  type EngagementBand,
  type OwnerBandListParams,
  type OwnerMembersView,
  ownerMembersHref,
} from './owner-band-scope';

/**
 * The row views of the owner panel's paged lists (08.7-05, UI-D-477): the server's first page and
 * every page the "Ver todos" island appends are built by the SAME functions, as FINISHED views (the
 * labels, the links, the "Em breve" pills), so the client formats nothing (the `courses-view.ts`
 * posture). A view carries only what the admin may already read on the server-rendered page
 * (T-08.7-17): no field beyond the rendered text and the link.
 */

/** One labeled line of a member card; `comingSoon` draws the value as the "Em breve" pill. */
export interface MemberCardLine {
  label: string;
  value: string;
  comingSoon?: boolean;
}

/** A member as a card (a band list, a people list): the whole card links the member detail. */
export interface MemberRowView {
  type: 'member';
  id: string;
  href: string;
  name: string;
  initials: string;
  /** A line right under the name ("Curtiu há 3 dias"). */
  lead?: string;
  lines: MemberCardLine[];
  /** A warning pill next to the name (a commenter's "Sem resposta"). */
  status?: string;
  /** The card's id, so a "Voltar" lands on it. */
  anchor?: string;
}

/** A decorative thumbnail at the start of an item row (`CoverThumb`'s kind and tone seed). */
export interface ItemRowThumb {
  kind: 'video' | 'photo' | 'carousel' | 'text' | 'link' | 'story' | 'event' | 'order';
  seed: string;
}

/** One row of a member's list (a like, a comment, an active day…). */
export interface ItemRowView {
  type: 'item';
  id: string;
  title: string;
  lines: string[];
  /** A short value on the right ("3 ações"). */
  aside?: string;
  thumb?: ItemRowThumb;
}

/** One of a publication card's numbers: its value and, for screen readers, its name. */
export interface PostRowCount {
  name: 'likes' | 'comments';
  value: string;
  label: string;
}

/**
 * A publication as a compact card (08.7-07, D-05): the decorative cover, the caption, the meta, the
 * measured counts and the "Em breve" compact line (D-455). The whole card links the panel's post
 * detail; `anchor` lets the detail's "Voltar" land on it.
 */
export interface PostRowView {
  type: 'post';
  id: string;
  href: string | null;
  anchor: string;
  excerpt: string;
  meta: string;
  cover: {
    kind: ItemRowThumb['kind'];
    seed: string;
    ratio: number | null;
    /** A video's length ("1:15"), already formatted. */
    duration: string | null;
  };
  counts: PostRowCount[];
  /** "salvamentos em breve · compartilhamentos em breve"; null for a story (no saves). */
  comingSoon: string | null;
  /** "Ver detalhes", read after the card. */
  seeDetail: string;
}

/**
 * One interaction behind the interactions number (08.7-07, PD-7): who, their band, liked or
 * commented and when, and on which publication. The row opens the member (D-461).
 */
export interface InteractionRowView {
  type: 'interaction';
  id: string;
  href: string;
  anchor?: string;
  name: string;
  line: string;
  excerpt: string | null;
  thumb: ItemRowThumb | null;
}

/**
 * A comment waiting for the team (08.7-07, P4: its text, admin only): who wrote it, their band, the
 * text, when, the publication it is on, and "Responder" to the post page (D-461).
 */
export interface ReplyRowView {
  type: 'reply';
  id: string;
  name: string;
  band: string | null;
  text: string;
  when: string;
  post: string | null;
  replyHref: string;
  replyLabel: string;
}

export type OwnerListRowView =
  | MemberRowView
  | ItemRowView
  | PostRowView
  | InteractionRowView
  | ReplyRowView;

/** One appended page: the rows and the cursor of the next one (null at the end). */
export type OwnerListPage = { rows: OwnerListRowView[]; nextCursor: string | null };

/** What the server action answers: a page, or a failure the island shows as its retry line. */
export type OwnerListPageResult = OwnerListPage | { error: true };

/** "Ver todos" appends pages of 20 (UI-D-477). */
export const OWNER_LIST_MORE_PAGE_SIZE = 20;

const cursor = z.string().min(1).max(OWNER_LIST_MAX_CURSOR_LENGTH);

/** The Conteúdo screen a people list sits on: what its member cards link back into. */
export const contentPlaceSchema = z
  .object({
    tab: z.enum(['overview', 'types', 'posts']),
    number: z.literal('posts').nullable(),
    kind: z.enum(CONTENT_KINDS).nullable(),
  })
  .strict();
export type ContentPlace = z.infer<typeof contentPlaceSchema>;

/**
 * The orders of a publications list (08.7-07): Publicações best first, the publications number
 * newest first, an opened kind best first.
 */
export const CONTENT_POST_LISTS = ['best', 'newest', 'kind'] as const;
export type ContentPostListId = (typeof CONTENT_POST_LISTS)[number];

/**
 * The server action's input (T-08.7-16): a closed `kind`, the list's own params (band and list ids
 * from the contracts' enums, ids as uuids) and a bounded cursor. Strict, so an extra key is refused;
 * an unknown kind is refused. The API re-checks role, tenant and cursor on every page.
 */
export const ownerListMoreInputSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('band'),
      band: engagementBandSchema,
      scope: z.enum(OWNER_BAND_SCOPES),
      scopeId: z.uuid().optional(),
      cursor,
    })
    .strict(),
  z
    .object({
      kind: z.literal('member-list'),
      membershipId: z.uuid(),
      list: z.enum(OWNER_MEMBER_LISTS),
      cursor,
    })
    .strict(),
  // 08.7-07: Conteúdo's lists. The cursor of a publications list is the next row's offset.
  z
    .object({
      kind: z.literal('content-posts'),
      list: z.enum(CONTENT_POST_LISTS),
      contentKind: z.enum(CONTENT_KINDS).nullable(),
      cursor: z.string().regex(/^[1-9][0-9]{0,5}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal('content-people'),
      itemId: z.uuid(),
      who: z.enum(OWNER_CONTENT_PEOPLE),
      place: contentPlaceSchema,
      cursor,
    })
    .strict(),
  z.object({ kind: z.literal('content-interactions'), cursor }).strict(),
  z.object({ kind: z.literal('content-unanswered'), cursor }).strict(),
]);
export type OwnerListMoreInput = z.infer<typeof ownerListMoreInputSchema>;

/** What a list's island sends with every page, minus the cursor it keeps itself. */
export type OwnerListMoreRequest =
  | ({ kind: 'band' } & OwnerBandListParams)
  | { kind: 'member-list'; membershipId: string; list: OwnerMemberListId }
  | {
      kind: 'content-posts';
      list: ContentPostListId;
      contentKind: (typeof CONTENT_KINDS)[number] | null;
    }
  | {
      kind: 'content-people';
      itemId: string;
      who: (typeof OWNER_CONTENT_PEOPLE)[number];
      place: ContentPlace;
    }
  | { kind: 'content-interactions' }
  | { kind: 'content-unanswered' };

const DATE = new Map<string, Intl.DateTimeFormat>();
const CLOCK = new Map<string, Intl.DateTimeFormat>();

function cached(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let format = cache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, { timeZone, ...options });
    cache.set(timeZone, format);
  }
  return format;
}

/** The calendar date of an instant in the tenant's zone, as `YYYY-MM-DD`. */
export function localDate(instant: string | number, timeZone: string): string {
  return cached(DATE, 'en-CA', timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(typeof instant === 'number' ? instant : Date.parse(instant));
}

/**
 * An instant as the panels' relative moment, in the tenant's zone: the calendar days between its
 * local date and today's, and its local `HH:mm` (`momentText`, `bandMembers.when`). A live row's
 * time (UI-D-480: relative times on live rows stay).
 */
export function localMoment(
  instant: string,
  timeZone: string,
  nowMs: number,
): { daysAgo: number; time: string } {
  const day = Date.parse(`${localDate(instant, timeZone)}T00:00:00Z`);
  const today = Date.parse(`${localDate(nowMs, timeZone)}T00:00:00Z`);
  const time = cached(CLOCK, 'pt-BR', timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(Date.parse(instant));
  return { daysAgo: Math.max(0, Math.round((today - day) / 86_400_000)), time };
}

/** "set. de 2026": the month a member joined, in the tenant's zone. */
export function memberSinceText(joinedAt: string, timeZone: string): string {
  return formatMonthYear(localDate(joinedAt, timeZone));
}

/** "hoje às 09:40", "ontem às 21:05", "há 14 dias", or "nenhuma ainda" for a member who never acted. */
export function lastActiveText(
  t: DashboardT,
  lastActiveAt: string | null,
  timeZone: string,
  nowMs: number,
): string {
  if (lastActiveAt === null) return t('tenantOwner.bandMembers.neverActive');
  const { daysAgo, time } = localMoment(lastActiveAt, timeZone, nowMs);
  return t('tenantOwner.bandMembers.when', { days: daysAgo, time });
}

/** The view a band list's island pages in: its tab and opened item, from the list's own params. */
export function viewOfBandList(
  params: OwnerBandListParams,
): Pick<OwnerMembersView, 'kind' | 'itemId'> {
  if (params.scope === 'base') return { kind: 'member', itemId: null };
  return { kind: params.scope, itemId: params.scopeId ?? null };
}

/**
 * One band member as a card (D-461): the name and initials, "Membro desde", "Última atividade",
 * "Comunidade que mais interage" (absent when the member acts on none, or `communities` is off: the
 * API sends null then), and "Tempo médio diário" as the "Em breve" pill (D-458). The card links the
 * panel's member detail one level down (`&membro=<membershipId>`).
 */
export function bandMemberRowView(
  t: DashboardT,
  row: OwnerBandMemberRow,
  ctx: {
    view: Pick<OwnerMembersView, 'kind' | 'itemId'>;
    band: EngagementBand;
    timeZone: string;
    nowMs: number;
  },
): MemberRowView {
  const key = 'tenantOwner.bandMembers';
  const lines: MemberCardLine[] = [
    { label: t(`${key}.since`), value: memberSinceText(row.joinedAt, ctx.timeZone) },
    {
      label: t(`${key}.lastActive`),
      value: lastActiveText(t, row.lastActiveAt, ctx.timeZone, ctx.nowMs),
    },
  ];
  if (row.topCommunity) {
    lines.push({ label: t(`${key}.topCommunity`), value: row.topCommunity.name });
  }
  lines.push({
    label: t(`${key}.dailyTime`),
    value: t('report.comingSoon.value'),
    comingSoon: true,
  });
  return {
    type: 'member',
    id: row.membershipId,
    href: ownerMembersHref({
      kind: ctx.view.kind,
      itemId: ctx.view.itemId,
      band: ctx.band,
      memberId: row.membershipId,
      list: null,
    }),
    name: row.displayName,
    initials: initials(row.displayName),
    lines,
  };
}

/** The catalog block of each member list (`dashboard.tenantOwner.memberLists.*`). */
export const MEMBER_LIST_KEYS: Readonly<Record<OwnerMemberListId, string>> = {
  'active-days': 'activeDays',
  likes: 'likes',
  comments: 'comments',
  'strong-actions': 'strongActions',
};

const LISTS = 'tenantOwner.memberLists';

/** A post's kind as its decorative thumbnail draws it (a gallery as a photo). */
const POST_THUMB: Record<OwnerListPost['kind'], ItemRowThumb['kind']> = {
  video: 'video',
  gallery: 'photo',
  link: 'link',
  text: 'text',
};

/** "hoje às 09:12", "ontem", "há 8 dias": a live row's instant (or a day) as the panels say it. */
function whenText(t: DashboardT, instant: string, timeZone: string, nowMs: number): string {
  return momentText(t, localMoment(instant, timeZone, nowMs));
}

/** The title and thumbnail of a row that names a post, a story, or neither (a removed post). */
function postParts(
  t: DashboardT,
  post: OwnerListPost | null,
  storyId: string | null,
): Pick<ItemRowView, 'title' | 'thumb'> {
  if (post) return { title: post.excerpt, thumb: { kind: POST_THUMB[post.kind], seed: post.id } };
  if (storyId) return { title: t(`${LISTS}.story`), thumb: { kind: 'story', seed: storyId } };
  return { title: t(`${LISTS}.removedPost`) };
}

/**
 * The rows of one page of a member's list (D-461), finished: a like or a comment names its post (the
 * caption's excerpt, cut server-side) or its story, never a comment's text (PD-9: the contract has
 * none); a check-in names its event and an order its product and value, or says they are gone; an
 * active day reads as "hoje", "ontem" or "há N dias" with its actions. The community a post sits in
 * is not on the list rows, so the lines say when, not where.
 */
export function memberListRowViews(
  t: DashboardT,
  page: OwnerMemberListReady,
  ctx: { timeZone: string; nowMs: number },
): ItemRowView[] {
  const { timeZone, nowMs } = ctx;
  switch (page.list) {
    case 'active-days':
      return page.rows.map((row) => {
        const day = Date.parse(`${row.day}T00:00:00Z`);
        const today = Date.parse(`${localDate(nowMs, timeZone)}T00:00:00Z`);
        return {
          type: 'item',
          id: `day-${row.day}`,
          title: momentText(t, {
            daysAgo: Math.max(0, Math.round((today - day) / 86_400_000)),
          }),
          lines: [],
          aside: t(`${LISTS}.activeDays.actions`, { count: row.actions }),
        };
      });
    case 'likes':
      return page.rows.map((row) => ({
        type: 'item',
        id: row.id,
        ...postParts(t, row.post, row.target.storyId),
        lines: [t(`${LISTS}.likes.when`, { when: whenText(t, row.at, timeZone, nowMs) })],
      }));
    case 'comments':
      return page.rows.map((row) => ({
        type: 'item',
        id: row.id,
        ...postParts(t, row.post, row.storyId),
        lines: [t(`${LISTS}.comments.when`, { when: whenText(t, row.at, timeZone, nowMs) })],
      }));
    case 'strong-actions':
      return page.rows.map((row): ItemRowView => {
        const when = whenText(t, row.at, timeZone, nowMs);
        if (row.kind === 'comment') {
          return {
            type: 'item',
            id: row.id,
            ...postParts(t, row.post, row.storyId),
            lines: [t(`${LISTS}.strongActions.commentWhen`, { when })],
          };
        }
        if (row.kind === 'check_in') {
          return {
            type: 'item',
            id: row.id,
            title: row.eventTitle ?? t(`${LISTS}.removedEvent`),
            thumb: { kind: 'event', seed: row.eventId },
            lines: [t(`${LISTS}.strongActions.checkIn`, { when })],
          };
        }
        return {
          type: 'item',
          id: row.id,
          title: row.productName ?? t(`${LISTS}.removedProduct`),
          thumb: { kind: 'order', seed: row.productId },
          lines: [t(`${LISTS}.strongActions.order`, { value: formatBrl(row.cents), when })],
        };
      });
  }
}
