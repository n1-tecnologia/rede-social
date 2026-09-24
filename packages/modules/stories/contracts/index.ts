import { MEDIA_STATUSES } from '@tria/contracts/media';
import { z } from 'zod';

/**
 * The module's published contract surface (`@tria/module-stories/contracts`). Both the API and the
 * web app import from here — the same Zod schema validates the query in Hono, the body in the route
 * and the page payload in `apps/web/lib/stories.ts`, so there is exactly one definition of what a
 * story is (MOD-01).
 */

/**
 * `STORY_PAGE_SIZE` matches the feed's and the community list's 10. The strip shows one page and
 * almost never needs a second: a tenant broadcasting ten times in 24 h is already at the edge of
 * what the row can carry. The server CLAMPS `limit` to `1..STORY_MAX_PAGE_SIZE`, so a crafted
 * `?limit=100000` cannot ask for an unbounded page (T-05-31).
 */
export const STORY_PAGE_SIZE = 10;
export const STORY_MAX_PAGE_SIZE = 25;

/**
 * The longest cursor this endpoint will look at — the `COMMUNITY_MAX_CURSOR_LENGTH` rule restated.
 * The envelope (`@tria/core/server/paging`) is a base64url JSON object carrying an ISO timestamp and
 * a uuid, so 512 characters is already generous; the bound exists so a megabyte of "cursor" is
 * refused before it is decoded.
 */
export const STORY_MAX_CURSOR_LENGTH = 512;

/**
 * The design team's two numbers, PORTED rather than imported.
 *
 * `reference/frontend-design/` is gitignored and is not a package: importing from it would make the
 * build depend on a directory that does not ship. The VALUES are the contract, so they live here and
 * the viewer (05-06), the schema's docblock, the pgTAP window and the publish copy all cite one
 * source instead of four literals that can drift apart.
 *
 * `STORY_DURATION_MS` is how long ONE story is shown before the pager advances; `STORY_EXPIRY_HOURS`
 * is STORY-03's window and is mirrored by the `expires_at` column default. Changing the window means
 * changing BOTH this constant and a migration — the constant alone would only move the copy.
 */
export const STORY_DURATION_MS = 5000;
export const STORY_EXPIRY_HOURS = 24;

/**
 * The caption cap, measured in **UTF-16 code units at both ends**: the browser `maxLength`, the
 * `{n}/{max}` counter and the `.max()` below all count the same unit, so a caption the composer's
 * counter accepts is never refused by the API and an emoji is never silently cut into a lone
 * surrogate (edge: encoding). The same rule as `FEED_MAX_CAPTION` and `COMMUNITY_MAX_NAME`.
 */
export const STORY_MAX_CAPTION = 300;

/** The media a story may carry, mirrored by `stories_media_kind_chk`. A file is not a story. */
export const STORY_MEDIA_KINDS = ['image', 'video'] as const;
export type StoryMediaKind = (typeof STORY_MEDIA_KINDS)[number];

/**
 * The closed refusal vocabulary a story WRITE can answer with, as `details.story`. The web switches
 * on it exhaustively and maps each to pt-BR copy, exactly as it does for `COMMUNITY_ISSUES`.
 *
 * `media_required` is a publish with no asset id; `media_invalid` is an asset of this tenant that is
 * not a `story` asset (wrong purpose, or a `file`). Both are MACHINE codes — the pt-BR copy lives in
 * the catalog, never here.
 *
 * A miss (unknown asset, another tenant's, soft-deleted) is deliberately NOT in this vocabulary: it
 * is a BARE 404 with no `details` at all, because a per-cause code over an enumerable uuid space
 * would be an existence oracle (D-23, T-05-30).
 *
 * **The DURATION refusal is deliberately absent.** It is the Phase 3 `media` vocabulary's
 * (`duration_too_long`), raised by the worker after ingest, and Phase 5 adds no second copy of it.
 */
export const STORY_ISSUES = ['media_required', 'media_invalid'] as const;
export type StoryIssue = (typeof STORY_ISSUES)[number];

/** The route `defaultHook`'s lookup: a Zod issue whose `message` is in here becomes `details.story`. */
export const STORY_ISSUE_SET: ReadonlySet<string> = new Set(STORY_ISSUES);

/**
 * `GET /v1/stories?limit=&cursor=` and `GET /v1/stories/mine`. `.strict()`: an unknown query key
 * fails loudly (the 03-03 rule).
 *
 * `limit` CLAMPS rather than refuses, for the same reason `communityQuerySchema` does: the strip
 * renders on `/inicio`, the screen every member lands on, and a hand-edited `?limit=` must never be
 * the reason the home screen shows an error. The clamp is what T-05-31 asks for either way — no
 * client value can widen the read.
 */
