import {
  FINANCE_ACCESS_DAYS,
  type FinanceOfferId,
  type FinanceOrder,
  financeOffer,
  financeRevenueKind,
  ownerFinanceOrders,
  type RevenueKind,
} from './owner-finance';
import {
  assignRosterInteractions,
  buildOwnerMemberLists,
  type OwnerMemberLists,
  type RosterInteractions,
} from './owner-member-lists';
import {
  daysBefore,
  daysSince,
  type OwnerRosterMember,
  ownerBandRoster,
  PREVIEW_TODAY,
} from './owner-members';
import type { EngagementBand, PostType, RelativeMoment, ReportValue } from './shared';
import { tenantOwnerPanel } from './tenant-owner';

/**
 * One member's insights for the level-4 Membros area (quick 261012-qer B-3). RAW DATA (MOD-02): a pure
 * builder over the roster row, no clock and no randomness, so a member reads the same on every render.
 *
 * Every number comes from one set of active days per member (days ago, never after the last action
 * nor before joining), so the 30-day counts, the weekly chart and the band history agree with each
 * other and with the band rules (shared.ts): superfã 12+ active days and 3+ strong actions, engajado
 * 4-11, ocasional 1-3, em risco and inativo none in 30 days. An attended event is an active day; so
 * is every purchase. The purchases are the member's paid orders in the Financeiro's single order list
 * (`owner-finance.ts`, quick 261014-dwc D-02): the entry on the joining day, then any add-on, each
 * with its offer and whether it is primary or secondary revenue; at most one falls in the last 30
 * days. Across the roster, the attendees of each event stay within its check-ins and the support
 * conversations within the 8 weeks' total (`tests/owner-member-insights.test.ts`).
 *
 * The lists behind the numbers (quick 261012-tru D-07, `owner-member-lists.ts`) are built from the
 * same active days, attended events and 30-day order, and `build` throws when a list's length differs
 * from its 30-day count. "Posts vistos" is the number of distinct posts in the seen list (still an
 * example: no post views are recorded yet). Which posts each member liked and commented on is
 * assigned once for the whole roster (`assignRosterInteractions`): the likes KPI stays active days +
 * the band's extras, the comments KPI is the band's realistic table (`COMMENTS`, quick 261013-uoi:
 * the roster is a sample of the base, so a post's people list may hold fewer names than its number),
 * and the actions since joining are never fewer than the last 30 days'.
 *
 * Visible to the client's management only: with real data the privacy notice must say that the
 * management sees each member's individual behavior. Support is counts and dates, never message text.
 */

export interface OwnerMemberInsights {
  id: string;
  name: string;
  band: EngagementBand;
  memberSince: string;
  lastActive: RelativeMoment;
  topCommunityId: string;
  /** The last 30 days. Strong actions = comments + check-ins + orders (members cannot post in V1). */
  last30: {
    activeDays: number;
    likes: number;
    comments: number;
    checkIns: number;
    orders: number;
    strongActions: number;
    /** Example: no usage sessions are recorded yet. */
    dailyMinutes: ReportValue<number>;
    /** Distinct posts seen: the length of `lists.postsSeen` (example: no post views are recorded yet). */
    postsSeen: ReportValue<number>;
  };
  /** The items behind the 30-day numbers, each list as long as its count (D-07). */
  lists: OwnerMemberLists;
  /** Active days per week, the last 12 weeks, oldest first. */
  weeklyActiveDays: number[];
  /** The band 60 days ago, 30 days ago (`YYYY-MM` of that day) and today; null = not a member yet. */
  bandHistory: { month: string; band: EngagementBand | null }[];
  /** Actions since joining per community the member can access, most first (the top one first). */
  communities: { id: string; actions: number }[];
  /** Likes and comments since joining per post type, most first. */
  postTypes: { type: PostType; interactions: number }[];
  /** The member's RSVPs "vou", oldest first; `attended` is null for an event still to come. */
  events: { id: string; attended: boolean | null }[];
  /**
   * Store purchases, oldest first: the member's paid orders in the single order list. An entry or a
   * VIP purchase gives a year of access, whose end is an example (`expires_at` is never filled yet);
   * any other purchase has none (null).
   */
  purchases: {
    productId: string;
    offerId: FinanceOfferId;
    kind: RevenueKind;
    date: string;
    cents: number;
    expiresAt: ReportValue<string> | null;
  }[];
  /** Support conversations of the last 8 weeks: counts and dates only, never message text. */
  support: {
    conversations: number;
    lastDaysAgo: number | null;
    medianResponseMinutes: number | null;
  };
  /** What to do next, by band; `days` = since joining (novos) or since the last action. */
  suggestion: { kind: EngagementBand; days: number };
}

