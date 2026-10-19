import {
  engagementBandSchema,
  OWNER_BAND_SCOPES,
  OWNER_LIST_MAX_CURSOR_LENGTH,
  type OwnerBandMemberRow,
} from '@rede-social/module-dashboard/contracts';
import { z } from 'zod';
import { type DashboardT, formatMonthYear, initials } from '@/components/dashboard/format';
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

export type OwnerListRowView = MemberRowView | ItemRowView;

/** One appended page: the rows and the cursor of the next one (null at the end). */
export type OwnerListPage = { rows: OwnerListRowView[]; nextCursor: string | null };

/** What the server action answers: a page, or a failure the island shows as its retry line. */
export type OwnerListPageResult = OwnerListPage | { error: true };

/** "Ver todos" appends pages of 20 (UI-D-477). */
export const OWNER_LIST_MORE_PAGE_SIZE = 20;

const cursor = z.string().min(1).max(OWNER_LIST_MAX_CURSOR_LENGTH);

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
]);
export type OwnerListMoreInput = z.infer<typeof ownerListMoreInputSchema>;

/** What a list's island sends with every page, minus the cursor it keeps itself. */
export type OwnerListMoreRequest = { kind: 'band' } & OwnerBandListParams;

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