export const storyQuerySchema = z
  .object({
    cursor: z.string().max(STORY_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .catch(STORY_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), STORY_MAX_PAGE_SIZE))
      .default(STORY_PAGE_SIZE),
  })
  .strict();
export type StoryQuery = z.infer<typeof storyQuerySchema>;

/**
 * One story as the strip and the admin's history project it.
 *
 * `mediaAssetId` carries `mediaVariantWidths` beside it — the ladder `MediaImage` needs for its
 * `srcSet`, hydrated in the SAME statement the story row came from (Pitfall 11). The payload carries
 * an ASSET ID and a ladder, never a URL: `MediaImage` derives `/v1/media/{assetId}/{variant}`
 * itself, so a cached payload can never outlive a signed Storage URL (T-05-27).
 *
 * **`isActive` is computed by the SERVER, from the same `now()` the query ran under** (UI-D-14). A
 * client that derived it would need a clock in render, and two surfaces reading two clocks would
 * disagree about the same story for a few seconds around the boundary.
 *
 * **`mediaStatus` and `mediaFailureReason` ride along** because a story may be published while its
 * video transcodes (D-53's precedent) and may later be REFUSED for duration: the history screen
 * renders the `Processando` / `Recusado` pill from these two fields and the Phase 3 `media` catalog's
 * own reason string. The strip never sees a non-ready story at all — it filters them out — so these
 * fields are always `'ready'` / `null` there, which is exactly the point.
 *
 * `expiresAt` crosses the wire because it IS the ordering key and the cursor is built from it.
 */
export const storySummarySchema = z
  .object({
    id: z.uuid(),
    authorUserId: z.uuid(),
    mediaAssetId: z.uuid(),
    mediaKind: z.enum(STORY_MEDIA_KINDS),
    /** The variant ladder `MediaImage` builds its `srcSet` from (R-06) — never a hand-written list. */
    mediaVariantWidths: z.array(z.number().int()),
    /** The asset's own lifecycle. `'ready'` for every story the strip returns (R-P8). */
    mediaStatus: z.enum(MEDIA_STATUSES),
    /** The Phase 3 machine code behind a `rejected` asset (`duration_too_long`, …); never pt-BR. */
    mediaFailureReason: z.string().nullable(),
    caption: z.string(),
    publishedAt: z.string(),
    expiresAt: z.string(),
    /** `expires_at > now()` evaluated by the SERVER, under the statement's own clock (UI-D-14). */
    isActive: z.boolean(),
    /** The video's measured length once the provider reported it; null for an image. */
    durationSeconds: z.number().int().nullable(),
    /** Trigger-owned (05-07 installs the counters). Always an integer, never clamped. */
    likeCount: z.number().int(),
    commentCount: z.number().int(),
    viewerLiked: z.boolean(),
  })
  .strict();
export type StorySummary = z.infer<typeof storySummarySchema>;