const { events, support, byCommunity } = tenantOwnerPanel;
const VIP_PRODUCT = 's2';
const MONTH_DAYS = 30;

/** Each roster member's paid orders, oldest first (the ledger's order). */
const ORDERS_BY_MEMBER = new Map<string, FinanceOrder[]>();
for (const order of ownerFinanceOrders) {
  if (order.status !== 'paid') continue;
  ORDERS_BY_MEMBER.set(order.memberId, [...(ORDERS_BY_MEMBER.get(order.memberId) ?? []), order]);
}
const SUPPORT_WEEKS = support.weeklyConversations.length;

/** 30-day active days by band and slot. */
const ACTIVE_DAYS: Record<EngagementBand, (j: number) => number> = {
  new: (j) => 2 + (j % 5),
  superfan: (j) => 14 + (j % 6),
  engaged: (j) => 4 + (j % 8),
  occasional: (j) => 1 + (j % 3),
  at_risk: () => 0,
  inactive: () => 0,
};

/** Active days 30-59 and 60-89 days ago, by band and slot (novos joined under 30 days ago). */
const EARLIER_DAYS: Record<EngagementBand, (j: number) => [number, number]> = {
  new: () => [0, 0],
  superfan: (j) => [j % 3 === 0 ? 8 : 14, 6 + (j % 4)],
  engaged: (j) => [j % 4 === 0 ? 2 : 6, 5],
  occasional: (j) => [j % 2 ? 5 : 2, 3],
  at_risk: (j) => [j % 2 ? 5 : 2, 4],
  inactive: () => [0, 3],
};

/** Who goes to the past events they registered for, by band and slot. */
const ATTENDS: Record<EngagementBand, (j: number) => boolean> = {
  new: (j) => j % 2 === 0,
  superfan: (j) => j % 4 !== 3,
  engaged: (j) => j % 3 !== 2,
  occasional: (j) => j % 2 === 0,
  at_risk: () => false,
  inactive: () => false,
};

/**
 * 30-day comments by band and slot (quick 261013-uoi C-1): near 2f39aec6 inside the realistic ranges
 * (superfã 6-12, engajado 3-8, ocasional 1-3, novo 0-3), 168 in all, never more than 2 a day.
 */
const COMMENTS: Record<EngagementBand, (j: number) => number> = {
  new: (j) => j % 3,
  superfan: (j) => 6 + (j % 4),
  engaged: (j) => 3 + (j % 3),
  occasional: (j) => 1 + (j % 2),
  at_risk: () => 0,
  inactive: () => 0,
};

/** Likes beyond one per active day. */
const EXTRA_LIKES: Record<EngagementBand, (j: number) => number> = {
  new: (j) => j % 3,
  superfan: (j) => 12 + j,
  engaged: (j) => 2 + j,
  occasional: () => 0,
  at_risk: () => 0,
  inactive: () => 0,
};

/** Actions since joining, all communities together. */
const LIFETIME_ACTIONS: Record<EngagementBand, (j: number) => number> = {
  new: (j) => 6 + 2 * j,
  superfan: (j) => 240 + 10 * j,
  engaged: (j) => 120 + 6 * j,
  occasional: (j) => 40 + 3 * j,
  at_risk: (j) => 30 + 2 * j,
  inactive: (j) => 12 + j,
};

const POST_TYPES: readonly PostType[] = ['video', 'gallery', 'text', 'link'];

function at<T>(rows: readonly T[], index: number): T {
  const row = rows[index];
  if (row === undefined) throw new Error(`no row at index ${index}`);
  return row;
}

/** `count` days spread up from `from` (one to three apart), never past `to`. */
function spread(from: number, to: number, count: number): number[] {
  const n = Math.max(0, Math.min(count, to - from + 1));
  if (n === 0) return [];
  const step = n > 1 ? Math.max(1, Math.min(3, Math.floor((to - from) / (n - 1)))) : 1;
  return Array.from({ length: n }, (_, k) => from + k * step);
}

function countIn(days: ReadonlySet<number>, from: number, to: number): number {
  let count = 0;
  for (const day of days) if (day >= from && day <= to) count += 1;
  return count;
}

/** The band at `daysAgo` from the active days (strong actions are assumed with 12+ days). */
function bandAt(days: ReadonlySet<number>, joined: number, daysAgo: number): EngagementBand | null {
  if (joined < daysAgo) return null;
  if (joined - daysAgo < 30) return 'new';
  const active = countIn(days, daysAgo, daysAgo + 29);
  if (active >= 12) return 'superfan';
  if (active >= 4) return 'engaged';
  if (active >= 1) return 'occasional';
  return countIn(days, daysAgo + 30, daysAgo + 59) > 0 ? 'at_risk' : 'inactive';
}

