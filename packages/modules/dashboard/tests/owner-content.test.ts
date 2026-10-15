import { describe, expect, it } from 'vitest';
import {
  CONTENT_KIND_ORDER,
  type ContentItem,
  type ContentKind,
  financeProductOffers,
  ownerContent,
  ownerContentDetail,
  ownerContentIncludes,
  ownerContentInteractions,
  ownerContentInteractorIncludes,
  ownerContentInteractors,
  ownerContentItem,
  ownerContentItems,
  ownerContentKindMetric,
  ownerContentKindRetention,
  ownerContentKindVelocity,
  ownerContentPeople,
  ownerContentUnanswered,
  ownerFinanceWindow,
  ownerMemberInsights,
  tenantOwnerPanel,
} from '../fixtures';
import { buildOwnerContentPeople } from '../fixtures/owner-content';
import {
  daysSince,
  momentHoursAgo,
  ownerBandRoster,
  PREVIEW_NOW_TIME,
} from '../fixtures/owner-members';
import { ownerPostTable } from '../fixtures/owner-posts';
import { ENGAGEMENT_BAND_ORDER } from '../ui/metrics';

/**
 * Quick 261013-h51 D-05, D-08: the Conteúdo area's items (the 61 feed posts and the 16 stories),
 * their numbers and the people behind them. The sums close with the panel's own numbers, and a
 * member's liked post and that post's likers are one fact seen from both sides.
 */

const { byCommunity, byFormat, topPosts, reach, stories, videoPlayback } = tenantOwnerPanel;

const posts = ownerContentItems.filter((item) => item.kind !== 'story');
const storyItems = ownerContentItems.filter((item) => item.kind === 'story');

