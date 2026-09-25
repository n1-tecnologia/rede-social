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
    /**
     * STORY-04: how many communities this story is pinned to, counted in the SAME statement the
     * story row came from. It is what UI-D-40's trailing pin indicator renders, and `0` is what
     * makes "a story pinned nowhere renders no indicator at all" a comparison rather than a null
     * check. The strip carries it too, unread, because one projection serving three reads is what
     * stops the three disagreeing about what a story looks like.
     */
    pinnedCommunityCount: z.number().int(),
    /**
     * 05.2: how many highlights this story is in (D-100 — one story may sit in several), counted in
     * the SAME statement as every story projection, never per row. It is what "Seus stories" will
     * render beside the pin indicator. `pinnedCommunityCount` stays until plan 11 retires the pins,
     * so no web read changes shape before the web is ready for it.
     */
    highlightCount: z.number().int(),
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
 * Four fields and nothing else: the media the admin picked, what kind it is, the optional caption,
 * and ONE optional destination community. There is no `expiresAt` and there never will be — the
 * window is a COLUMN DEFAULT, so a client cannot ask for a story that outlives 24 h, and no route
 * edit is needed to keep that true.
 *
 * `communityId` (05.1, D-95/D-99) is ONE community or none — a single optional uuid, never an array
 * and never nullable: "no destination" is the ABSENCE of the key, exactly how the post composer's
 * `createPostSchema.communityId` already says it. Absent means a tenant-wide story, byte-for-byte
 * today's publish. Present, the story is born pinned there: the `story_community_pins` row is written
 * in the SAME transaction as the story (D-99), under the rules `pinStory` applies, and the route
 * additionally requires `stories.story.manage` — pinning is the moderation half, and V2 hands
 * `publish` to members without it. More communities are still pinned afterwards from `/stories/meus`.
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
    communityId: z.uuid().optional(),
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
    'story.commented': StoryCommented;
    'story.comment_deleted': StoryCommentDeleted;
  }
}

/* ── Story comments (STORY-05, D-82, D-83) ─────────────────────────────────────────────────────── */

/**
 * The comment cap, restated here rather than imported from `@tria/module-feed/contracts` for the
 * reason `storyLikeResultSchema` is restated: `turbo boundaries` denies a `module -> module` package
 * edge (MOD-02). The VALUE is deliberately the same as `FEED_MAX_COMMENT` — a member typing into the
 * same sheet must hit the same ceiling — and it is measured in UTF-16 code units at both ends, so an
 * emoji is never cut into a lone surrogate.
 */
export const STORY_MAX_COMMENT = 1000;

/** The feed's root-comment page size and cap, restated. Refused above the cap, never clamped. */
export const STORY_COMMENTS_PAGE_SIZE = 20;
export const STORY_COMMENTS_MAX_PAGE_SIZE = 50;

/**
 * STORY-05's closed refusal vocabulary, as MACHINE codes. The pt-BR copy lives in the catalog.
 *
 * TWO codes for TWO refusals, and that is the point. "You cannot reply to a story comment" and "you
 * cannot like a story comment" are different sentences to a member, and a single shared code would
 * make one of the two wrong. Phase 4's `reply_depth_exceeded` keeps its own case — a reply to a
 * reply on a POST — and is deliberately absent from this set.
 *
 * Both are TRANSLATIONS of a SQLSTATE the database raised (`23514` when the row names its target
 * honestly, `23503` when it lies), never a pre-check. `story_comment_not_likeable` is answered by
 * the FEED's comment-like route rather than by anything in this module; it is enumerated here so
 * the web tier has one exhaustive switch for the pair (T-05-40, T-05-41).
 */
export const STORY_COMMENT_ISSUES = [
  'story_comment_no_reply',
  'story_comment_not_likeable',
] as const;
export type StoryCommentIssue = (typeof STORY_COMMENT_ISSUES)[number];

/** The route `defaultHook`'s and the web tier's lookup over that closed vocabulary. */
export const STORY_COMMENT_ISSUE_SET: ReadonlySet<string> = new Set(STORY_COMMENT_ISSUES);

/**
 * `POST /v1/stories/{storyId}/comments`.
 *
 * **`parentId` is accepted on purpose, and this is the most important line in the file.** STORY-05
 * says a story comment cannot be replied to, and the DATABASE is what says so: the insert names
 * `(parent, 0, 'post')` and a story comment's triple is `(id, 0, 'story')`, so `feed_comments_parent_fk`
 * refuses it. A `.strict()` object without a `parentId` would move that refusal into the schema —
 * an application check that passes its own tests while the constraint is missing, and one that
 * gives a member calling the API directly a different answer from a member tapping a button. The
 * UI simply never draws the affordance (D-82); the absence of the button is not the control.
 */