/** A member's days, events and orders: everything but which posts they liked and commented on. */
interface MemberBase {
  j: number;
  joined: number;
  days: Set<number>;
  attended: Set<string>;
  pastByRecency: { id: string; daysAgo: number }[];
  orders: readonly FinanceOrder[];
  /** The one paid order of the last 30 days, or null. */
  monthOrder: FinanceOrder | null;
  activeDays: number;
  likes: number;
  comments: number;
}

function baseOf(row: OwnerRosterMember): MemberBase {
  const { band } = row;
  const j = ownerBandRoster.filter((other) => other.band === band).indexOf(row);
  const last = row.lastActive.daysAgo;
  const joined = daysSince(row.memberSince);
  const target = ACTIVE_DAYS[band](j);

  // Every purchase is a counted action, so its day is an active day.
  const orders = ORDERS_BY_MEMBER.get(row.id) ?? [];
  const month = orders.filter((order) => order.daysAgo < MONTH_DAYS);
  if (month.length > 1) throw new Error(`${row.id} buys more than once in the month`);
  const monthOrder = month[0] ?? null;
  const recent = new Set<number>();
  if (target > 0) recent.add(last);
  if (monthOrder) recent.add(monthOrder.daysAgo);

  // Past events, most recent first: attended only when active since, and within the band's days.
  const attended = new Set<string>();
  const pastByRecency = events.past
    .filter((event) => row.eventIds.includes(event.id))
    .map((event) => ({ id: event.id, daysAgo: daysSince(event.date) }))
    .sort((a, b) => a.daysAgo - b.daysAgo);
  for (const event of pastByRecency) {
    if (!ATTENDS[band](j) || event.daysAgo < last) continue;
    const grown = new Set(recent).add(event.daysAgo);
    if (band !== 'new' && grown.size > target) continue;
    attended.add(event.id);
    recent.add(event.daysAgo);
  }

  const lastRecentDay = Math.min(29, joined);
  for (const day of [
    ...spread(last, lastRecentDay, target),
    ...spread(last, lastRecentDay, lastRecentDay - last + 1),
  ]) {
    if (recent.size >= target) break;
    recent.add(day);
  }

  const days = new Set(recent);
  const [between30and59, between60and89] = EARLIER_DAYS[band](j);
  const from30 = band === 'at_risk' ? last : 30 + (j % 3);
  for (const day of spread(from30, Math.min(59, joined), between30and59)) days.add(day);
  const from60 = band === 'inactive' ? last : 60 + (j % 3);
  if (band !== 'inactive' || last <= 89) {
    for (const day of spread(from60, Math.min(89, joined), between60and89)) days.add(day);
  }
  days.add(last);
  for (const order of orders) days.add(order.daysAgo);

  const today = bandAt(days, joined, 0);
  if (today !== band || Math.min(...days) !== last) {
    throw new Error(`the insights of ${row.id} disagree with the roster`);
  }

  const activeDays = countIn(days, 0, 29);
  const likes = activeDays === 0 ? 0 : activeDays + EXTRA_LIKES[band](j);
  const comments = activeDays === 0 ? 0 : COMMENTS[band](j);
  return {
    j,
    joined,
    days,
    attended,
    pastByRecency,
    orders,
    monthOrder,
    activeDays,
    likes,
    comments,
  };
}

let assignment: RosterInteractions | null = null;

/**
 * Which posts every active member liked and commented on, assigned once for the whole roster
 * (quick 261013-uoi): the Conteúdo people lists are the inverse of these, so they must be built
 * together. Memoized: the roster is fixed, and this keeps every render the same.
 */
function rosterInteractions(): RosterInteractions {
  assignment ??= assignRosterInteractions(
    ownerBandRoster.flatMap((row) => {
      const base = baseOf(row);
      if (base.activeDays === 0) return [];
      return [
        {
          row,
          days: [...base.days].filter((day) => day <= 29),
          likes: base.likes,
          comments: base.comments,
        },
      ];
    }),
  );
  return assignment;
}

