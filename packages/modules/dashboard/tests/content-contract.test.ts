import { describe, expect, it } from 'vitest';
import {
  CONTENT_KINDS,
  CONTENT_VELOCITY_HOURS,
  contentPayloadSchema,
  HEATMAP_SLOTS,
  ownerContentAnswerSchema,
} from '../contracts/content';

/**
 * The owner's Conteúdo contract (08.7-06, D-455, D-458, D-462, UI-D-470, UI-D-473, UI-D-484,
 * UI-D-488, INSIGHT-10): what the stored `payload.content` and the area answer may and may not
 * carry. No database.
 */

const POST = '11111111-1111-4111-8111-111111111111';
const STORY = '22222222-2222-4222-8222-222222222222';
const COMMUNITY = '33333333-3333-4333-8333-333333333333';
const COVER = '44444444-4444-4444-8444-444444444444';

const SNAPSHOT = {
  day: '2026-10-17',
  builtAt: '2026-10-18T03:30:00.000Z',
  windows: {
    day: '2026-10-17',
    from30: '2026-09-18',
    prev30From: '2026-08-19',
    from7: '2026-10-11',
    prev7From: '2026-10-04',
    from30At: '2026-09-18T03:00:00Z',
    prev30At: '2026-08-19T03:00:00Z',
    untilAt: '2026-10-18T03:00:00Z',
  },
};

const NM = (reason: string) => ({ measured: false, reason });

const POST_ITEM = {
  id: POST,
  kind: 'carousel',
  communityId: COMMUNITY,
  createdAt: '2026-10-10T12:00:00.000000Z',
  excerpt: 'Treino de sábado no parque',
  coverAssetId: COVER,
  media: { width: 1080, height: 1350 },
  durationSeconds: null,
  cards: 3,
  likes: 4,
  comments: 2,
  commentMeta: {
    answered: 1,
    unanswered: 1,
    oldestUnansweredHours: 30,
    firstReplyMedianMinutes: 12,
  },
  views: NM('needs_post_views'),
  reach: NM('needs_post_views'),
  saves: NM('needs_saves'),
  shares: NM('needs_shares'),
};

const STORY_ITEM = {
  id: STORY,
  kind: 'story',
  communityId: null,
  createdAt: '2026-10-12T22:00:00.000000Z',
  excerpt: '',
  coverAssetId: COVER,
  media: { width: 1080, height: 1920 },
  durationSeconds: null,
  cards: null,
  likes: 1,
  comments: 3,
  views: { measured: true, value: 12 },
  reach: { measured: true, value: 12 },
  saves: null,
  shares: NM('needs_shares'),
};

const HEATMAP = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).flatMap((weekday) =>
  HEATMAP_SLOTS.map(([fromHour, toHour]) => ({
    weekday,
    fromHour,
    toHour,
    posts: 0,
    interactions: 0,
  })),
);
const TWELVE = Array.from({ length: 12 }, () => 0);
const ZERO_BANDS = { new: 0, superfan: 0, engaged: 0, occasional: 0, at_risk: 0, inactive: 0 };

const READY = {
  state: 'ready',
  snapshot: SNAPSHOT,
  kinds: [...CONTENT_KINDS],
  items: [STORY_ITEM, POST_ITEM],
  byKind: CONTENT_KINDS.map((kind) => ({ kind, items: 0, likes: 0, comments: 0 })),
  kindMetrics: {
    video: NM('needs_video_playback'),
    photo: NM('needs_saves'),
    carousel: NM('needs_gallery_swipes'),
    link: NM('needs_link_clicks'),
    story: NM('needs_story_taps'),
  },
  kpis: {
    posts: { current: 1, previous: 0 },
    interactions: { current: 6, previous: 0 },
    members: { current: 3, previous: 0 },
    rate: NM('needs_post_views'),
    views: NM('needs_post_views'),
    reach: NM('needs_post_views'),
  },
  interactorsByBand: { ...ZERO_BANDS, engaged: 3 },
  weeklyPerPost: {
    interactions: TWELVE,
    posts: TWELVE,
    previousInteractions: TWELVE,
    previousPosts: TWELVE,
  },
  heatmap: HEATMAP,
  byCommunity: [{ communityId: null, name: null, posts: 0, interactions: 0 }],
};

const PAYLOAD_ITEM = {
  id: POST,
  kind: 'text',
  communityId: null,
  createdAt: '2026-10-10T12:00:00.000000Z',
  likes: 4,
  comments: 2,
  commentMeta: {
    answered: 1,
    unanswered: 1,
    oldestUnansweredHours: 30,
    firstReplyMedianMinutes: 12,
  },
  views: null,
  reachByBand: null,
  velocity48h: [1, 2, 3, 4, 5, 6, 6, 6],
  reactivated: 0,
  rsvps: [],
  orders: { count: 0, cents: 0 },
  vitrine: null,
};