export const createStoryCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(STORY_MAX_COMMENT),
    parentId: z.uuid().optional(),
  })
  .strict();
export type CreateStoryComment = z.infer<typeof createStoryCommentSchema>;

/**
 * `GET /v1/stories/{storyId}/comments?limit=&cursor=`. `.strict()`: an unknown query key fails
 * loudly (the 03-03 rule), and there is deliberately no `order` key — the direction is D-83's, not
 * the caller's, and it is the direction `feed_comments_tenant_story_root_asc_idx` is built on.
 */
export const storyCommentsQuerySchema = z
  .object({
    cursor: z.string().max(STORY_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(STORY_COMMENTS_MAX_PAGE_SIZE)
      .default(STORY_COMMENTS_PAGE_SIZE),
  })
  .strict();
export type StoryCommentsQuery = z.infer<typeof storyCommentsQuerySchema>;

/**
 * A story comment's author (UI-D-24), with every identifying field nullable — the feed's
 * `commentAuthorSchema` restated across the boundary.
 *
 * `displayName` is null in exactly one case: `authorRemoved === true`, i.e. the membership is gone
 * or soft-deleted. The row STAYS — its body, its timestamp and its place in the conversation are
 * untouched — and the client renders the catalog's fixed removed-member label as plain text, with
 * `membershipId` null beside it so there is nothing to build a profile link out of (T-04-45).
 *
 * A story comment is the one place this projection is strictly SAFER than the feed's: with no
 * replies there is nothing hanging off the row to orphan.
 */
export const storyCommentAuthorSchema = z
  .object({
    membershipId: z.uuid().nullable(),
    displayName: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
  })
  .strict();
export type StoryCommentAuthor = z.infer<typeof storyCommentAuthorSchema>;

/**
 * One story comment on the wire — and note what is NOT here.
 *
 * No `likeCount`, no `viewerLiked`, no `replyCount` and no `isReply`. A flat conversation has no
 * threads to count and no likeable rows, so carrying those fields would be four numbers the client
 * could only render as zero — and the first thing a future reader would do is wire a control to
 * them. The payload's SHAPE is the product rule, restated where it cannot be missed.
 *
 * `canDelete` is SERVER-derived (T-04-44): the client never compares ids to decide who may remove a
 * comment, and the delete re-checks it anyway.
 */
export const storyCommentSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.string(),
    body: z.string(),
    author: storyCommentAuthorSchema,
    /** UI-D-24 — true exactly when `author.displayName` is null. */
    authorRemoved: z.boolean(),
    canDelete: z.boolean(),
  })
  .strict();
export type StoryComment = z.infer<typeof storyCommentSchema>;

