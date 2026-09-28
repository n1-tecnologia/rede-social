import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import {
  permissionsForRequest,
  requirePermission,
} from '@rede-social/core/server/rbac/permissions';
import {
  createStoryCommentSchema,
  createStoryHighlightSchema,
  highlightDetailSchema,
  highlightListQuerySchema,
  highlightListSchema,
  highlightMembershipResultSchema,
  highlightSummarySchema,
  markStoriesSeenSchema,
  publishStorySchema,
  reorderHighlightsSchema,
  STORY_HIGHLIGHT_ISSUE_SET,
  STORY_ISSUE_SET,
  storyCommentPageSchema,
  storyCommentSchema,
  storyCommentsQuerySchema,
  storyHighlightIdsSchema,
  storyLikeResultSchema,
  storyPageSchema,
  storyQuerySchema,
  storySummarySchema,
  updateHighlightSchema,
} from '../contracts/index';
import {
  addStoryToHighlight,
  createHighlight,
  createStoryComment,
  deleteHighlight,
  deleteStory,
  deleteStoryComment,
  getHighlight,
  getStory,
  likeStory,
  listActiveStories,
  listHighlightCatalog,
  listHighlights,
  listOwnStories,
  listStoryComments,
  listStoryHighlightIds,
  markStoriesSeen,
  publishStory,
  removeStoryFromHighlight,
  reorderHighlights,
  unlikeStory,
  updateHighlight,
} from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/stories', storiesRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order extended by one, and it matters: `requireAuth` (401 without a session)
 * -> `requireModule` (404 when the tenant does not have stories — never 403, so a member cannot tell
 * "not allowed" from "not here") -> `requirePermission` on the write and admin routes (403).
 *
 * The write guards are PERMISSIONS, never `requireRole` (T-05-25): a role comparison would hard-code
 * V1's "only the admin publishes" into the route, and granting the permission to another role later
 * would then still need a code change. The literals are spelled out at each call site rather than
 * read from `STORY_PERMISSIONS`, because those strings are the one thing a reviewer greps for when
 * asking "what guards publishing a story?" — an indirection here is the kind that hides a change.
 */

/**
 * The refusals `publishStorySchema`'s refinement raises, lifted to `details.story`. The refinement
 * carries the MACHINE CODE as its issue `message` (there is nowhere else on a Zod issue to put one),
 * so the web switches on the same closed vocabulary the service uses when it refuses the same shape
 * — one code per rule, whichever layer caught it.
 *
 * 05.2: a highlight title's refusal rides the same way — `storyHighlightTitleSchema`'s issue message
 * IS `title_invalid`, lifted here to `details.highlight`, the key the service's own refusals
 * (`archived`, `full`) use, so the web has one switch over `STORY_HIGHLIGHT_ISSUES`.
 *
 * 05.2-11: a PATH segment that is not an id names nothing, so it is the SAME bare 404 an unknown id
 * gets (D-23) rather than a 400 describing the malformed segment. This is also what a stale client
 * calling the retired `…/pinned` read now meets: the literal segment falls through to `/{storyId}`,
 * and "no such route" and "no such story" must not be told apart.
 */
const stories = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      if (result.target === 'param') throw new ApiError(404, 'NOT_FOUND');
      const highlight = result.error.issues
        .map((issue) => issue.message)
        .find((message) => STORY_HIGHLIGHT_ISSUE_SET.has(message));
      if (highlight) throw new ApiError(400, 'VALIDATION_FAILED', { highlight });
      const story = result.error.issues
        .map((issue) => issue.message)
        .find((message) => STORY_ISSUE_SET.has(message));
      if (story) throw new ApiError(400, 'VALIDATION_FAILED', { story });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

stories.use('*', requireAuth, requireModule('stories'));

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: storyQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the tenant's ACTIVE stories, newest first (D-78: one item per story, never per publisher). A story is absent because `expires_at` passed, because it was removed, or because its media asset is not `ready` — the row is never deleted for any of those reasons. A tenant with nothing live answers an empty `items` and a null `nextCursor`, never a 404.",
      content: { 'application/json': { schema: storyPageSchema } },
    },
  },
});

