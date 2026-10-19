import {
  CONTENT_WEEKDAYS,
  type ContentKindId,
  HEATMAP_SLOTS,
  type OwnerContentDetailReady,
  type OwnerContentReady,
} from '@rede-social/module-dashboard/contracts';

/*
 * Contract-shaped Conteúdo answers for the web's component tests (08.7-07): what
 * `GET /v1/dashboard/owner/content` and its detail answer, built by hand so a test states the very
 * numbers it asserts. Test-only: no runtime file imports it.
 */

type Item = OwnerContentReady['items'][number];
type PostKind = Exclude<ContentKindId, 'story'>;

/** A ready snapshot of yesterday, built at 03:30Z today. */
export function contentSnapshot(now = Date.now()): OwnerContentReady['snapshot'] {
  const day = new Date(now - 86_400_000 - 3 * 3_600_000).toISOString().slice(0, 10);
  const today = new Date(now - 3 * 3_600_000).toISOString().slice(0, 10);
  return {
    day,
    builtAt: `${today}T03:30:00Z`,
    windows: {
      day,
      from30: day,
      prev30From: day,
      from7: day,
      prev7From: day,
      from30At: `${day}T03:00:00Z`,
      prev30At: `${day}T03:00:00Z`,
      untilAt: `${today}T03:00:00Z`,
    },
  };
}

/** A uuid whose last block carries `n` (stable and readable in assertions). */
export function contentId(n: number, prefix = '00000000-0000-4000-8000'): string {
  return `${prefix}-${String(n).padStart(12, '0')}`;
}

/** A feed post of the window. */
export function contentPost(
  n: number,
  patch: Partial<Omit<Item, 'kind'>> & { kind?: PostKind } = {},
): Item {
  return {
    id: contentId(n),
    kind: 'photo',
    communityId: null,
    createdAt: '2026-10-08T18:00:00Z',
    excerpt: `Publicação ${n}`,
    coverAssetId: null,
    media: { width: 1080, height: 1080 },
    durationSeconds: null,
    cards: 1,
    likes: 0,
    comments: 0,
    shares: { measured: false, reason: 'needs_shares' },
    commentMeta: {
      answered: 0,
      unanswered: 0,
      oldestUnansweredHours: null,
      firstReplyMedianMinutes: null,
    },
    views: { measured: false, reason: 'needs_post_views' },
    reach: { measured: false, reason: 'needs_post_views' },
    saves: { measured: false, reason: 'needs_saves' },
    ...patch,
  } as Item;
}

/** A story of the window: views and reach are its unique member viewers. */
export function contentStory(n: number, patch: Partial<Item> & { viewers?: number } = {}): Item {
  const { viewers = 0, ...rest } = patch;
  return {
    id: contentId(n, '00000000-0000-4000-9000'),
    kind: 'story',
    communityId: null,
    createdAt: '2026-10-09T12:00:00Z',
    excerpt: `Story ${n}`,
    coverAssetId: null,
    media: { width: 1080, height: 1920 },
    durationSeconds: null,
    cards: null,
    likes: 0,
    comments: 0,
    shares: { measured: false, reason: 'needs_shares' },
    views: { measured: true, value: viewers },
    reach: { measured: true, value: viewers },
    saves: null,
    ...rest,
  } as Item;
}

/** The 28 heatmap cells, every one empty, then `cells` written over them. */
export function contentHeatmap(
  cells: { weekday: (typeof CONTENT_WEEKDAYS)[number]; fromHour: number; posts: number; interactions: number }[] = [],
): NonNullable<OwnerContentReady['heatmap']> {
  return CONTENT_WEEKDAYS.flatMap((weekday) =>
    HEATMAP_SLOTS.map(([fromHour, toHour]) => {
      const cell = cells.find((row) => row.weekday === weekday && row.fromHour === fromHour);
      return {
        weekday,
        fromHour,
        toHour,
        posts: cell?.posts ?? 0,
        interactions: cell?.interactions ?? 0,
      };
    }),
  );
}

const ZEROS12 = Array.from({ length: 12 }, () => 0);

/** A ready Conteúdo answer with every module on, holding `items`. */
export function contentAnswer(
  items: Item[] = [],
  patch: Partial<OwnerContentReady> = {},
): OwnerContentReady {
  const kinds: ContentKindId[] = ['video', 'photo', 'carousel', 'text', 'link', 'story'];
  const posts = items.filter((item) => item.kind !== 'story');
  const sum = (rows: Item[], pick: (item: Item) => number) =>
    rows.reduce((total, item) => total + pick(item), 0);
  return {
    state: 'ready',
    snapshot: contentSnapshot(),
    kinds,
    items,
    byKind: kinds.map((kind) => {
      const ofKind = items.filter((item) => item.kind === kind);
      return {
        kind,
        items: ofKind.length,
        likes: sum(ofKind, (item) => item.likes),
        comments: sum(ofKind, (item) => item.comments),
      };
    }),
    kindMetrics: {
      video: { measured: false, reason: 'needs_video_playback' },
      photo: { measured: false, reason: 'needs_saves' },
      carousel: { measured: false, reason: 'needs_gallery_swipes' },
      link: { measured: false, reason: 'needs_link_clicks' },
      story: { measured: false, reason: 'needs_story_taps' },
    },
    kpis: {
      posts: { current: posts.length, previous: 0 },
      interactions: {
        current: sum(posts, (item) => item.likes + item.comments),
        previous: 0,
      },
      members: { current: 0, previous: 0 },
      rate: { measured: false, reason: 'needs_post_views' },
      views: { measured: false, reason: 'needs_post_views' },
      reach: { measured: false, reason: 'needs_post_views' },
    },
    interactorsByBand: {
      counts: { new: 0, superfan: 0, engaged: 0, occasional: 0, at_risk: 0, inactive: 0 },
      newActivated: 0,
    },
    weeklyPerPost: {
      interactions: ZEROS12,
      posts: ZEROS12,
      previousInteractions: ZEROS12,
      previousPosts: ZEROS12,
    },
    heatmap: contentHeatmap(),
    byCommunity: [],
    ...patch,
  };
}

/** A ready detail of `item`: a flat curve, nothing associated. */
export function contentDetail(
  item: Item,
  patch: Partial<OwnerContentDetailReady> = {},
): OwnerContentDetailReady {
  const story = item.kind === 'story';
  return {
    state: 'ready',
    snapshot: contentSnapshot(),
    item,
    velocity48h: [0, 0, 0, 0, 0, 0, 0, 0],
    reachByBand: story ? [] : { measured: false, reason: 'needs_post_views' },
    retention: item.kind === 'video' ? { measured: false, reason: 'needs_video_playback' } : null,
    navigation: story ? { measured: false, reason: 'needs_story_taps' } : null,
    reactivated: { belowFloor: false, value: 0 },
    rsvps: [],
    orders: { belowFloor: false, count: 0, cents: 0 },
    vitrine: null,
    ...patch,
  };
}