function sum(items: readonly ContentItem[], pick: (item: ContentItem) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

function insightsOf(id: string) {
  const insights = ownerMemberInsights(id);
  if (!insights) throw new Error(`no insights for ${id}`);
  return insights;
}

const ROSTER = ownerBandRoster.map((row) => ({ row, insights: insightsOf(row.id) }));

describe('the content items', () => {
  it('are the 61 feed posts newest first, then 16 stories', () => {
    expect(ownerContentItems).toHaveLength(77);
    expect(posts.map((item) => item.id)).toEqual(ownerPostTable.map((post) => post.id));
    expect(storyItems.map((item) => item.id)).toEqual(
      Array.from({ length: 16 }, (_, i) => `os-${String(i + 1).padStart(2, '0')}`),
    );
    expect(ownerContentItems.slice(0, 61).every((item) => item.kind !== 'story')).toBe(true);
    expect(CONTENT_KIND_ORDER).toEqual(['video', 'photo', 'carousel', 'text', 'link', 'story']);
  });

  it('total 3.100 likes and 840 comments over the 61 posts', () => {
    expect(sum(posts, (item) => item.likes)).toBe(3100);
    expect(sum(posts, (item) => item.comments)).toBe(840);
  });

  it('match byCommunity and byFormat', () => {
    for (const row of byCommunity) {
      const rows = posts.filter((item) => item.communityId === row.id);
      expect(rows, row.id).toHaveLength(row.posts);
      expect(
        sum(rows, (item) => item.likes + item.comments),
        row.id,
      ).toBe(row.interactions);
    }
    for (const row of byFormat) {
      const rows = ownerPostTable.filter((post) => post.type === row.type);
      expect(rows, row.type).toHaveLength(row.posts);
      expect(
        rows.reduce((total, post) => total + post.likes + post.comments, 0),
        row.type,
      ).toBe(row.interactions);
    }
  });

  it('split per kind as the Por tipo table (photo + carousel = the 15 gallery posts)', () => {
    const expected: Record<Exclude<ContentKind, 'story'>, [number, number, number]> = {
      video: [18, 1489, 240],
      photo: [6, 310, 62],
      carousel: [9, 560, 135],
      text: [20, 591, 369],
      link: [8, 150, 34],
    };
    for (const [kind, [count, likes, comments]] of Object.entries(expected)) {
      const rows = posts.filter((item) => item.kind === kind);
      expect(rows, kind).toHaveLength(count);
      expect(
        sum(rows, (item) => item.likes),
        kind,
      ).toBe(likes);
      expect(
        sum(rows, (item) => item.comments),
        kind,
      ).toBe(comments);
    }
  });

  it('carry the four top posts with their numbers', () => {
    const ids = ['op-11', 'op-15', 'op-19', 'op-22'];
    for (const [i, top] of topPosts.entries()) {
      const item = ownerContentItem(ids[i] ?? '');
      expect(item, top.id).toMatchObject({
        date: top.date,
        likes: top.likes,
        comments: top.comments,
        saves: top.saves,
        shares: top.shares,
      });
    }
    expect(ownerContentItem('op-15').kind).toBe('carousel');
  });

  it('read their kind with the SPEC §2.3 rule', () => {
    for (const post of ownerPostTable) {
      const item = ownerContentItem(post.id);
      if (post.type === 'gallery') {
        expect(item.kind, post.id).toBe((post.cards ?? 0) === 1 ? 'photo' : 'carousel');
        expect(post.cards, post.id).toBeGreaterThanOrEqual(1);
      } else {
        expect(item.kind, post.id).toBe(post.type);
      }
    }
  });

  it('have the media size of their kind', () => {
    for (const item of posts) {
      if (item.kind === 'video') {
        const seconds = item.durationSeconds ?? 0;
        expect(seconds, item.id).toBeGreaterThan(0);
        expect(item.media, item.id).toEqual(
          seconds <= 90 ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 },
        );
      } else {
        expect(item.durationSeconds, item.id).toBeNull();
      }
      if (item.kind === 'photo') {
        expect(item.media, item.id).toEqual({ width: 1080, height: 1350 });
        expect(item.cards, item.id).toBe(1);
      }
      if (item.kind === 'carousel') {
        expect(item.media, item.id).not.toBeNull();
        expect(item.cards, item.id).toBeGreaterThanOrEqual(2);
      }
      if (item.kind === 'text' || item.kind === 'link') expect(item.media, item.id).toBeNull();
    }
    expect(ownerContentItem('op-11')).toMatchObject({
      kind: 'video',
      durationSeconds: 58,
      media: { width: 1080, height: 1920 },
    });
  });

  it('keep the example values marked and coherent (likes ≤ reach ≤ 1.240 ≤ …, views ≥ reach)', () => {
    for (const item of posts) {
      expect(item.saves, item.id).toMatchObject({ example: true, reason: 'needs_saves' });
      expect(item.shares, item.id).toMatchObject({ example: true, reason: 'needs_shares' });
      expect(item.views, item.id).toMatchObject({ example: true, reason: 'needs_post_views' });
      expect(item.reach, item.id).toMatchObject({ example: true, reason: 'needs_post_views' });
      expect(item.likes, item.id).toBeLessThanOrEqual(item.reach.value);
      expect(item.reach.value, item.id).toBeLessThanOrEqual(1240);
      expect(item.views.value, item.id).toBeGreaterThanOrEqual(item.reach.value);
    }
    expect(sum(posts, (item) => item.reach.value)).toBe(23488);
    expect(Math.round(sum(posts, (item) => item.reach.value) / posts.length)).toBe(
      reach.value.perPost,
    );
  });

  it('hold 16 measured stories inside the 30 days', () => {
    expect(storyItems).toHaveLength(stories.count);
    for (const item of storyItems) {
      expect(item.communityId, item.id).toBeNull();
      expect(item.media, item.id).toEqual({ width: 1080, height: 1920 });
      expect(daysSince(item.date), item.id).toBeLessThanOrEqual(29);
      expect(daysSince(item.date), item.id).toBeGreaterThanOrEqual(0);
      expect(item.reach.example, item.id).toBe(false);
      expect(item.views.example, item.id).toBe(false);
      expect(item.views.value, item.id).toBeGreaterThanOrEqual(item.reach.value);
      expect(item.saves, item.id).toBeNull();
    }
    expect(sum(storyItems, (item) => item.likes)).toBe(412);
    expect(sum(storyItems, (item) => item.comments)).toBe(63);
    expect(sum(storyItems, (item) => item.reach.value)).toBe(
      stories.count * stories.averageUniqueViewers,
    );
  });

  it('give each kind its own metric, examples with their reasons', () => {
    expect(ownerContentKindMetric.video).toEqual(videoPlayback.watchedPercent);
    expect(ownerContentKindMetric.carousel).toEqual({
      example: true,
      reason: 'needs_gallery_swipes',
      value: 48,
    });
    expect(ownerContentKindMetric.link).toEqual({
      example: true,
      reason: 'needs_link_clicks',
      value: 14,
    });
    expect(ownerContentKindMetric.story).toEqual({
      example: true,
      reason: 'needs_story_taps',
      value: 22,
    });
  });

  it('throw on an unknown id', () => {
    expect(() => ownerContentItem('op-99')).toThrow();
    expect(() => ownerContentPeople('op-99', 'likes')).toThrow();
    expect(() => ownerContentPeople('os-01', 'saves')).toThrow();
  });
});

