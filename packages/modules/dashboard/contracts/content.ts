import { z } from 'zod';
import { bandCountsSchema } from './members';
import { preparingSchema, snapshotMetaSchema } from './shared';

/**
 * The owner's "Conteúdo" contract (08.7-06, D-455, D-458, D-462, UI-D-470, UI-D-473, UI-D-484,
 * UI-D-488, UI-D-489 b, INSIGHT-10): every live post and story published in the snapshot's 30 days
 * (Window30 = local days D-29..D), with the numbers the app really records.
 *
 * - **Who counts (UI-D-484).** Likes and LIVE comments by role-`member` authors only, counted up to
 *   the snapshot's `untilAt` (never `like_count` / `comment_count`, which include staff and today).
 * - **Kinds.** A post with `media_kind = 'video'` is a video; a gallery with one image a photo, with
 *   two or more a carousel; a post with no media a link when it has a link preview, else text; a
 *   `stories` row a story.
 * - **Not measured (D-455, D-458).** A post's views and reach, saves and shares, the KPIs rate,
 *   views and reach, and each kind's own metric (video % watched, carousel last card, link clicks,
 *   story taps, photo saves per post) are `{ measured: false, reason }`, never a number. The text
 *   kind's share of comments is real: the web computes it from the items.
 * - **Story views (PR-5).** A story's views and reach are measured TOTALS from `story_views` (unique
 *   member viewers). No field, list or route says which member saw which story.
 * - **Ids and numbers only in the stored payload (PR-1).** Captions, covers and media sizes are
 *   joined live by the service; associations and a story's reach by band are raw in the payload and
 *   leave the API only through the detail, floored (D-462).
 *
 * Every object is `.strict()`, so a key nobody declared (an `example`, a caption in the payload)
 * fails the parse instead of travelling.
 */

const count = z.number().int().nonnegative();
const instant = z.iso.datetime();
const twelveWeeks = z.array(count).length(12);

/** The six kinds in the order Por tipo shows them. */
export const CONTENT_KINDS = ['video', 'photo', 'carousel', 'text', 'link', 'story'] as const;
export const contentKindSchema = z.enum(CONTENT_KINDS);
export type ContentKindId = z.infer<typeof contentKindSchema>;

/** The kinds a feed post can be (everything but `story`). */
export const CONTENT_POST_KINDS = ['video', 'photo', 'carousel', 'text', 'link'] as const;
export type ContentPostKindId = (typeof CONTENT_POST_KINDS)[number];

