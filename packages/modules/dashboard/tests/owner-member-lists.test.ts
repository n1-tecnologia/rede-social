import { describe, expect, it } from 'vitest';
import type { OwnerMemberInsights } from '../fixtures';
import {
  financeOffer,
  ownerContentItem,
  ownerContentUnanswered,
  ownerMemberInsights,
  tenantOwnerPanel,
} from '../fixtures';
import {
  daysSince,
  momentHoursAgo,
  ownerBandRoster,
  PREVIEW_TODAY,
} from '../fixtures/owner-members';
import { OWNER_POST_UNANSWERED, ownerPostTable } from '../fixtures/owner-posts';

/**
 * Quick 261012-tru D-07: the lists behind a member's insight numbers. Each list's length is its
 * KPI, every post is one the member can reach and was published before the action, and the lists
 * agree with each other (a comment sits on a post liked that day; the active days add up the
 * actions).
 */

const { byCommunity, byFormat, topPosts, events } = tenantOwnerPanel;
const ALL_EVENTS = [...events.past, ...events.upcoming];

function insightsOf(id: string): OwnerMemberInsights {
  const insights = ownerMemberInsights(id);
  if (!insights) throw new Error(`no insights for ${id}`);
  return insights;
}

const ALL = ownerBandRoster.map((row) => ({ row, insights: insightsOf(row.id) }));

function countBy<T>(rows: readonly T[], key: (row: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) counts[key(row)] = (counts[key(row)] ?? 0) + 1;
  return counts;
}

/** Most recent first: fewer days ago first (a missing time reads as the day's start). */
function isRecentFirst(moments: readonly { daysAgo: number }[]): boolean {
  return moments.every((moment, i) => i === 0 || (moments[i - 1]?.daysAgo ?? 0) <= moment.daysAgo);
}

describe('the client’s posts of the last 30 days', () => {
  it('are 61 unique posts matching the Conteúdo numbers by community and format', () => {
    expect(ownerPostTable).toHaveLength(61);
    expect(ownerPostTable.map((post) => post.id)).toEqual(
      Array.from({ length: 61 }, (_, i) => `op-${String(i + 1).padStart(2, '0')}`),
    );
    expect(new Set(ownerPostTable.map((post) => post.excerpt)).size).toBe(61);
    const byCommunityCount = countBy(ownerPostTable, (post) => post.communityId);
    for (const row of byCommunity) expect(byCommunityCount[row.id], row.id).toBe(row.posts);
    const byType = countBy(ownerPostTable, (post) => post.type);
    for (const row of byFormat) expect(byType[row.type], row.type).toBe(row.posts);
  });

  it('fall within the window, each community spread over it', () => {
    for (const post of ownerPostTable) {
      const age = daysSince(post.date);
      expect(age, post.id).toBeGreaterThanOrEqual(0);
      expect(age, post.id).toBeLessThanOrEqual(29);
    }
    for (const id of ['c-vip', 'c-geral']) {
      expect(
        ownerPostTable.some((post) => post.communityId === id && daysSince(post.date) >= 27),
        id,
      ).toBe(true);
    }
    for (const row of byCommunity) {
      const ages = ownerPostTable
        .filter((post) => post.communityId === row.id)
        .map((post) => daysSince(post.date));
      expect(Math.max(...ages) - Math.min(...ages), row.id).toBeGreaterThanOrEqual(20);
    }
    expect(PREVIEW_TODAY).toBe('2026-10-12');
  });

  it('hold each top post with its date, format and community', () => {
    for (const top of topPosts) {
      const community = byCommunity.find((row) => row.name === top.community);
      expect(community, top.id).toBeDefined();
      expect(
        ownerPostTable.some(
          (post) =>
            post.date === top.date && post.type === top.type && post.communityId === community?.id,
        ),
        top.id,
      ).toBe(true);
    }
  });
});