describe('the people behind each number (P1)', () => {
  it('never outnumber the measured likes and comments', () => {
    for (const item of ownerContentItems) {
      expect(ownerContentPeople(item.id, 'likes').people.length, item.id).toBeLessThanOrEqual(
        item.likes,
      );
      expect(ownerContentPeople(item.id, 'comments').people.length, item.id).toBeLessThanOrEqual(
        item.comments,
      );
      expect(ownerContentPeople(item.id, 'likes').total, item.id).toBe(item.likes);
      expect(ownerContentPeople(item.id, 'comments').total, item.id).toBe(item.comments);
    }
  });

  it('are the same fact as each member’s liked and commented posts (both directions)', () => {
    let likes = 0;
    let comments = 0;
    for (const { row, insights } of ROSTER) {
      for (const post of posts) {
        const liked = insights.lists.likes.find((like) => like.post.id === post.id);
        const liker = ownerContentPeople(post.id, 'likes').people.find(
          (person) => person.id === row.id,
        );
        expect(Boolean(liker), `${row.id} likes ${post.id}`).toBe(Boolean(liked));
        if (liked) {
          expect(liker?.when, `${row.id} ${post.id}`).toEqual(liked.when);
          likes += 1;
        }
        const commented = insights.lists.comments.find((comment) => comment.post.id === post.id);
        const commenter = ownerContentPeople(post.id, 'comments').people.find(
          (person) => person.id === row.id,
        );
        expect(Boolean(commenter), `${row.id} comments ${post.id}`).toBe(Boolean(commented));
        if (commented) {
          expect(commenter?.when, `${row.id} ${post.id}`).toEqual(commented.when);
          comments += 1;
        }
      }
    }
    // Quick 261014-dwc: om-01's e-book entry on its joining day is one more active day, one more like.
    expect(likes).toBe(664);
    // Quick 261013-uoi C-1: each member comments within their band's realistic range.
    expect(comments).toBe(168);
  });

  it('carry their band and are listed most recent first', () => {
    for (const item of ownerContentItems) {
      for (const who of ['likes', 'comments'] as const) {
        const { people } = ownerContentPeople(item.id, who);
        for (const [i, person] of people.entries()) {
          const row = ownerBandRoster.find((member) => member.id === person.id);
          expect(person.band, person.id).toBe(row?.band);
          expect(person.name, person.id).toBe(row?.name);
          const before = people[i - 1];
          // Comments put the unanswered first (D-06), then most recent; likes are most recent first.
          if (before && Boolean(before.answered) === Boolean(person.answered)) {
            expect(before.when.daysAgo, item.id).toBeLessThanOrEqual(person.when.daysAgo);
          }
        }
      }
    }
  });

  it('on a story: active members who acted by then and had joined', () => {
    for (const item of storyItems) {
      const age = daysSince(item.date);
      for (const who of ['likes', 'comments'] as const) {
        for (const person of ownerContentPeople(item.id, who).people) {
          const row = ownerBandRoster.find((member) => member.id === person.id);
          expect(['new', 'superfan', 'engaged', 'occasional'], person.id).toContain(row?.band);
          expect(row?.lastActive.daysAgo ?? 99, person.id).toBeLessThanOrEqual(age);
          expect(daysSince(row?.memberSince ?? ''), person.id).toBeGreaterThanOrEqual(age);
          expect(person.when.daysAgo, person.id).toBe(age);
        }
      }
    }
  });

  it('saves and shares: an example subset of the likers, never longer than the value', () => {
    for (const item of ownerContentItems) {
      const likers = new Set(ownerContentPeople(item.id, 'likes').people.map((p) => p.id));
      for (const who of ['saves', 'shares'] as const) {
        const metric = who === 'saves' ? item.saves : item.shares;
        if (metric === null) continue;
        const list = ownerContentPeople(item.id, who);
        expect(list.example, item.id).toBe(true);
        expect(list.total, item.id).toBe(metric.value);
        expect(list.people.length, item.id).toBeLessThanOrEqual(metric.value);
        for (const person of list.people) expect(likers.has(person.id), item.id).toBe(true);
      }
    }
  });

  it('the predicate agrees with the lists, with no names', () => {
    const likers = ownerContentPeople('op-11', 'likes').people;
    const first = likers[0];
    expect(first).toBeDefined();
    expect(ownerContentIncludes('op-11', 'likes', first?.id ?? '')).toBe(true);
    const outsider = ownerBandRoster.find((row) => !likers.some((p) => p.id === row.id));
    expect(ownerContentIncludes('op-11', 'likes', outsider?.id ?? '')).toBe(false);
    expect(ownerContentIncludes('op-11', 'likes', 'om-99')).toBe(false);
  });

  it('two builds deep-equal (no clock, no randomness)', () => {
    expect(buildOwnerContentPeople()).toEqual(buildOwnerContentPeople());
  });
});