/** One keyset page. `nextCursor` is non-null EXACTLY when another row exists (the over-fetch rule). */
export const storyPageSchema = z
  .object({
    items: z.array(storySummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type StoryPage = z.infer<typeof storyPageSchema>;

/**
 * `POST /v1/stories` (STORY-01).
 *
 * Three fields and nothing else: the media the admin picked, what kind it is, and the optional
 * caption. There is no `expiresAt` and there never will be — the window is a COLUMN DEFAULT, so a
 * client cannot ask for a story that outlives 24 h, and no route edit is needed to keep that true.
 *
 * `caption` defaults to `''` rather than being nullable, matching the column (`not null default ''`):
 * "no caption" is one value everywhere, so no renderer has to branch on null and empty separately.
 *
 * Deliberately NOT idempotent (edge: idempotency): two identical requests create two stories. An
 * admin who publishes the same photo twice made two broadcasts, and a create endpoint with no
 * client-supplied key cannot tell a retry from a deliberate repeat.
 */
export const publishStorySchema = z
  .object({
    mediaAssetId: z.uuid().nullable().default(null),
    mediaKind: z.enum(STORY_MEDIA_KINDS),
    caption: z.string().trim().max(STORY_MAX_CAPTION).default(''),
  })
  .strict()
  .superRefine((value, ctx) => {
    // A story with no media has nothing to show; the caption alone is a feed post. The MACHINE code
    // rides as the issue `message` (there is nowhere else on a Zod issue to put one) and the route's
    // `defaultHook` lifts it into `details.story`.
    if (value.mediaAssetId === null) {
      ctx.addIssue({ code: 'custom', path: ['mediaAssetId'], message: 'media_required' });
    }
  });
export type PublishStory = z.infer<typeof publishStorySchema>;

/**
 * `POST /v1/stories/{storyId}/likes` and its DELETE (STORY-05's first half).
 *
 * The SAME `{ liked, likeCount }` pair the feed answers with, redeclared here rather than imported:
 * `turbo boundaries` denies a `module -> module` package edge, so the shape is restated in three
 * lines instead of the feed's contracts package being pulled in. `likeCount` is the AUTHORITATIVE
 * count read back from the row inside the same transaction — never a number the client incremented.
 */
export const storyLikeResultSchema = z
  .object({
    liked: z.boolean(),
    likeCount: z.number().int().min(0),
  })
  .strict();
export type StoryLikeResult = z.infer<typeof storyLikeResultSchema>;

/**
 * The permission STRINGS, exported so the manifest and the web tier never retype them.
 *
 * `manage` covers deleting a story and pinning/unpinning it to a community (D-84); `publish` is the
 * one the `/inicio` own-circle's visibility is read from. They are SEPARATE because V2 hands
 * `publish` to members without handing them the moderation half — the FEED-08 shape, reused.
 */
export const STORY_PERMISSIONS = {
  publish: 'stories.story.publish',
  manage: 'stories.story.manage',
} as const;

/**
 * A story reached its tenant's members. **Ids and flags only** — a story CAPTION must never enter an
 * event payload for the same reason a post caption does not (T-04-05 / T-05-29): the payload is what
 * a subscriber logs, and member-facing text has no business in a log line.
 *
 * `expiresAt` is on the payload deliberately: Phase 7's notification row needs to know how long the
 * thing it is announcing will exist, and without it the subscriber would re-read `stories`.
 */
export interface StoryPublished {
  tenantId: string;
  storyId: string;
  authorUserId: string;
  mediaKind: StoryMediaKind;
  expiresAt: string;
}

/**
 * A story was SOFT-deleted by someone holding `stories.story.manage`. `authorUserId` and
 * `actorUserId` are both present because in V2 they stop being the same person, and a Phase 8
 * moderation log that could not tell them apart would be useless.
 *
 * There is no `story.expired` event and there must never be one: expiry is a read predicate, so
 * there is no moment at which anything happens that a subscriber could be told about (STORY-03).
 */
export interface StoryDeleted {
  tenantId: string;
  storyId: string;
  authorUserId: string;
  actorUserId: string;
}

/**
 * A member liked a story (STORY-05).
 *
 * **`storyAuthorUserId` OVER-CARRIES the recipient on purpose**, exactly as `PostLiked` does: Phase
 * 7 builds its notification row straight from the payload, and without it every subscriber would
 * have to re-read the story it is being told about. It is read INSIDE the same transaction as the
 * like, so it cannot describe a story that a rollback erased.
 *
 * Ids and flags only — no caption, for the T-05-29 reason the publish payload gives.
 */
export interface StoryLiked {
  tenantId: string;
  storyId: string;
  /** The notification recipient. */
  storyAuthorUserId: string;
  actorUserId: string;
}

/**
 * The same shape for the other half of the toggle. It is emitted ONLY when a row was really
 * removed: an unlike of something never liked is a successful no-op, and an event that counted
 * transitions must not announce one that did not happen.
 */
export type StoryUnliked = StoryLiked;

/**
 * MOD-02 in one block: the module teaches the KERNEL's `EventMap` about its own events instead of
 * the kernel knowing modules exist. Anything that imports this file gets `emit`/`subscribe` typed
 * for them.
 */
declare module '@tria/contracts' {
  interface EventMap {
    'story.published': StoryPublished;
    'story.deleted': StoryDeleted;
    'story.liked': StoryLiked;
    'story.unliked': StoryUnliked;
  }
}

/* ── Story comments (STORY-05, D-82, D-83) — RED SKELETON ─────────────────────────────────────── */

/** RED skeleton (05-07 Task 1). Replaced by the real contract in the GREEN commit. */
export const STORY_MAX_COMMENT = 1000;
export const STORY_COMMENTS_PAGE_SIZE = 20;
export const STORY_COMMENTS_MAX_PAGE_SIZE = 50;
export const STORY_COMMENT_ISSUES = ['story_comment_no_reply'] as const;
export type StoryCommentIssue = (typeof STORY_COMMENT_ISSUES)[number];
export const STORY_COMMENT_ISSUE_SET: ReadonlySet<string> = new Set(STORY_COMMENT_ISSUES);

export const createStoryCommentSchema = z
  .object({ body: z.string().trim().min(1).max(STORY_MAX_COMMENT) })
  .strict();
export type CreateStoryComment = z.infer<typeof createStoryCommentSchema>;

export const storyCommentsQuerySchema = z.object({}).strict();
export type StoryCommentsQuery = z.infer<typeof storyCommentsQuerySchema>;

export const storyCommentAuthorSchema = z.object({}).strict();
export const storyCommentSchema = z.object({}).strict();
export type StoryComment = z.infer<typeof storyCommentSchema>;
export const storyCommentPageSchema = z.object({}).strict();
export type StoryCommentPage = z.infer<typeof storyCommentPageSchema>;