/** One keyset page, OLDEST first (D-83). `nextCursor` is non-null exactly when another row exists. */
export const storyCommentPageSchema = z
  .object({
    items: z.array(storyCommentSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type StoryCommentPage = z.infer<typeof storyCommentPageSchema>;

/**
 * A member commented on a story (STORY-05).
 *
 * `storyAuthorUserId` OVER-CARRIES the recipient exactly as `StoryLiked` does, so Phase 7 builds its
 * notification row straight from the payload without re-reading the story. Read INSIDE the writing
 * transaction, so it cannot describe a story a rollback erased.
 *
 * **There is no comment BODY on this payload and there must never be one** (T-05-43): the manifest's
 * own subscriber logs the payload verbatim, and member-facing text has no business in a log line.
 */
export interface StoryCommented {
  tenantId: string;
  storyId: string;
  commentId: string;
  /** The notification recipient. */
  storyAuthorUserId: string;
  actorUserId: string;
}

/**
 * A member soft-deleted their OWN story comment. Emitted only when a row really moved — a second
 * delete matches nothing and announces nothing, the `story.unliked` rule restated.
 */
export interface StoryCommentDeleted {
  tenantId: string;
  storyId: string;
  commentId: string;
  actorUserId: string;
}

/* ── Community pins (STORY-04, D-68, D-84) ─────────────────────────────────────────────────────── */

/**
 * `PUT` / `DELETE /v1/stories/{storyId}/pins/{communityId}` — the toggle's answer.
 *
 * The SAME `{ state, count }` pair shape the like toggle answers with, for the same reason: the
 * count is the AUTHORITATIVE number read back from the rows inside the writing transaction, never a
 * number the client incremented. `pinnedCommunityCount` is how many communities the STORY is pinned
 * to — not how many pins the community has — because that is what the history row's indicator
 * renders and what the sheet's state is reconciled against.
 *
 * There is no conflict status anywhere in this vocabulary. Re-pinning the same pair returns the
 * identical body, and unpinning something that was never pinned does too.
 */
export const storyPinResultSchema = z
  .object({
    pinned: z.boolean(),
    pinnedCommunityCount: z.number().int().min(0),
  })
  .strict();
export type StoryPinResult = z.infer<typeof storyPinResultSchema>;

/**
 * The closed refusal vocabulary a pin WRITE can answer with, as `details.pin`.
 *
 * ONE code, and it is 05-03's own word: pinning into an ARCHIVED community is refused with the
 * same `archived` the composer already answers, because it is the same rule — an archived container
 * takes no new content. Inventing a second spelling for it here would give the web two switches to
 * keep in step for one product fact.
 *
 * A MISS — an unknown story, an unknown community, another tenant's of either — is deliberately NOT
 * in this vocabulary: it is a BARE 404 with no `details` at all, because a per-cause code over an
 * enumerable uuid space would be an existence oracle (D-23, T-05-49).
 */
export const STORY_PIN_ISSUES = ['archived'] as const;
export type StoryPinIssue = (typeof STORY_PIN_ISSUES)[number];

/** The web tier's lookup over that closed vocabulary. */
export const STORY_PIN_ISSUE_SET: ReadonlySet<string> = new Set(STORY_PIN_ISSUES);

/**
 * `GET /v1/stories/{storyId}/pins` — the community ids a story is currently pinned to, which is the
 * pin sheet's initial state.
 *
 * Ids only. The sheet already holds the community NAMES from the page's own read, so sending them
 * again would be a second source of the same words that could disagree with the first.
 */
export const storyPinsSchema = z.object({ communityIds: z.array(z.uuid()) }).strict();
export type StoryPins = z.infer<typeof storyPinsSchema>;

/**
 * `GET /v1/stories/pinned?communityId=&limit=&cursor=` (STORY-04, D-68) — one community's Destaques.
 *
 * `communityId` is REQUIRED: there is no "all pinned stories of the tenant" read, because no screen
 * asks that question and an endpoint nobody calls is a payload shape frozen for free.
 *
 * `limit` CLAMPS rather than refuses, for the reason `storyQuerySchema`'s does: the row renders on
 * the community page, a screen reachable from a shared link, and a hand-edited `?limit=` must never
 * be the reason it shows an error. The clamp is what T-05-53 asks for either way.
 */
export const storyHighlightsQuerySchema = z
  .object({
    communityId: z.uuid(),
    cursor: z.string().max(STORY_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce
      .number()
      .int()
      .catch(STORY_PAGE_SIZE)
      .transform((value) => Math.min(Math.max(value, 1), STORY_MAX_PAGE_SIZE))
      .default(STORY_PAGE_SIZE),
  })
  .strict();
export type StoryHighlightsQuery = z.infer<typeof storyHighlightsQuerySchema>;

/**
 * The community row the pin sheet drew, declared HERE rather than imported from
 * `@tria/module-communities/contracts`. **Retired on the web in 05.2-07** (the pin sheet was deleted
 * with the pin vocabulary, UI-D-79); the type stays until plan 11 retires the pin contracts.
 *
 * **This was not a preference.** `turbo boundaries` denies a `module -> module` package edge
 * (MOD-02), and the pin sheet lived in this module — so the shape the sheet consumed is declared
 * in the module that consumes it, exactly as `storyLikeResultSchema` and `STORY_MAX_COMMENT`
 * restate the feed's. The host (`apps/web`, which may reach both) maps `CommunitySummary` onto this
 * in one place, so the four fields below are the whole contract between the two modules and they
 * are structurally checked at that call site.
 */
export interface StoryPinCommunity {
  id: string;
  name: string;
  /** Null takes the `--brand-gradient` branch (D-69/UI-D-35), exactly as the list card's cover does. */
  coverAssetId: string | null;
  coverVariantWidths: readonly number[];
}

/**
 * A story was pinned to a community (STORY-04) — an EDITORIAL act, announced exactly once.
 *
 * **Ids only**, for the reason every other payload in this file is: the manifest's own subscriber
 * logs the payload verbatim, and neither a story caption nor a community name has any business in a
 * log line (T-05-29, T-05-06).
 *
 * It is emitted only when a row was really created. Re-pinning the same pair inserts nothing and
 * announces nothing: a subscriber counting these is counting transitions, and a second
 * announcement of a state that never changed would be a lie it cannot detect — the `story.unliked`
 * rule, applied to both halves of this toggle rather than only to the removal.
 *
 * `POST /v1/stories` emits it too when a story is born attached (05.1, D-99) — one event per pin row,
 * whichever path wrote it, so a subscriber tracking pins sees every pin through this one name.
 */
export interface StoryPinned {
  tenantId: string;
  storyId: string;
  communityId: string;
  actorUserId: string;
}

/** The same shape for the other half, emitted only when a row was really removed. */
export type StoryUnpinned = StoryPinned;

declare module '@tria/contracts' {
  interface EventMap {
    'story.pinned': StoryPinned;
    'story.unpinned': StoryUnpinned;
  }
}

/* ── Highlights (05.2) ─────────────────────────────────────────────────────────────────────────── */

/**
 * A highlight title's cap, in UTF-16 code units — the unit the input's `maxLength` and the Zod
 * `.max()` both count, so a title the field accepts is never refused by the API. The 64 px circle
 * truncates visually anyway; the cap is Instagram parity (R-D-B). The database backstop
 * (`story_highlights_title_chk`) counts code points, which is never MORE than UTF-16 units, so it
 * can never refuse a title this schema accepted.
 */
export const STORY_HIGHLIGHT_MAX_TITLE = 15;

/** How many stories one highlight may hold; the items read is `limit`ed to the same number. */
export const STORY_HIGHLIGHT_MAX_ITEMS = 100;

/** How many highlights one place (Início, or one community) may hold. */
export const STORY_HIGHLIGHT_MAX_PER_PLACE = 50;

/**
 * The closed refusal vocabulary a highlight WRITE can answer with, as `details.highlight`. MACHINE
 * codes; the pt-BR copy lives in the catalog.
 *
 * - `archived` — an archived community takes no new content, and a highlight or an item is new
 *   content (the pins' and the composer's own word, not a second spelling of it).
 * - `title_invalid` — empty after trimming, or longer than `STORY_HIGHLIGHT_MAX_TITLE`.
 * - `order_stale` — a reorder named a set of highlights that is not exactly the place's current set.
 * - `full` — the place already holds `STORY_HIGHLIGHT_MAX_PER_PLACE` highlights, or the highlight
 *   already holds `STORY_HIGHLIGHT_MAX_ITEMS` stories.
 *
 * A MISS — an unknown highlight, story or community, or another tenant's — is deliberately NOT in
 * this vocabulary: it is a BARE 404 with no `details`, because a per-cause code over an enumerable
 * uuid space would be an existence oracle (D-23).
 */
export const STORY_HIGHLIGHT_ISSUES = ['archived', 'title_invalid', 'order_stale', 'full'] as const;
export type StoryHighlightIssue = (typeof STORY_HIGHLIGHT_ISSUES)[number];

/** The route `defaultHook`'s and the web tier's lookup over that closed vocabulary. */
export const STORY_HIGHLIGHT_ISSUE_SET: ReadonlySet<string> = new Set(STORY_HIGHLIGHT_ISSUES);

/**
 * A highlight title: trimmed, then 1..15 UTF-16 units. The issue MESSAGE is the machine code, so the
 * route's `defaultHook` lifts both refusals into `details.highlight: 'title_invalid'`.
 */
export const storyHighlightTitleSchema = z
  .string()
  .trim()
  .min(1, 'title_invalid')
  .max(STORY_HIGHLIGHT_MAX_TITLE, 'title_invalid');

/**
 * `POST /v1/stories/highlights` — a new highlight in one place. "Início" is the ABSENCE of
 * `communityId`, never a null or a sentinel (the `createPostSchema.communityId` rule). The new
 * highlight lands at the END of its place's row.
 */
export const createStoryHighlightSchema = z
  .object({
    communityId: z.uuid().optional(),
    title: storyHighlightTitleSchema,
  })
  .strict();
export type CreateStoryHighlight = z.infer<typeof createStoryHighlightSchema>;

/**
 * `GET /v1/stories/highlights?communityId=&scope=` — one place's row. No `communityId` means Início.
 *
 * `scope=all` is the CURATOR's read: it includes EMPTY highlights (D-102), which members never see.
 * A caller without `stories.story.manage` asking for it is refused 403 — the flag cannot widen a
 * member's read. There is no paging: a place holds at most `STORY_HIGHLIGHT_MAX_PER_PLACE`.
 */
export const highlightListQuerySchema = z
  .object({
    communityId: z.uuid().optional(),
    scope: z.enum(['all']).optional(),
  })
  .strict();
export type HighlightListQuery = z.infer<typeof highlightListQuerySchema>;

/**
 * One highlight as the row draws it.
 *
 * - `communityId` null means Início.
 * - `coverAssetId` / `coverVariantWidths` are the RESOLVED cover (R-D-D), computed by the server in
 *   the same statement as the row: the uploaded cover image, else the chosen story's image, else the
 *   most recently ADDED live image item, else null (the circle's brand-gradient fallback). Covers are
 *   image-only in 05.2 (D-101): a highlight whose items are all videos resolves no automatic cover.
 * - `coverStoryId` is the chosen story when one is set; `coverChosen` is true exactly when the cover
 *   came from an explicit choice (an uploaded image or a chosen story) rather than the default rule.
 * - `itemCount` counts MEMBER-VISIBLE items only (story not removed, asset `ready`) — the same
 *   predicate the items read uses, so "empty" means the same thing on both reads.
 */
export const highlightSummarySchema = z
  .object({
    id: z.uuid(),
    communityId: z.uuid().nullable(),
    title: z.string(),
    position: z.number().int(),
    coverAssetId: z.uuid().nullable(),
    coverVariantWidths: z.array(z.number().int()),
    coverStoryId: z.uuid().nullable(),
    coverChosen: z.boolean(),
    itemCount: z.number().int(),
  })
  .strict();
export type HighlightSummary = z.infer<typeof highlightSummarySchema>;

/** A place's row, in `position` order (ties broken by id — a total order). */
export const highlightListSchema = z.object({ items: z.array(highlightSummarySchema) }).strict();
export type HighlightList = z.infer<typeof highlightListSchema>;

/**
 * `GET /v1/stories/highlights/{highlightId}` — the highlight and its stories, OLDEST first by
 * PUBLISH time (D-103), EXPIRED ones included: the item row is the expiry override, so each story
 * carries its server-computed `isActive` and the viewer plays it either way.
 */
export const highlightDetailSchema = z
  .object({
    highlight: highlightSummarySchema,
    items: z.array(storySummarySchema),
  })
  .strict();
export type HighlightDetail = z.infer<typeof highlightDetailSchema>;

/**
 * `PUT` (and plan 03's `DELETE`) `/v1/stories/highlights/{highlightId}/stories/{storyId}` — the
 * toggle's answer. `highlightCount` is how many highlights the STORY is in after the write, read back
 * from the rows inside the writing transaction. A repeat returns the identical body; there is no
 * conflict status anywhere in this vocabulary.
 */
export const highlightMembershipResultSchema = z
  .object({
    highlighted: z.boolean(),
    highlightCount: z.number().int().min(0),
  })
  .strict();
export type HighlightMembershipResult = z.infer<typeof highlightMembershipResultSchema>;

/**
 * A highlight's CHOSEN cover (D-101), one of exactly two shapes:
 *
 * - `{ storyId }` — one of THIS highlight's own live IMAGE stories. Covers are image-only in 05.2
 *   (the developer's plan-time decision, 2026-09-25): a video story, a removed one, or a story that
 *   is not in this highlight is the bare 404 — the UI never offers anything else, so a separate code
 *   would be vocabulary only a crafted client could reach.
 * - `{ assetId }` — an UPLOADED image: an asset of this tenant with purpose `cover`, kind `image`,
 *   status `ready`, not removed (the 05-09 community-cover tuple). Every miss is the same bare 404.
 *
 * Choosing one kind clears the other (`story_highlights_cover_chk` allows at most one), and `null`
 * clears both, returning the highlight to the automatic rule. Replacing or clearing an uploaded cover
 * never deletes the old asset.
 */
export const highlightCoverSchema = z.union([
  z.object({ storyId: z.uuid() }).strict(),
  z.object({ assetId: z.uuid() }).strict(),
]);
export type HighlightCover = z.infer<typeof highlightCoverSchema>;

/**
 * `PATCH /v1/stories/highlights/{highlightId}` — rename and/or re-cover (HIGHLIGHT-01). At least one
 * key is required: an empty body is a `VALIDATION_FAILED` with `issues`, never a silent 200.
 *
 * The response is the highlight's summary AFTER the write. A PATCH identical to the stored row
 * changes nothing and announces nothing (`highlight.updated` counts transitions, not requests).
 */
export const updateHighlightSchema = z
  .object({
    title: storyHighlightTitleSchema.optional(),
    cover: highlightCoverSchema.nullable().optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.cover !== undefined, {
    message: 'Informe title ou cover.',
  });
export type UpdateHighlight = z.infer<typeof updateHighlightSchema>;

/**
 * `PUT /v1/stories/highlights/order` — reorder ONE place's highlights (R-D-C). `communityId` absent
 * means Início. `highlightIds` must be the place's FULL current set in the new order: a set that
 * differs from it in any way — missing, extra, duplicated or foreign — is `{ highlight: 'order_stale' }`
 * and writes nothing. Duplicates are left to the service on purpose, so every stale shape answers
 * ONE code instead of some of them answering a Zod `issues` list. The cap mirrors the place's own
 * (`STORY_HIGHLIGHT_MAX_PER_PLACE`), so an oversized permutation is refused before any lookup.
 *
 * The answer is the place's CURATOR row (`highlightListSchema`) in the new order.
 */
export const reorderHighlightsSchema = z
  .object({
    communityId: z.uuid().optional(),
    highlightIds: z.array(z.uuid()).min(1).max(STORY_HIGHLIGHT_MAX_PER_PLACE),
  })
  .strict();
export type ReorderHighlights = z.infer<typeof reorderHighlightsSchema>;

/**
 * `GET /v1/stories/{storyId}/highlights` — the ids of the highlights one story is in (the shared
 * sheet's initial state), in position order. Ids only: the sheet already holds the titles from the
 * catalogue read, and sending them again would be a second source of the same words.
 */
export const storyHighlightIdsSchema = z.object({ highlightIds: z.array(z.uuid()) }).strict();
export type StoryHighlightIds = z.infer<typeof storyHighlightIdsSchema>;

/**
 * A highlight was created. **Ids only** — never the title (T-05-29/T-05-06): the manifest's own
 * subscriber logs payloads verbatim, and curator-written text has no business in a log line.
 * `communityId` is null for Início.
 */
export interface HighlightCreated {
  tenantId: string;
  highlightId: string;
  communityId: string | null;
  actorUserId: string;
}

/**
 * A story was added to a highlight. Emitted only when a row was really created — a repeat add is
 * absorbed by `story_highlight_items_uq` and announces nothing (transitions, not requests).
 */
export interface StoryHighlighted {
  tenantId: string;
  storyId: string;
  highlightId: string;
  actorUserId: string;
}

/**
 * A story was removed from a highlight (HIGHLIGHT-02) — `StoryHighlighted`'s shape. Transitions,
 * not requests: emitted only when a row was really removed; removing a pair that is not there
 * answers 200 and announces nothing. The STORY itself is never touched by the removal.
 */
export type StoryUnhighlighted = StoryHighlighted;

/**
 * A highlight's title or cover really changed. Transitions, not requests: a PATCH identical to the
 * stored row announces nothing. **Ids only** — never the title, which is curator-written text.
 */
export interface HighlightUpdated {
  tenantId: string;
  highlightId: string;
  actorUserId: string;
}

/**
 * A place's highlights were reordered (R-D-C) and at least one position really moved. Transitions,
 * not requests: a permutation equal to the current order announces nothing. `communityId` is null
 * for Início. Ids only.
 */
export interface HighlightReordered {
  tenantId: string;
  communityId: string | null;
  actorUserId: string;
}

/**
 * A highlight was deleted — its items with it, never its stories. Emitted on a real delete only (a
 * second delete is the bare 404 and announces nothing). `communityId` is null for Início. Ids only.
 */
export interface HighlightDeleted {
  tenantId: string;
  highlightId: string;
  communityId: string | null;
  actorUserId: string;
}

declare module '@tria/contracts' {
  interface EventMap {
    'highlight.created': HighlightCreated;
    'highlight.updated': HighlightUpdated;
    'highlight.reordered': HighlightReordered;
    'highlight.deleted': HighlightDeleted;
    'story.highlighted': StoryHighlighted;
    'story.unhighlighted': StoryUnhighlighted;
  }
}