describe('each member’s lists (D-07)', () => {
  it('have the length of their KPI', () => {
    for (const { row, insights } of ALL) {
      const { lists, last30 } = insights;
      expect(lists.activeDays, row.id).toHaveLength(last30.activeDays);
      expect(lists.likes, row.id).toHaveLength(last30.likes);
      expect(lists.comments, row.id).toHaveLength(last30.comments);
      expect(lists.strongActions, row.id).toHaveLength(last30.strongActions);
      expect(lists.postsSeen.value, row.id).toHaveLength(last30.postsSeen.value);
      expect(lists.postsSeen, row.id).toMatchObject({
        example: true,
        reason: 'needs_post_views',
      });
    }
  });

  it('are empty for em risco and inativos', () => {
    for (const { row, insights } of ALL) {
      if (row.band !== 'at_risk' && row.band !== 'inactive') continue;
      const { lists } = insights;
      expect(lists.activeDays, row.id).toHaveLength(0);
      expect(lists.likes, row.id).toHaveLength(0);
      expect(lists.comments, row.id).toHaveLength(0);
      expect(lists.strongActions, row.id).toHaveLength(0);
      expect(lists.postsSeen.value, row.id).toHaveLength(0);
    }
  });

  it('like distinct reachable posts, after they were published, on the active days', () => {
    for (const { row, insights } of ALL) {
      const { likes, activeDays } = insights.lists;
      expect(new Set(likes.map((like) => like.post.id)).size, row.id).toBe(likes.length);
      const days = new Set(activeDays.map((day) => day.when.daysAgo));
      for (const like of likes) {
        expect(Object.keys(row.communities), `${row.id} ${like.post.id}`).toContain(
          like.post.communityId,
        );
        expect(like.when.daysAgo, `${row.id} ${like.post.id}`).toBeLessThanOrEqual(
          daysSince(like.post.date),
        );
        expect(days.has(like.when.daysAgo), `${row.id} ${like.post.id}`).toBe(true);
      }
      for (const day of days) {
        expect(
          likes.some((like) => like.when.daysAgo === day),
          `${row.id} day ${day}`,
        ).toBe(true);
      }
      expect(isRecentFirst(likes.map((like) => like.when)), row.id).toBe(true);
      if (likes.length > 0) expect(likes[0]?.when, row.id).toEqual(row.lastActive);
    }
  });

  it('comments: distinct reachable posts, each on an active day no later than the post’s age, one per post, and the count is the KPI', () => {
    for (const { row, insights } of ALL) {
      const { comments, activeDays } = insights.lists;
      expect(comments, row.id).toHaveLength(insights.last30.comments);
      expect(new Set(comments.map((comment) => comment.post.id)).size, row.id).toBe(
        comments.length,
      );
      const days = new Set(activeDays.map((day) => day.when.daysAgo));
      for (const comment of comments) {
        const where = `${row.id} ${comment.post.id}`;
        expect(Object.keys(row.communities), where).toContain(comment.post.communityId);
        expect(comment.when.daysAgo, where).toBeLessThanOrEqual(daysSince(comment.post.date));
        expect(days.has(comment.when.daysAgo), where).toBe(true);
      }
      expect(isRecentFirst(comments.map((comment) => comment.when)), row.id).toBe(true);
    }
  });

  it('like as many posts as active days plus the band’s extras (the KPI is unchanged)', () => {
    const extras: Record<string, (j: number) => number> = {
      new: (j) => j % 3,
      superfan: (j) => 12 + j,
      engaged: (j) => 2 + j,
      occasional: () => 0,
    };
    for (const { row, insights } of ALL) {
      const extra = extras[row.band];
      if (!extra) continue;
      const j = ownerBandRoster.filter((other) => other.band === row.band).indexOf(row);
      expect(insights.last30.likes, row.id).toBe(insights.last30.activeDays + extra(j));
    }
  });

  it('every listed post has a feed kind (D-03)', () => {
    for (const { row, insights } of ALL) {
      const { likes, comments, strongActions, postsSeen } = insights.lists;
      const listed = [
        ...likes.map((like) => like.post),
        ...comments.map((comment) => comment.post),
        ...strongActions.flatMap((action) => (action.kind === 'comment' ? [action.post] : [])),
        ...postsSeen.value.map((entry) => entry.post),
      ];
      for (const post of listed) {
        const item = ownerContentItem(post.id);
        expect(item.kind, `${row.id} ${post.id}`).not.toBe('story');
        expect(item.kind === 'video', `${row.id} ${post.id}`).toBe((item.durationSeconds ?? 0) > 0);
        expect(item.durationSeconds, `${row.id} ${post.id}`).toBe(post.durationSeconds);
      }
    }
  });

  it('count as strong actions the comments, the check-ins and the 30-day order', () => {
    for (const { row, insights } of ALL) {
      const { strongActions, comments } = insights.lists;
      const { last30, events: registrations, purchases } = insights;
      const kinds = countBy(strongActions, (action) => action.kind);
      expect(kinds.comment ?? 0, row.id).toBe(comments.length);
      expect(kinds.check_in ?? 0, row.id).toBe(last30.checkIns);
      expect(kinds.order ?? 0, row.id).toBe(last30.orders);
      for (const action of strongActions) {
        if (action.kind === 'check_in') {
          const event = ALL_EVENTS.find((other) => other.id === action.eventId);
          expect(event, row.id).toBeDefined();
          expect(action.when.daysAgo, row.id).toBe(daysSince(event?.date ?? ''));
          expect(
            registrations.some((entry) => entry.id === action.eventId && entry.attended),
            row.id,
          ).toBe(true);
        }
        if (action.kind === 'order') {
          const order = purchases.find((purchase) => daysSince(purchase.date) < 30);
          expect(action.productId, row.id).toBe(order?.productId);
          expect(action.cents, row.id).toBe(financeOffer(order?.offerId ?? '').priceCents);
          expect(action.when.daysAgo, row.id).toBe(daysSince(order?.date ?? ''));
        }
      }
      expect(isRecentFirst(strongActions.map((action) => action.when)), row.id).toBe(true);
    }
  });

  it('list one row per active day whose actions add up', () => {
    for (const { row, insights } of ALL) {
      const { activeDays } = insights.lists;
      const { likes, comments, checkIns, orders } = insights.last30;
      expect(isRecentFirst(activeDays.map((day) => day.when)), row.id).toBe(true);
      expect(new Set(activeDays.map((day) => day.when.daysAgo)).size, row.id).toBe(
        activeDays.length,
      );
      for (const day of activeDays) expect(day.actions, row.id).toBeGreaterThanOrEqual(1);
      expect(
        activeDays.reduce((total, day) => total + day.actions, 0),
        row.id,
      ).toBe(likes + comments + checkIns + orders);
    }
  });

  it('comment at most twice and like at most 6 times a day (quick 261013-uoi C-1, F-1)', () => {
    for (const { row, insights } of ALL) {
      const comments = countBy(insights.lists.comments, (entry) => String(entry.when.daysAgo));
      for (const [day, count] of Object.entries(comments)) {
        expect(count, `${row.id} comments ${day} days ago`).toBeLessThanOrEqual(2);
      }
      const likes = countBy(insights.lists.likes, (entry) => String(entry.when.daysAgo));
      for (const [day, count] of Object.entries(likes)) {
        expect(count, `${row.id} likes ${day} days ago`).toBeLessThanOrEqual(6);
      }
    }
  });

  it('time every action of the last day once, the latest at the last action (quick 261013-uoi F-1)', () => {
    for (const { row, insights } of ALL) {
      const { likes, comments, strongActions } = insights.lists;
      const last = row.lastActive;
      const actions = [...likes, ...strongActions];
      const onLast = actions.filter((entry) => entry.when.daysAgo === last.daysAgo);
      if (onLast.length === 0) continue;
      const times = onLast.map((entry) => entry.when.time);
      for (const time of times) {
        expect(time, `${row.id} untimed on the last day`).toBeDefined();
        expect((time ?? '') <= (last.time ?? ''), `${row.id} ${time} after ${last.time}`).toBe(
          true,
        );
      }
      expect(new Set(times).size, `${row.id} repeated times`).toBe(times.length);
      expect(
        times.filter((time) => time === last.time),
        row.id,
      ).toHaveLength(1);

      // Yesterday, when it is not the last day, every action reads with its own time.
      if (last.daysAgo !== 1) {
        const yesterday = actions.filter((entry) => entry.when.daysAgo === 1);
        const stamps = yesterday.map((entry) => entry.when.time);
        for (const stamp of stamps) expect(stamp, `${row.id} untimed yesterday`).toBeDefined();
        expect(new Set(stamps).size, `${row.id} repeated times yesterday`).toBe(stamps.length);
      }

      // On the other days, only the oldest unanswered comment of a post carries a time.
      const elsewhere = (entry: { when: { daysAgo: number; time?: string } }) =>
        entry.when.daysAgo !== last.daysAgo &&
        entry.when.daysAgo !== 1 &&
        entry.when.time !== undefined;
      expect(likes.filter(elsewhere), `${row.id} likes timed on another day`).toEqual([]);
      for (const entry of strongActions.filter(elsewhere)) {
        expect(entry.kind, `${row.id} timed on another day`).toBe('comment');
        const post = entry.kind === 'comment' ? entry.post.id : '';
        const wait = OWNER_POST_UNANSWERED[post]?.[1];
        expect(wait, `${row.id} ${post} timed on another day`).toBeDefined();
        expect(entry.when, `${row.id} ${post}`).toEqual(momentHoursAgo(wait ?? 0));
        expect(ownerContentUnanswered(post)[0]?.person.id, `${row.id} ${post}`).toBe(row.id);
      }
      for (const comment of comments) {
        const action = strongActions.find(
          (entry) => entry.kind === 'comment' && entry.post.id === comment.post.id,
        );
        expect(action?.when, `${row.id} ${comment.post.id}`).toEqual(comment.when);
      }
    }
  });

  it('see distinct reachable posts, every liked one included, most viewed first', () => {
    for (const { row, insights } of ALL) {
      const seen = insights.lists.postsSeen.value;
      const ids = seen.map((entry) => entry.post.id);
      expect(new Set(ids).size, row.id).toBe(ids.length);
      for (const like of insights.lists.likes) expect(ids, row.id).toContain(like.post.id);
      const pool = ownerPostTable.filter((post) => row.communities[post.communityId]);
      expect(seen.length, row.id).toBeLessThanOrEqual(pool.length);
      for (const [i, entry] of seen.entries()) {
        expect(Object.keys(row.communities), row.id).toContain(entry.post.communityId);
        expect(entry.views, row.id).toBeGreaterThanOrEqual(1);
        expect(entry.seconds, row.id).toBeGreaterThan(0);
        expect(entry.lastSeen.daysAgo, row.id).toBeLessThanOrEqual(daysSince(entry.post.date));
        const previous = seen[i - 1];
        if (previous) {
          const ordered =
            previous.views > entry.views ||
            (previous.views === entry.views && previous.lastSeen.daysAgo <= entry.lastSeen.daysAgo);
          expect(ordered, `${row.id} ${entry.post.id}`).toBe(true);
        }
      }
    }
  });
});