describe('the overview numbers (D-02, D-08)', () => {
  const { engagement, publishing } = tenantOwnerPanel;

  it('compare with the 30 days before', () => {
    const { deltas } = ownerContent;
    expect(deltas.posts).toMatchObject({ amount: 5, kind: 'count', direction: 'up' });
    expect(deltas.interactions).toMatchObject({ amount: 9, kind: 'percent', direction: 'up' });
    expect(deltas.rate).toMatchObject({ amount: 1, kind: 'points', direction: 'up' });
    expect(deltas.interactors).toMatchObject({ amount: 4, kind: 'percent', direction: 'up' });
    expect(deltas.views).toMatchObject({ amount: 6, kind: 'percent', direction: 'up' });
    expect(deltas.reach).toMatchObject({ amount: 6, kind: 'percent', direction: 'up' });
    for (const delta of Object.values(deltas)) expect(delta.basis).toBe('previous_30_days');
  });

  it('count who interacted per band, within the band and above the roster sample', () => {
    const { interactorsByBand } = ownerContent;
    expect(interactorsByBand).toEqual({
      new: 41,
      superfan: 62,
      engaged: 189,
      occasional: 136,
      at_risk: 0,
      inactive: 0,
    });
    expect(Object.values(interactorsByBand).reduce((a, b) => a + b, 0)).toBe(428);
    for (const band of ENGAGEMENT_BAND_ORDER) {
      expect(interactorsByBand[band], band).toBeLessThanOrEqual(engagement.counts[band]);
      expect(interactorsByBand[band], band).toBeGreaterThanOrEqual(
        ownerContentInteractors(band).people.length,
      );
    }
    expect(interactorsByBand.new).toBeLessThanOrEqual(engagement.newActivated);
  });

  it('trend over 12 weeks against the 12 before', () => {
    expect(ownerContent.weeklyPerPost.current).toEqual([
      52, 55, 54, 57, 58, 56, 60, 61, 63, 66, 64, 68,
    ]);
    expect(ownerContent.weeklyPerPost.previous).toEqual([
      48, 50, 49, 51, 53, 52, 54, 55, 58, 60, 59, 62,
    ]);
  });

  it('heatmap: 28 cells whose rows and columns are byWeekday and bySlot', () => {
    const { heatmap } = ownerContent;
    expect(heatmap).toHaveLength(28);
    for (const day of publishing.byWeekday) {
      const cells = heatmap.filter((cell) => cell.weekday === day.weekday);
      expect(cells, day.weekday).toHaveLength(4);
      expect(sumOf(cells, 'posts'), day.weekday).toBe(day.posts);
      expect(sumOf(cells, 'interactions'), day.weekday).toBe(day.interactions);
    }
    for (const slot of publishing.bySlot) {
      const cells = heatmap.filter((cell) => cell.fromHour === slot.fromHour);
      expect(cells, String(slot.fromHour)).toHaveLength(7);
      expect(cells.every((cell) => cell.toHour === slot.toHour)).toBe(true);
      expect(sumOf(cells, 'posts'), String(slot.fromHour)).toBe(slot.posts);
      expect(sumOf(cells, 'interactions'), String(slot.fromHour)).toBe(slot.interactions);
    }
    const perPost = heatmap.map((cell) => cell.interactions / cell.posts);
    const best = heatmap[perPost.indexOf(Math.max(...perPost))];
    expect(best).toMatchObject({ weekday: 'thu', fromHour: 20, posts: 4, interactions: 401 });
    expect(Math.round(Math.max(...perPost))).toBe(100);
    const worst = heatmap[perPost.indexOf(Math.min(...perPost))];
    expect(worst).toMatchObject({ weekday: 'sun', fromHour: 7, posts: 1, interactions: 39 });
  });

  it("each post's comments: answered by the team, the oldest unanswered, the first reply", () => {
    let late = 0;
    for (const item of posts) {
      const { answered, oldestUnansweredHours, firstReplyMedianMinutes } = item.commentMeta;
      expect(answered, item.id).toBeGreaterThanOrEqual(0);
      expect(answered, item.id).toBeLessThanOrEqual(item.comments);
      expect(oldestUnansweredHours === null, item.id).toBe(answered === item.comments);
      expect(firstReplyMedianMinutes === null, item.id).toBe(answered === 0);
      if (oldestUnansweredHours !== null) {
        expect(oldestUnansweredHours, item.id).toBeLessThanOrEqual(24 * (daysSince(item.date) + 1));
        if (daysSince(item.date) < 2) expect(oldestUnansweredHours, item.id).toBeLessThan(24);
        if (oldestUnansweredHours > 24) late += 1;
      }
    }
    expect(late).toBeGreaterThanOrEqual(3);
    const op19 = ownerContentItem('op-19');
    expect(op19.comments - op19.commentMeta.answered).toBe(9);
    expect(op19.commentMeta.oldestUnansweredHours).toBe(192);
  });
});