/**
 * D-84's admin history: the SAME page shape, with the expiry range and the readiness filter dropped,
 * so a `processing` or `rejected` story is visible to the person who published it (Pitfall 5).
 *
 * Declared BEFORE `/{storyId}` so the literal segment wins the match: `mine` is not a uuid, so the
 * param route would 400 on it rather than falling through.
 */
const listOwnRoute = createRoute({
  method: 'get',
  path: '/mine',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: { query: storyQuerySchema },
  responses: {
    200: {
      description:
        'Every story of the tenant, expired ones included, newest window first. `isActive` says which are still in the strip; `mediaStatus` / `mediaFailureReason` carry the Phase 3 processing and refusal state.',
      content: { 'application/json': { schema: storyPageSchema } },
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
  },
});

/* ── Highlights (05.2, HIGHLIGHT-01/02, D-100..D-103) ─────────────────────────────────────────── */

/**
 * ALL of them are declared BEFORE `/{storyId}` so the literal `highlights` segment wins the match: it is
 * not a uuid, so the param route would 400 on it rather than falling through.
 *
 * The two READS carry no permission — every member of the tenant sees a place's highlights, exactly
 * as they see its stories — while the two WRITES carry the manage-permission middleware, spelled
 * out as a literal at each call site because it is the one string a reviewer greps for when asking
 * "what guards curating highlights?". Phase 10's creator-scoped curation swaps these guards for an
 * in-handler check; the place rules themselves already live in ONE service seam
 * (`resolveHighlightPlace`).
 *
 * The reads compute `curator` from `permissionsForRequest(ctx)`, the publish handler's seam: the
 * service never compares roles or permissions, it only honours the flag the route computed.
 *
 * Every miss — unknown, another tenant's, a removed community, the `communities` module off, and
 * for a member an EMPTY highlight — is ONE bare 404 with no `details` (D-23). The only 400 codes are
 * the closed `details.highlight` vocabulary.
 */
const highlightIdParam = z.object({ highlightId: z.uuid() });

const listHighlightsRoute = createRoute({
  method: 'get',
  path: '/highlights',
  request: { query: highlightListQuerySchema },
  responses: {
    200: {
      description:
        "One place's highlight row — Início when `communityId` is absent — in `position` order (ties by id, a total order). A member sees only highlights with at least one member-visible story (not removed, media `ready`); EMPTY highlights are curator-only and appear only under `scope=all`, with `itemCount: 0`. The cover is resolved by the server at read time: uploaded image, else the chosen story's image, else the most recently added image story, else null (the brand fallback).",
      content: { 'application/json': { schema: highlightListSchema } },
    },
    403: {
      description:
        '`scope=all` was asked for by a caller without `stories.story.manage` — the flag cannot widen a member’s read.',
    },
    404: {
      description:
        'The named community is unknown, another tenant’s, removed, or the `communities` module is off. One bare code, no details (D-23).',
    },
  },
});

/**
 * 05.2-03's two LITERAL-path highlight routes, declared (and registered) BEFORE
 * `GET /highlights/{highlightId}`: `catalog` and `order` are not uuids, so the param route would 400
 * on them rather than falling through. Both are manage-only (the literal middleware, T-05.2-11).
 */
const highlightCatalogRoute = createRoute({
  method: 'get',
  path: '/highlights/catalog',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  responses: {
    200: {
      description:
        'Every highlight the "add to highlight" sheet may offer (D-110), in ONE statement: Início’s first, then each ACTIVE community’s, ordered by community, position and id. Highlights of archived or removed communities are absent, and with the `communities` module off no community highlight is listed (their rows are untouched). Empty highlights are included — this is the curator’s read.',
      content: { 'application/json': { schema: highlightListSchema } },
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
  },
});

const reorderHighlightsRoute = createRoute({
  method: 'put',
  path: '/highlights/order',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: {
    body: { content: { 'application/json': { schema: reorderHighlightsSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The place’s curator row (Início when `communityId` is absent) in the new order, with dense positions 0..n-1 written in ONE statement under the place lock. A permutation equal to the current order changes nothing and emits nothing.',
      content: { 'application/json': { schema: highlightListSchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.highlight` = `order_stale` (the ids are not exactly the place’s current set — missing, extra, duplicated or foreign) or `archived` (the community is archived). Nothing is written.',
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: {
      description:
        'The named community is unknown, another tenant’s, removed, or the `communities` module is off. One bare code, no details (D-23).',
    },
  },
});

const getHighlightRoute = createRoute({
  method: 'get',
  path: '/highlights/{highlightId}',
  request: { params: highlightIdParam },
  responses: {
    200: {
      description:
        'The highlight and its stories, OLDEST first by publish time (D-103), at most 100. The items read carries NO expiry predicate: the item row is the override, so an expired story plays from its highlight with `isActive: false`. A member gets member-visible stories only; a curator gets every live story with its `mediaStatus`.',
      content: { 'application/json': { schema: highlightDetailSchema } },
    },
    404: {
      description:
        'No highlight with that id is visible to this tenant — unknown, another tenant’s, in a removed community — or, for a member, it holds no member-visible story (an empty highlight is the curator’s). One bare code, no details (D-23, D-102).',
    },
  },
});

const createHighlightRoute = createRoute({
  method: 'post',
  path: '/highlights',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: {
    body: {
      content: { 'application/json': { schema: createStoryHighlightSchema } },
      required: true,
    },
  },
  responses: {
    201: {
      description:
        'The created highlight, appended to the END of its place’s row (Início when `communityId` is absent), with `itemCount: 0` until a story is added.',
      content: { 'application/json': { schema: highlightSummarySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.highlight` carrying exactly one machine code: `title_invalid` (empty after trimming, or longer than 15), `archived` (the community is archived and takes no new content) or `full` (the place already holds 50 highlights). Nothing is written.',
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: {
      description:
        'The named community is unknown, another tenant’s, removed, or the `communities` module is off. One bare code, no details (D-23).',
    },
  },
});

const addHighlightItemRoute = createRoute({
  method: 'put',
  path: '/highlights/{highlightId}/stories/{storyId}',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: { params: highlightIdParam.extend({ storyId: z.uuid() }) },
  responses: {
    200: {
      description:
        'The story is in the highlight. `highlightCount` is how many highlights the STORY is in, read back from the rows in the same transaction. Idempotent: a repeat returns the identical body, creates no second row and never answers 409. An EXPIRED story is accepted — keeping it is the point. The story row itself is never changed.',
      content: { 'application/json': { schema: highlightMembershipResultSchema } },
    },
    400: {
      description:
        "`VALIDATION_FAILED` with `details.highlight` = `archived` (the highlight's community is archived) or `full` (the highlight already holds 100 stories).",
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: {
      description:
        'The highlight or the story is unknown, another tenant’s, or removed — ONE bare code for all of them, no details (D-23).',
    },
  },
});

/**
 * 05.2-03's curation writes. The same literal manage-permission middleware as the two writes above
 * (T-05.2-11) — the one string a reviewer greps for — and every place rule decided by the service's
 * one seam (`resolveHighlightPlace`): an ARCHIVED community refuses what ADDS content (rename,
 * re-cover) with `{ highlight: 'archived' }` and allows what TAKES IT DOWN (delete the highlight,
 * remove a story). Every miss is one bare 404.
 */
const updateHighlightRoute = createRoute({
  method: 'patch',
  path: '/highlights/{highlightId}',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: {
    params: highlightIdParam,
    body: { content: { 'application/json': { schema: updateHighlightSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The highlight AFTER the write. `title` renames it; `cover` re-covers it with ONE of two shapes — `{ storyId }` (a live IMAGE story of THIS highlight; covers are image-only in 05.2) or `{ assetId }` (an uploaded image: purpose `cover`, kind `image`, status `ready`, of this tenant) — or `null`, which returns it to the automatic cover. Choosing one kind clears the other; replacing an uploaded cover never deletes the old asset. A PATCH identical to the stored row changes nothing and emits nothing.',
      content: { 'application/json': { schema: highlightSummarySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.highlight` = `title_invalid` (empty after trimming, or longer than 15) or `archived` (the highlight’s community is archived and takes no curation); or with `details.issues` for a body naming neither `title` nor `cover`. Nothing is written.',
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: {
      description:
        'The highlight, the cover story or the cover asset is unknown, another tenant’s, removed, a video, not in this highlight, not a ready cover image — or the highlight’s community is removed or the `communities` module is off. ONE bare code for all of them, no details (D-23).',
    },
  },
});

const deleteHighlightRoute = createRoute({
  method: 'delete',
  path: '/highlights/{highlightId}',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: { params: highlightIdParam },
  responses: {
    204: {
      description:
        'The highlight is deleted with its items. Its STORIES, their likes and their comments are never touched — a highlight is an editorial pointer. Allowed on an archived community (take-down must stay possible).',
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: {
      description:
        'No highlight with that id is visible to this tenant — unknown, another tenant’s, ALREADY deleted, in a removed community, or the `communities` module is off. One bare code, no details (D-23).',
    },
  },
});

const removeHighlightItemRoute = createRoute({
  method: 'delete',
  path: '/highlights/{highlightId}/stories/{storyId}',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: { params: highlightIdParam.extend({ storyId: z.uuid() }) },
  responses: {
    // Deliberately NO 400: removing a story is a TAKE-DOWN, allowed on an archived community.
    200: {
      description:
        'The story is out of the highlight. `highlightCount` is how many highlights the STORY is still in. Idempotent: removing a pair that is not there answers the identical body and announces nothing. The story row is never changed, and the highlight is kept even when this removed its last story. If the story was the chosen cover, the highlight returns to its automatic cover.',
      content: { 'application/json': { schema: highlightMembershipResultSchema } },
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: {
      description:
        'The highlight or the story is unknown, another tenant’s, or removed — ONE bare code for all of them, no details (D-23).',
    },
  },
});

/* ── Seen state (HIGHLIGHT-06, D-105) ─────────────────────────────────────────────────────────── */

/**
 * `POST /v1/stories/views` — the stories the caller was just SHOWN, batched by the web.
 *
 * **MEMBER-REACHABLE: `requireAuth` + `requireModule('stories')` and nothing else.** There is
 * deliberately no `requirePermission` here, and adding one would be the bug — the like routes'
 * reason restated: the publishing policy gates AUTHORING a story, not watching one, and every
 * member's ring must grey once they have seen everything. Admins record views too (R-D-I).
 *
 * The answer is ALWAYS 204 for an accepted body: a foreign, unknown or removed id writes nothing and
 * reveals nothing (T-05.2-47). The body is `markStoriesSeenSchema` (1..50 uuids, strict).
 *
 * Declared BEFORE the `/{storyId}` routes so the literal segment wins any match, as `/mine` is.
 */
const markSeenRoute = createRoute({
  method: 'post',
  path: '/views',
  request: {
    body: { content: { 'application/json': { schema: markStoriesSeenSchema } }, required: true },
  },
  responses: {
    204: {
      description:
        "Recorded — or nothing to record. Only the caller's own (tenant, user, story) rows are written, idempotently; an id this tenant cannot see is silently skipped, so every accepted body answers the same 204.",
    },
    400: { description: '`VALIDATION_FAILED`: `storyIds` must be 1..50 uuids, and no other key.' },
  },
});

/** The story id every story-scoped route takes; a miss is a bare 404 (D-23). */
const storyIdParam = z.object({ storyId: z.uuid() });

const getStoryRoute = createRoute({
  method: 'get',
  path: '/{storyId}',
  request: { params: storyIdParam },
  responses: {
    200: {
      description:
        'One story, ACTIVE OR NOT — the viewer opens an expired story from the history, and a highlight keeps one on Início or a community page. The strip is what filters; this read never does.',
      content: { 'application/json': { schema: storySummarySchema } },
    },
    404: {
      description:
        'No story with that id is visible to this tenant — unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const publishStoryRoute = createRoute({
  method: 'post',
  path: '/',
  // The literal, not `STORY_PERMISSIONS.publish` — see the chain note above.
  middleware: [requirePermission('stories.story.publish')] as const,
  request: {
    body: { content: { 'application/json': { schema: publishStorySchema } }, required: true },
  },
  responses: {
    201: {
      description:
        'The published story, in the same shape the list returns. `expires_at` is 24 h after `published_at` and comes from the COLUMN DEFAULT — no client value can lengthen it. A video whose asset is still `processing` publishes successfully and simply stays out of the strip until it is ready.',
      content: { 'application/json': { schema: storySummarySchema } },
    },
    400: {
      description:
        '`VALIDATION_FAILED` with `details.story` carrying exactly one machine code: `media_required` (a story with no media has nothing to show) or `media_invalid` (an asset of this tenant whose purpose is not `story`, or whose kind does not match). With a highlight destination, `details.highlight` carries `archived` (the destination community is archived), `title_invalid` (`newHighlight.title` is empty after trimming or longer than 15) or `full` (the highlight or the place is at its cap). Naming both destinations, or any unknown key (05.1’s retired `communityId` included), is a plain `VALIDATION_FAILED`. In every case NO story, highlight or item is written.',
    },
    403: {
      description:
        'The caller does not hold `stories.story.publish` in this tenant — or the body names a destination (`highlightId` or `newHighlight`) and the caller does not also hold `stories.story.manage` (curating at publish is the manage half). Checked before any lookup.',
    },
    404: {
      description:
        'The media asset — or the chosen highlight or `newHighlight.communityId` — is unknown, another tenant’s, or removed (or the communities module is off). One bare code, no details, byte-identical for every miss (T-05-26, D-23).',
    },
  },
});

const deleteStoryRoute = createRoute({
  method: 'delete',
  path: '/{storyId}',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: { params: storyIdParam },
  responses: {
    204: {
      description:
        'The story is SOFT-deleted: the row stays, so the likes and comments members left on it survive and Phase 8 moderation can still read it.',
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: {
      description:
        'No story with that id is visible to this tenant — unknown, another tenant’s, or already removed. One bare code, no details (D-23).',
    },
  },
});

/* ── Likes (STORY-05, first half) ─────────────────────────────────────────────────────────────── */

/**
 * **Both like routes are MEMBER-REACHABLE: `requireAuth` + `requireModule('stories')` and nothing
 * else.** There is deliberately no `requirePermission` here, and adding one would be the bug: the
 * publishing policy gates AUTHORING a story, not interacting with one, and every member of the
 * tenant may like — exactly as they may like a post (FEED-04's rule, restated for the same reason).
 *
 * Two response facts a reader should not have to dig for, and both are deliberate:
 *  - a like or an unlike ALWAYS answers 200 with the current `{ liked, likeCount }`. A repeat is a
 *    no-op, not a conflict; there is no conflict status anywhere in this file;
 *  - a miss is a BARE 404 with no `details` — unknown id, another tenant's, or removed (D-23).
 *
 * **An EXPIRED story is likeable and that is not an oversight** (A-4). Expiry gates the strip's
 * read; highlights keep expired stories on Início and community pages, and an affordance that answered 400 there would
 * be a second copy of the 24 h window living in two more places.
 */
const storyLikeResponses = {
  200: {
    description:
      'The CURRENT state after the toggle, read back from the row in the same transaction. Idempotent: a repeat returns the identical body and creates no second row.',
    content: { 'application/json': { schema: storyLikeResultSchema } },
  },
  404: {
    description: 'No story with that id is visible to this tenant — unknown, foreign, or removed.',
  },
} as const;

const likeStoryRoute = createRoute({
  method: 'post',
  path: '/{storyId}/likes',
  request: { params: storyIdParam },
  responses: storyLikeResponses,
});

const unlikeStoryRoute = createRoute({
  method: 'delete',
  path: '/{storyId}/likes',
  request: { params: storyIdParam },
  responses: storyLikeResponses,
});

/* ── Comments (STORY-05, D-82, D-83) ───────────────────────────────────────────── */

/**
 * **All three comment routes are MEMBER-REACHABLE: `requireAuth` + `requireModule('stories')` and
 * nothing else.** Adding a `requirePermission` here would be the bug, for the same reason it would
 * be on the like routes: the publishing policy gates AUTHORING a story, not talking about one, and
 * every member of the tenant may comment — exactly as they may comment on a post (FEED-05's rule).
 *
 * **The 400 below is a TRANSLATION, not a validation.** `createStoryCommentSchema` deliberately
 * ACCEPTS a `parentId`: the request is well-formed, the INSERT is issued, and
 * `feed_comments_parent_fk` refuses it because a story comment's `(id, depth, target_kind)` triple
 * is unreachable from any legal parent. A member calling this endpoint directly therefore gets the
 * same answer as a member tapping a button — and the UI's missing affordance is the least
 * important of the three layers (STORY-05, T-05-40).
 *
 * An EXPIRED story is commentable, and that is not an oversight (A-4): expiry gates the STRIP's
 * read and nothing else, and highlights keep expired stories on Início and community pages.
 */
const listCommentsRoute = createRoute({
  method: 'get',
  path: '/{storyId}/comments',
  request: { params: storyIdParam, query: storyCommentsQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the story's comments, OLDEST first (D-83): a flat conversation runs forward in time, so a new comment lands at the bottom. There are no replies to fan out — the database makes a reply to a story comment unrepresentable — so this page is the whole conversation.",
      content: { 'application/json': { schema: storyCommentPageSchema } },
    },
    404: {
      description:
        'No story with that id is visible to this tenant — unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const createCommentRoute = createRoute({
  method: 'post',
  path: '/{storyId}/comments',
  request: {
    params: storyIdParam,
    body: { content: { 'application/json': { schema: createStoryCommentSchema } }, required: true },
  },
  responses: {
    201: {
      description:
        "The created comment, in the same shape the list returns, with the story's `comment_count` already moved by the trigger.",
      content: { 'application/json': { schema: storyCommentSchema } },
    },
    400: {
      description:
        "`VALIDATION_FAILED` with `details.comment = 'story_comment_no_reply'` — the DATABASE refused a reply to a story comment (SQLSTATE 23503 on `feed_comments_parent_fk`, or 23514 on `feed_comments_parent_shape_chk` for a row naming the target honestly). STORY-05.",
    },
    404: {
      description:
        'No story with that id is visible to this tenant, or the named parent is not a live comment on it. One bare code, no details (D-23).',
    },
  },
});

const deleteCommentRoute = createRoute({
  method: 'delete',
  path: '/{storyId}/comments/{commentId}',
  request: { params: storyIdParam.extend({ commentId: z.uuid() }) },
  responses: {
    204: {
      description:
        "The comment is SOFT-deleted: the row stays for Phase 8 moderation and the story's count moves exactly once, on the `deleted_at` transition.",
    },
    404: {
      description:
        'Not this member’s comment, not on this story, unknown, or already removed — ONE branch, so a member cannot probe whether a comment exists (T-04-16).',
    },
  },
});

/* ── Highlight memberships (05.2, D-110) ─────────────────────────────────────────────────────── */

const storyHighlightIdsRoute = createRoute({
  method: 'get',
  path: '/{storyId}/highlights',
  // The literal, not `STORY_PERMISSIONS.manage` — see the chain note above.
  middleware: [requirePermission('stories.story.manage')] as const,
  request: { params: storyIdParam },
  responses: {
    200: {
      description:
        'The ids of the highlights this story is in — the shared sheet’s initial state (D-110). Ids only: the sheet already holds the titles from the catalogue.',
      content: { 'application/json': { schema: storyHighlightIdsSchema } },
    },
    403: { description: 'The caller does not hold `stories.story.manage` in this tenant' },
    404: { description: 'No story with that id is visible to this tenant (D-23).' },
  },
});

export const storiesRoutes = stories
  .openapi(listOwnRoute, async (c) =>
    c.json(await listOwnStories(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(listHighlightsRoute, async (c) => {
    const ctx = c.get('ctx');
    const { communityId, scope } = c.req.valid('query');
    const granted = await permissionsForRequest(ctx);
    const curator = granted.includes('stories.story.manage');
    // `scope=all` is the curator's read (empty highlights included); it cannot widen a member's.
    if (scope === 'all' && !curator) throw new ApiError(403, 'FORBIDDEN');
    return c.json(
      await listHighlights(ctx, { communityId: communityId ?? null, curator: scope === 'all' }),
      200,
    );
  })
  .openapi(highlightCatalogRoute, async (c) =>
    c.json(await listHighlightCatalog(c.get('ctx')), 200),
  )
  .openapi(reorderHighlightsRoute, async (c) =>
    c.json(await reorderHighlights(c.get('ctx'), c.req.valid('json')), 200),
  )
  .openapi(getHighlightRoute, async (c) => {
    const ctx = c.get('ctx');
    const { highlightId } = c.req.valid('param');
    const granted = await permissionsForRequest(ctx);
    const curator = granted.includes('stories.story.manage');
    return c.json(await getHighlight(ctx, highlightId, { curator }), 200);
  })
  .openapi(createHighlightRoute, async (c) =>
    c.json(await createHighlight(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(addHighlightItemRoute, async (c) => {
    const { highlightId, storyId } = c.req.valid('param');
    return c.json(await addStoryToHighlight(c.get('ctx'), highlightId, storyId), 200);
  })
  .openapi(updateHighlightRoute, async (c) => {
    const { highlightId } = c.req.valid('param');
    return c.json(await updateHighlight(c.get('ctx'), highlightId, c.req.valid('json')), 200);
  })
  .openapi(deleteHighlightRoute, async (c) => {
    const { highlightId } = c.req.valid('param');
    await deleteHighlight(c.get('ctx'), highlightId);
    return c.body(null, 204);
  })
  .openapi(removeHighlightItemRoute, async (c) => {
    const { highlightId, storyId } = c.req.valid('param');
    return c.json(await removeStoryFromHighlight(c.get('ctx'), highlightId, storyId), 200);
  })
  .openapi(markSeenRoute, async (c) => {
    await markStoriesSeen(c.get('ctx'), c.req.valid('json').storyIds);
    return c.body(null, 204);
  })
  .openapi(listRoute, async (c) =>
    c.json(await listActiveStories(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(getStoryRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    return c.json(await getStory(c.get('ctx'), storyId), 200);
  })
  .openapi(publishStoryRoute, async (c) => {
    const ctx = c.get('ctx');
    const body = c.req.valid('json');
    // 05.1 (OQ-1) / 05.2 (D-113): putting a story somewhere AT PUBLISH — a highlight, or a highlight
    // created inline — is curation, the manage half. The middleware keeps the publish literal; this
    // second check runs whenever EITHER destination key is present, BEFORE any lookup, so a
    // publish-only caller learns nothing about the id it sent (T-05.1-05, T-05.2-32).
    if (body.highlightId !== undefined || body.newHighlight !== undefined) {
      const granted = await permissionsForRequest(ctx);
      if (!granted.includes('stories.story.manage')) throw new ApiError(403, 'FORBIDDEN');
    }
    return c.json(await publishStory(ctx, body), 201);
  })
  .openapi(deleteStoryRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    await deleteStory(c.get('ctx'), storyId);
    return c.body(null, 204);
  })
  .openapi(likeStoryRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    return c.json(await likeStory(c.get('ctx'), storyId), 200);
  })
  .openapi(unlikeStoryRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    return c.json(await unlikeStory(c.get('ctx'), storyId), 200);
  })
  .openapi(listCommentsRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    return c.json(await listStoryComments(c.get('ctx'), storyId, c.req.valid('query')), 200);
  })
  .openapi(createCommentRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    return c.json(await createStoryComment(c.get('ctx'), storyId, c.req.valid('json')), 201);
  })
  .openapi(deleteCommentRoute, async (c) => {
    const { storyId, commentId } = c.req.valid('param');
    await deleteStoryComment(c.get('ctx'), storyId, commentId);
    return c.body(null, 204);
  })
  .openapi(storyHighlightIdsRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    return c.json(await listStoryHighlightIds(c.get('ctx'), storyId), 200);
  });