function build(row: OwnerRosterMember, index: number): OwnerMemberInsights {
  const { band } = row;
  const base = baseOf(row);
  const { j, joined, days, attended, pastByRecency, monthOrder, activeDays, likes } = base;
  const last = row.lastActive.daysAgo;
  const checkIns = attended.size;
  const orders = monthOrder ? 1 : 0;
  const assigned = rosterInteractions().get(row.id) ?? { likes: [], comments: [] };
  // The assignment places the whole budget; the length check below catches any drift.
  const comments = assigned.comments.length;
  const lists = buildOwnerMemberLists({
    row,
    j,
    activeDays: [...days].filter((day) => day <= 29),
    likes: assigned.likes,
    comments: assigned.comments,
    attended: pastByRecency
      .filter((event) => attended.has(event.id))
      .map((event) => ({ eventId: event.id, daysAgo: event.daysAgo })),
    order: monthOrder
      ? { productId: monthOrder.productId, cents: monthOrder.cents, daysAgo: monthOrder.daysAgo }
      : null,
  });
  const lengths: [string, number, number][] = [
    ['active days', lists.activeDays.length, activeDays],
    ['likes', lists.likes.length, likes],
    ['comments', lists.comments.length, comments],
    ['strong actions', lists.strongActions.length, comments + checkIns + orders],
  ];
  for (const [name, length, count] of lengths) {
    if (length !== count) {
      throw new Error(
        `the ${name} list of ${row.id} (${length}) disagrees with its count (${count})`,
      );
    }
  }

  // Since joining is never fewer than the last 30 days (quick 261013-orf).
  const lifetime = Math.max(LIFETIME_ACTIONS[band](j), likes + comments + checkIns + orders);
  const others = byCommunity.filter(
    (community) => community.id !== row.topCommunityId && row.communities[community.id],
  );
  const communities = [
    { id: row.topCommunityId, actions: lifetime },
    ...others.map((community, rank) => ({
      id: community.id,
      actions: Math.floor((lifetime * 0.6) / (rank + 1)),
    })),
  ];

  const interactions = Math.round(lifetime * 0.8);
  const postTypes = POST_TYPES.map((type, k) => ({
    type,
    interactions: Math.floor((interactions * (4 - ((k + j) % 4))) / 10),
  })).sort((a, b) => b.interactions - a.interactions);

  const purchases = base.orders.map((order) => {
    const kind = financeRevenueKind(order);
    // An entry and a VIP purchase give a year of access (D-03); the end is an example.
    const yearly = kind === 'primary' || financeOffer(order.offerId).productId === VIP_PRODUCT;
    return {
      productId: order.productId,
      offerId: order.offerId,
      kind,
      date: daysBefore(PREVIEW_TODAY, order.daysAgo),
      cents: order.cents,
      expiresAt: yearly
        ? {
            example: true as const,
            reason: 'needs_access_expiry' as const,
            value: daysBefore(PREVIEW_TODAY, order.daysAgo - FINANCE_ACCESS_DAYS),
          }
        : null,
    };
  });

  const conversations = index % 5 === 1 ? 1 + (j % 2) : 0;
  const lastDaysAgo = conversations === 0 ? null : Math.min(2 + 3 * j, joined);
  const medianResponseMinutes =
    lastDaysAgo === null
      ? null
      : at(
          support.firstResponse.weeklyMedianMinutes,
          SUPPORT_WEEKS - 1 - Math.floor(lastDaysAgo / 7),
        );

  return {
    id: row.id,
    name: row.name,
    band,
    memberSince: row.memberSince,
    lastActive: row.lastActive,
    topCommunityId: row.topCommunityId,
    last30: {
      activeDays,
      likes,
      comments,
      checkIns,
      orders,
      strongActions: comments + checkIns + orders,
      dailyMinutes: row.dailyMinutes,
      postsSeen: {
        example: true,
        reason: 'needs_post_views',
        value: lists.postsSeen.value.length,
      },
    },
    lists,
    weeklyActiveDays: Array.from({ length: 12 }, (_, i) => {
      const weeksBack = 11 - i;
      return countIn(days, 7 * weeksBack, 7 * weeksBack + 6);
    }),
    bandHistory: [
      ...[60, 30].map((daysAgo) => ({
        month: daysBefore(PREVIEW_TODAY, daysAgo).slice(0, 7),
        band: bandAt(days, joined, daysAgo),
      })),
      { month: 'today', band },
    ],
    communities,
    postTypes,
    events: row.eventIds.map((id) => ({
      id,
      attended: events.past.some((event) => event.id === id) ? attended.has(id) : null,
    })),
    purchases,
    support: { conversations, lastDaysAgo, medianResponseMinutes },
    suggestion: { kind: band, days: band === 'new' ? joined : last },
  };
}

/** One member's insights, or null for an id outside the roster. */
export function ownerMemberInsights(id: string): OwnerMemberInsights | null {
  const index = ownerBandRoster.findIndex((row) => row.id === id);
  const row = ownerBandRoster[index];
  return row ? build(row, index) : null;
}