describe('who interacts and the interactions (D-02, PD-5, PD-7)', () => {
  const active = ROSTER.filter(
    ({ insights }) => insights.lists.likes.length + insights.lists.comments.length > 0,
  );

  it('the interactors are the roster members with a like or comment, most recent first', () => {
    const all = ownerContentInteractors(null);
    expect(all.total).toBe(428);
    expect(all.people.map((p) => p.id).sort()).toEqual(active.map(({ row }) => row.id).sort());
    for (const [i, person] of all.people.entries()) {
      const before = all.people[i - 1];
      if (before) expect(before.when.daysAgo).toBeLessThanOrEqual(person.when.daysAgo);
    }
    for (const band of ENGAGEMENT_BAND_ORDER) {
      const list = ownerContentInteractors(band);
      expect(list.total, band).toBe(ownerContent.interactorsByBand[band]);
      for (const person of list.people) {
        expect(person.band, band).toBe(band);
        expect(ownerContentInteractorIncludes(band, person.id), band).toBe(true);
        expect(ownerContentInteractorIncludes(null, person.id), band).toBe(true);
      }
    }
    const atRisk = ownerBandRoster.find((row) => row.band === 'at_risk');
    expect(ownerContentInteractorIncludes(null, atRisk?.id ?? '')).toBe(false);
    expect(
      ownerContentInteractorIncludes(
        'superfan',
        all.people.find((p) => p.band === 'new')?.id ?? '',
      ),
    ).toBe(false);
  });

  it('the interactions are every roster like and comment, the same fact as the people', () => {
    const { rows, total } = ownerContentInteractions();
    expect(total).toBe(3940);
    expect(rows).toHaveLength(832);
    expect(rows.filter((row) => row.action === 'like')).toHaveLength(664);
    for (const [i, row] of rows.entries()) {
      const who = row.action === 'like' ? 'likes' : 'comments';
      const person = ownerContentPeople(row.itemId, who).people.find((p) => p.id === row.person.id);
      expect(person?.when, `${row.person.id} ${row.itemId}`).toEqual(row.when);
      const before = rows[i - 1];
      if (before) expect(before.when.daysAgo).toBeLessThanOrEqual(row.when.daysAgo);
    }
  });
});