const EMPTY_PAYLOAD = {
  items: [],
  kpis: {
    posts: { current: 0, previous: 0 },
    interactions: { current: 0, previous: 0 },
    members: { current: 0, previous: 0 },
  },
  interactorsByBand: ZERO_BANDS,
  weeklyPerPost: {
    interactions: TWELVE,
    posts: TWELVE,
    previousInteractions: TWELVE,
    previousPosts: TWELVE,
  },
  heatmap: HEATMAP,
  byCommunity: [],
};

describe('the content constants (UI-D-488)', () => {
  it('lists the six kinds in Por tipo order', () => {
    expect([...CONTENT_KINDS]).toEqual(['video', 'photo', 'carousel', 'text', 'link', 'story']);
  });

  it('cuts the day into four 6-hour slots that cover all 24 hours with no gap', () => {
    expect(HEATMAP_SLOTS.map((slot) => [...slot])).toEqual([
      [0, 6],
      [6, 12],
      [12, 18],
      [18, 24],
    ]);
  });

  it('samples the 48-hour curve every 6 hours', () => {
    expect([...CONTENT_VELOCITY_HOURS]).toEqual([6, 12, 18, 24, 30, 36, 42, 48]);
  });
});

describe('contentPayloadSchema (PR-1: ids and numbers only)', () => {
  it('accepts the EP-29 empty payload: no item, zeros everywhere, 28 cells', () => {
    expect(contentPayloadSchema.safeParse(EMPTY_PAYLOAD).success).toBe(true);
  });

  it('accepts a stored item with its raw associations', () => {
    const parsed = contentPayloadSchema.safeParse({ ...EMPTY_PAYLOAD, items: [PAYLOAD_ITEM] });
    expect(parsed.success).toBe(true);
  });

  it('refuses a stored item carrying a caption (labels are joined live)', () => {
    const parsed = contentPayloadSchema.safeParse({
      ...EMPTY_PAYLOAD,
      items: [{ ...PAYLOAD_ITEM, caption: 'Treino' }],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses a heatmap that does not hold the 28 cells', () => {
    const parsed = contentPayloadSchema.safeParse({
      ...EMPTY_PAYLOAD,
      heatmap: HEATMAP.slice(1),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('ownerContentAnswerSchema (D-455, D-458)', () => {
  it('accepts preparing', () => {
    expect(ownerContentAnswerSchema.safeParse({ state: 'preparing' }).success).toBe(true);
  });

  it('accepts a ready answer with a post and a story whose views are measured', () => {
    const parsed = ownerContentAnswerSchema.safeParse(READY);
    expect(parsed.success).toBe(true);
  });

  it('refuses a post item whose views is a number', () => {
    const parsed = ownerContentAnswerSchema.safeParse({
      ...READY,
      items: [{ ...POST_ITEM, views: 120 }],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses a post item whose views claim to be measured', () => {
    const parsed = ownerContentAnswerSchema.safeParse({
      ...READY,
      items: [{ ...POST_ITEM, views: { measured: true, value: 120 } }],
    });
    expect(parsed.success).toBe(false);
  });

  it('refuses an example value anywhere (D-455: no example branch)', () => {
    const exampleSaves = {
      ...POST_ITEM,
      saves: { example: true, reason: 'needs_saves', value: 3 },
    };
    expect(ownerContentAnswerSchema.safeParse({ ...READY, items: [exampleSaves] }).success).toBe(
      false,
    );
    expect(
      ownerContentAnswerSchema.safeParse({ ...READY, items: [{ ...STORY_ITEM, example: true }] })
        .success,
    ).toBe(false);
    expect(
      ownerContentAnswerSchema.safeParse({
        ...READY,
        kpis: { ...READY.kpis, rate: { example: true, reason: 'needs_post_views', value: 4 } },
      }).success,
    ).toBe(false);
  });

  it('refuses a story item with a commentMeta (UI-D-489 b: story replies are flat)', () => {
    const parsed = ownerContentAnswerSchema.safeParse({
      ...READY,
      items: [{ ...STORY_ITEM, commentMeta: POST_ITEM.commentMeta }],
    });
    expect(parsed.success).toBe(false);
  });

  it('accepts the stories-only answer: no post part at all (UI-D-473)', () => {
    const { kpis, interactorsByBand, weeklyPerPost, heatmap, byCommunity, ...rest } = READY;
    const parsed = ownerContentAnswerSchema.safeParse({
      ...rest,
      kinds: ['story'],
      items: [STORY_ITEM],
      byKind: [{ kind: 'story', items: 1, likes: 1, comments: 3 }],
      kindMetrics: { story: NM('needs_story_taps') },
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a kind metric with the wrong reason', () => {
    const parsed = ownerContentAnswerSchema.safeParse({
      ...READY,
      kindMetrics: { ...READY.kindMetrics, video: NM('needs_saves') },
    });
    expect(parsed.success).toBe(false);
  });
});