/** Tenant-local weekdays, Monday first (the heatmap's rows). */
export const CONTENT_WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * UI-D-488: four 6-hour slots, `[fromHour, toHour)` in tenant-local hours, that cover the whole day
 * (the prototype's gapped slots dropped a 15:00 post). Every live post of the window lands in
 * exactly one cell, so the 28 cells add up to the item totals.
 */
export const HEATMAP_SLOTS = [
  [0, 6],
  [6, 12],
  [12, 18],
  [18, 24],
] as const;

/** The 48-hour curve is cumulative member likes + comments at these hours after publication. */
export const CONTENT_VELOCITY_HOURS = [6, 12, 18, 24, 30, 36, 42, 48] as const;

/** A metric the app does not collect yet, pinned to its one reason (D-455). */
const notMeasuredAs = <R extends string>(reason: R) =>
  z.object({ measured: z.literal(false), reason: z.literal(reason) }).strict();

const measuredCount = z.object({ measured: z.literal(true), value: count }).strict();

/** Current window and the 30 days before it, as raw integers (the web derives the change). */
const kpiPairSchema = z.object({ current: count, previous: count }).strict();

/**
 * A post's comment thread as the team sees it (posts only: story replies are flat, UI-D-489 b).
 * A ROOT comment by a member is answered when a live reply by a current `admin_tenant` or
 * `support_tenant` exists. `oldestUnansweredHours` is the floor of the hours the oldest unanswered
 * one had waited at build time (null when none waits); `firstReplyMedianMinutes` the median minutes
 * to the team's first reply, rounded to the nearest minute (null when nothing was answered).
 */
export const contentCommentMetaSchema = z
  .object({
    answered: count,
    unanswered: count,
    oldestUnansweredHours: count.nullable(),
    firstReplyMedianMinutes: count.nullable(),
  })
  .strict();
export type ContentCommentMeta = z.infer<typeof contentCommentMetaSchema>;

// ── the stored payload (`dashboard_snapshots.payload.content`) ─────────────────────────────────

/**
 * One publication as `app.dashboard_area_content` stores it: ids and numbers only. `views` and
 * `reachByBand` are a story's (null on a post): unique member viewers up to `untilAt` and their
 * today's band. The associations are the members' own actions within 7 days after their FIRST like
 * or comment on the item (associations, never causes): `reactivated` interactors whose previous
 * counted action was 30 or more days before (or who had none), `rsvps` "vou" per event, paid
 * `orders` (count and cents), and `vitrine` (posts of an exclusive community only, else null).
 */
export const contentPayloadItemSchema = z
  .object({
    id: z.uuid(),
    kind: contentKindSchema,
    communityId: z.uuid().nullable(),
    createdAt: instant,
    likes: count,
    comments: count,
    commentMeta: contentCommentMetaSchema.nullable(),
    views: count.nullable(),
    reachByBand: bandCountsSchema.nullable(),
    velocity48h: z.array(count).length(CONTENT_VELOCITY_HOURS.length),
    reactivated: count,
    rsvps: z.array(z.object({ eventId: z.uuid(), members: count }).strict()),
    orders: z.object({ count, cents: count }).strict(),
    vitrine: count.nullable(),
  })
  .strict();
export type ContentPayloadItem = z.infer<typeof contentPayloadItemSchema>;

/** One heatmap cell: the posts published in it and their member likes + comments. */
export const contentHeatCellSchema = z
  .object({
    weekday: z.enum(CONTENT_WEEKDAYS),
    fromHour: z.number().int().min(0).max(24),
    toHour: z.number().int().min(0).max(24),
    posts: count,
    interactions: count,
  })
  .strict();
export type ContentHeatCell = z.infer<typeof contentHeatCellSchema>;

/** Posts and their member likes + comments per community, the tenant-wide feed as `null`. */
export const contentCommunityRowSchema = z
  .object({ communityId: z.uuid().nullable(), posts: count, interactions: count })
  .strict();

/**
 * A `byCommunity` row of the answer: the stored numbers with the community's name read live (null
 * for the tenant-wide feed); a community deleted since the build is dropped.
 */
export const contentCommunityAnswerRowSchema = z
  .object({
    communityId: z.uuid().nullable(),
    name: z.string().nullable(),
    posts: count,
    interactions: count,
  })
  .strict();

/**
 * Raw sums per 7-day block of the post's publication day, oldest first: `interactions` / `posts`
 * the 12 blocks ending D, `previous…` the 12 before. The web divides (a block with no post has no
 * per-post point, never 0).
 */
export const contentWeeklyPerPostSchema = z
  .object({
    interactions: twelveWeeks,
    posts: twelveWeeks,
    previousInteractions: twelveWeeks,
    previousPosts: twelveWeeks,
  })
  .strict();

/**
 * `payload.content`. `kpis` are posts-only (the feed's numbers): `posts` live posts published in the
 * window, `interactions` their member likes + live comments up to the window's end, `members` the
 * distinct members behind them; `previous` the same over D-59..D-30, counted up to its own end.
 * `interactorsByBand` is today's band of those members (not floored: the admin lists who liked and
 * commented, UI-D-486).
 */
export const contentPayloadSchema = z
  .object({
    items: z.array(contentPayloadItemSchema),
    kpis: z
      .object({ posts: kpiPairSchema, interactions: kpiPairSchema, members: kpiPairSchema })
      .strict(),
    interactorsByBand: bandCountsSchema,
    weeklyPerPost: contentWeeklyPerPostSchema,
    heatmap: z.array(contentHeatCellSchema).length(CONTENT_WEEKDAYS.length * HEATMAP_SLOTS.length),
    byCommunity: z.array(contentCommunityRowSchema),
  })
  .strict();
export type ContentPayload = z.infer<typeof contentPayloadSchema>;

// ── the area answer (`GET /v1/dashboard/owner/content`) ────────────────────────────────────────

/** A cover's own size; null when unknown or for text and link. */
const mediaSizeSchema = z
  .object({ width: z.number().int().positive(), height: z.number().int().positive() })
  .strict();

/**
 * What every publication carries, joined live: the caption's 120-character excerpt cut at a word
 * boundary, the cover asset (a post's first image or video, a story's media), its size, a video's
 * length and a gallery's image count.
 */
const contentItemBase = {
  id: z.uuid(),
  communityId: z.uuid().nullable(),
  createdAt: instant,
  excerpt: z.string(),
  coverAssetId: z.uuid().nullable(),
  media: mediaSizeSchema.nullable(),
  durationSeconds: count.nullable(),
  cards: count.nullable(),
  likes: count,
  comments: count,
  shares: notMeasuredAs('needs_shares'),
};

/** A feed post: views, reach and saves are not measured (D-455); its thread meta is real. */
export const contentPostItemSchema = z
  .object({
    ...contentItemBase,
    kind: z.enum(CONTENT_POST_KINDS),
    commentMeta: contentCommentMetaSchema,
    views: notMeasuredAs('needs_post_views'),
    reach: notMeasuredAs('needs_post_views'),
    saves: notMeasuredAs('needs_saves'),
  })
  .strict();

/**
 * A story: its views and reach are measured totals of unique member viewers (D-458, PR-5); it has
 * comments only (no thread meta, UI-D-489 b) and cannot be saved.
 */
export const contentStoryItemSchema = z
  .object({
    ...contentItemBase,
    kind: z.literal('story'),
    views: measuredCount,
    reach: measuredCount,
    saves: z.null(),
  })
  .strict();

export const contentItemSchema = z.union([contentPostItemSchema, contentStoryItemSchema]);
export type ContentItemAnswer = z.infer<typeof contentItemSchema>;

/** Each kind's own metric that no count gives: none is collected yet (D-455). */
export const contentKindMetricsSchema = z
  .object({
    video: notMeasuredAs('needs_video_playback').optional(),
    photo: notMeasuredAs('needs_saves').optional(),
    carousel: notMeasuredAs('needs_gallery_swipes').optional(),
    link: notMeasuredAs('needs_link_clicks').optional(),
    story: notMeasuredAs('needs_story_taps').optional(),
  })
  .strict();

/** Per shown kind: how many publications and their member likes and comments (zeros when none). */
export const contentKindTotalsSchema = z
  .object({ kind: contentKindSchema, items: count, likes: count, comments: count })
  .strict();

/**
 * The ready Conteúdo area. `kinds` are the kinds shown (UI-D-473: with `feed` off only `story`,
 * with `stories` off the five post kinds); `items` newest first (`createdAt desc, id desc`).
 * The post part (`kpis`, `interactorsByBand`, `weeklyPerPost`, `heatmap`, `byCommunity`) is
 * present only while `feed` is on, `byCommunity` only while `communities` is on too. No
 * association or reach number travels here: those belong to the detail, floored.
 */
export const ownerContentReadySchema = z
  .object({
    state: z.literal('ready'),
    snapshot: snapshotMetaSchema,
    kinds: z.array(contentKindSchema),
    items: z.array(contentItemSchema),
    byKind: z.array(contentKindTotalsSchema),
    kindMetrics: contentKindMetricsSchema,
    kpis: z
      .object({
        posts: kpiPairSchema,
        interactions: kpiPairSchema,
        members: kpiPairSchema,
        rate: notMeasuredAs('needs_post_views'),
        views: notMeasuredAs('needs_post_views'),
        reach: notMeasuredAs('needs_post_views'),
      })
      .strict()
      .optional(),
    interactorsByBand: bandCountsSchema.optional(),
    weeklyPerPost: contentWeeklyPerPostSchema.optional(),
    heatmap: z.array(contentHeatCellSchema).optional(),
    byCommunity: z.array(contentCommunityAnswerRowSchema).optional(),
  })
  .strict();
export type OwnerContentReady = z.infer<typeof ownerContentReadySchema>;

export const ownerContentAnswerSchema = z.discriminatedUnion('state', [
  ownerContentReadySchema,
  preparingSchema,
]);
export type OwnerContentAnswer = z.infer<typeof ownerContentAnswerSchema>;