function sumOf<T extends Record<K, number>, K extends string>(rows: readonly T[], key: K): number {
  return rows.reduce((total, row) => total + row[key], 0);
}

describe("each publication's detail (D-06, D-08)", () => {
  const { engagement, events } = tenantOwnerPanel;
  const ALL_EVENTS = [...events.past, ...events.upcoming];
  // A buyer tied to a publication was already a member: the order is the product's add-on offer
  // (quick 261014-dwc D-02).
  const unit = (id: string) => {
    const addon = financeProductOffers(id).find((offer) => offer.kind === 'addon');
    if (!addon) throw new Error(`no add-on offer for ${id}`);
    return addon.priceCents;
  };
  const month = ownerFinanceWindow(0, 29);

  it("has a non-decreasing 48-hour curve under its interactions, and its kind's", () => {
    for (const item of ownerContentItems) {
      const { velocity48h } = ownerContentDetail(item.id);
      expect(velocity48h, item.id).toHaveLength(8);
      for (const [i, value] of velocity48h.entries()) {
        expect(value, item.id).toBeGreaterThanOrEqual(velocity48h[i - 1] ?? 0);
      }
      expect(velocity48h.at(-1) ?? 0, item.id).toBeLessThanOrEqual(item.likes + item.comments);
    }
    for (const kind of CONTENT_KIND_ORDER) {
      const curve = ownerContentKindVelocity(kind);
      expect(curve, kind).toHaveLength(8);
      for (const [i, value] of curve.entries()) {
        expect(value, kind).toBeGreaterThanOrEqual(curve[i - 1] ?? 0);
      }
    }
  });

  it('splits its reach by band within each band', () => {
    for (const item of ownerContentItems) {
      const { reachByBand } = ownerContentDetail(item.id);
      expect(reachByBand.example, item.id).toBe(item.reach.example);
      const values = Object.values(reachByBand.value);
      expect(
        values.reduce((a, b) => a + b, 0),
        item.id,
      ).toBe(item.reach.value);
      for (const band of ENGAGEMENT_BAND_ORDER) {
        expect(reachByBand.value[band], `${item.id} ${band}`).toBeLessThanOrEqual(
          engagement.counts[band],
        );
      }
    }
  });

  it('has a retention curve on videos and taps on stories only, as examples', () => {
    for (const item of ownerContentItems) {
      const { retention, navigation } = ownerContentDetail(item.id);
      if (item.kind === 'video') {
        expect(retention, item.id).toMatchObject({ example: true, reason: 'needs_video_playback' });
        const curve = retention?.value ?? [];
        expect(curve, item.id).toHaveLength(11);
        expect(curve[0], item.id).toBe(100);
        for (const [i, value] of curve.entries()) {
          expect(value, item.id).toBeLessThanOrEqual(curve[i - 1] ?? 100);
        }
      } else {
        expect(retention, item.id).toBeNull();
      }
      if (item.kind === 'story') {
        expect(navigation, item.id).toMatchObject({ example: true, reason: 'needs_story_taps' });
      } else {
        expect(navigation, item.id).toBeNull();
      }
    }
    const average = ownerContentKindRetention();
    expect(average).toHaveLength(11);
    expect(average[0]).toBe(100);
  });

  it('keeps what only the app knows coherent with the panel', () => {
    let vitrine = 0;
    for (const item of ownerContentItems) {
      const detail = ownerContentDetail(item.id);
      expect(detail.reactivated, item.id).toBeLessThanOrEqual(item.likes + item.comments);
      for (const row of detail.rsvps) {
        const event = ALL_EVENTS.find((entry) => entry.id === row.eventId);
        expect(event, `${item.id} ${row.eventId}`).toBeDefined();
        expect(row.members, item.id).toBeLessThanOrEqual(event?.confirmed ?? 0);
      }
      expect(detail.orders.count, item.id).toBeLessThanOrEqual(month.secondary.orders);
      const cents = detail.orders.products.reduce(
        (sum, row) => sum + row.count * unit(row.productId),
        0,
      );
      expect(detail.orders.cents, item.id).toBe(cents);
      expect(
        detail.orders.products.reduce((sum, row) => sum + row.count, 0),
        item.id,
      ).toBe(detail.orders.count);
      if (detail.vitrine) {
        expect(item.communityId, item.id).toBe('c-vip');
        vitrine += detail.vitrine.subscriptions;
      }
    }
    expect(vitrine).toBeLessThanOrEqual(month.byProduct.s2?.orders ?? 0);
    expect(month.byProduct.s2?.orders).toBe(18);
  });

  it('pins the publications the screens quote', () => {
    expect(ownerContentDetail('op-11')).toMatchObject({
      reactivated: 7,
      orders: { count: 6, cents: 50200 },
      rsvps: [{ eventId: 'u2', members: 21 }],
    });
    expect(ownerContentDetail('op-15')).toMatchObject({
      vitrine: { subscriptions: 6 },
      orders: { count: 6, cents: 118200 },
    });
    expect(ownerContentDetail('op-19').orders.count).toBe(3);
    expect(ownerContentDetail('op-22').orders.count).toBe(0);
    const top = [...posts]
      .filter((item) => item.kind === 'video')
      .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))[0];
    expect(top?.id).toBe('op-41');
    expect(ownerContentDetail(top?.id ?? '')).toMatchObject({
      reactivated: 14,
      orders: { count: 9, cents: 121600 },
    });
  });

  it('marks the oldest roster comments unanswered, first in the list', () => {
    for (const item of ownerContentItems) {
      const { people } = ownerContentPeople(item.id, 'comments');
      const unanswered = item.comments - item.commentMeta.answered;
      const expected = Math.min(unanswered, people.length);
      const open = people.filter((person) => person.answered === false);
      expect(open, item.id).toHaveLength(expected);
      expect(
        people.slice(0, expected).every((p) => p.answered === false),
        item.id,
      ).toBe(true);
      const oldestAnswered = Math.max(
        -1,
        ...people.filter((p) => p.answered).map((p) => p.when.daysAgo),
      );
      for (const person of open) {
        expect(person.when.daysAgo, item.id).toBeGreaterThanOrEqual(oldestAnswered);
        expect((person.when.daysAgo - 1) * 24, item.id).toBeLessThanOrEqual(
          item.commentMeta.oldestUnansweredHours ?? 0,
        );
      }
    }
    const op12 = ownerContentPeople('op-12', 'comments').people;
    expect(op12[0]?.answered).toBe(false);
  });
});

describe('every people list (quick 261013-uoi)', () => {
  it('holds at least one person when its number is above 0', () => {
    for (const item of ownerContentItems) {
      for (const who of ['likes', 'comments', 'saves', 'shares'] as const) {
        if (who === 'saves' && item.saves === null) continue;
        const { people, total } = ownerContentPeople(item.id, who);
        if (total > 0) expect(people.length, `${item.id} ${who}`).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it('never holds more roster commenters than min(comments, 10)', () => {
    for (const item of posts) {
      const { people } = ownerContentPeople(item.id, 'comments');
      expect(people.length, item.id).toBeLessThanOrEqual(Math.min(item.comments, 10));
    }
  });
});

describe('momentHoursAgo (quick 261013-uoi C-3)', () => {
  it('turns a wait in hours into the day and clock reading counted from 23:00 of today', () => {
    expect(PREVIEW_NOW_TIME).toBe('23:00');
    expect(momentHoursAgo(3)).toEqual({ daysAgo: 0, time: '20:00' });
    expect(momentHoursAgo(9)).toEqual({ daysAgo: 0, time: '14:00' });
    expect(momentHoursAgo(18)).toEqual({ daysAgo: 0, time: '05:00' });
    expect(momentHoursAgo(60)).toEqual({ daysAgo: 2, time: '11:00' });
    expect(momentHoursAgo(110)).toEqual({ daysAgo: 4, time: '09:00' });
    expect(momentHoursAgo(192)).toEqual({ daysAgo: 8, time: '23:00' });
    expect(momentHoursAgo(250)).toEqual({ daysAgo: 10, time: '13:00' });
  });

  it('keeps "há N dias" in whole days', () => {
    for (let hours = 0; hours <= 300; hours += 1) {
      expect(momentHoursAgo(hours).daysAgo, String(hours)).toBe(Math.floor(hours / 24));
    }
  });

  it('puts op-04, op-02 and op-03 today', () => {
    expect(ownerContentUnanswered('op-04')[0]?.person.when).toEqual({ daysAgo: 0, time: '14:00' });
    expect(ownerContentUnanswered('op-02')[0]?.person.when).toEqual({ daysAgo: 0, time: '20:00' });
    expect(ownerContentUnanswered('op-03')[0]?.person.when).toEqual({ daysAgo: 0, time: '05:00' });
  });
});

describe('unanswered comments (quick 261013-orf E-02)', () => {
  const open = ownerContentItems.filter((item) => item.comments > item.commentMeta.answered);

  it('are the item’s unanswered commenters, oldest first, each with a distinct text', () => {
    expect(open.map((item) => item.id).sort()).toEqual(
      ['op-02', 'op-03', 'op-04', 'op-08', 'op-12', 'op-19', 'op-24'].sort(),
    );
    for (const item of open) {
      const rows = ownerContentUnanswered(item.id);
      expect(rows, item.id).toHaveLength(item.comments - item.commentMeta.answered);
      const commenters = ownerContentPeople(item.id, 'comments').people;
      for (const [i, row] of rows.entries()) {
        const person = commenters.find((p) => p.id === row.person.id);
        expect(person?.answered, `${item.id} ${row.person.id}`).toBe(false);
        expect(row.text.trim().length, item.id).toBeGreaterThan(0);
        expect(row.text.length, item.id).toBeLessThanOrEqual(160);
        const before = rows[i - 1];
        if (before) {
          expect(before.person.when.daysAgo, item.id).toBeGreaterThanOrEqual(
            row.person.when.daysAgo,
          );
        }
      }
      expect(new Set(rows.map((row) => row.text)).size, item.id).toBe(rows.length);
      // Quick 261013-uoi C-3: the oldest one waited exactly the recorded hours, and no comment of
      // the post is older.
      const oldest = momentHoursAgo(item.commentMeta.oldestUnansweredHours ?? 0);
      expect(rows[0]?.person.when, item.id).toEqual(oldest);
      for (const person of commenters) {
        const older =
          person.when.daysAgo > oldest.daysAgo ||
          (person.when.daysAgo === oldest.daysAgo &&
            (person.when.time ?? '') < (oldest.time ?? ''));
        expect(older, `${item.id} ${person.id}`).toBe(false);
      }
    }
  });

  it('are none for an item whose comments are all answered', () => {
    expect(ownerContentUnanswered('op-11')).toEqual([]);
    expect(ownerContentUnanswered('os-05')).toEqual([]);
  });
});

describe('reach without inativos (quick 261013-orf E-03.4)', () => {
  it('never reaches inativos and keeps em risco at 10% or less', () => {
    for (const item of ownerContentItems) {
      const { value } = ownerContentDetail(item.id).reachByBand;
      expect(value.inactive, item.id).toBe(0);
      expect(value.at_risk, item.id).toBeLessThanOrEqual(item.reach.value * 0.1);
    }
  });

  it('fits a post in the active members and a slice of em risco, views never below reach', () => {
    for (const item of posts) {
      expect(item.reach.value, item.id).toBeLessThanOrEqual(530);
      expect(item.views.value, item.id).toBeGreaterThanOrEqual(item.reach.value);
    }
    expect(sum(posts, (item) => item.reach.value)).toBe(23488);
    expect(reach.value.perPost).toBe(385);
  });
});
