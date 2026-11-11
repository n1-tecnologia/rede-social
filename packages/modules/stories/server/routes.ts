import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import {
  permissionsForRequest,
  requirePermission,
} from '@rede-social/core/server/rbac/permissions';
import {
  authorStoriesSchema,
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
  storyAuthorsPageSchema,
  storyAuthorsQuerySchema,
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
  type HighlightCaller,
  likeStory,
  listActiveStories,
  listAuthorStories,
  listHighlightCatalog,
  listHighlights,
  listOwnStories,
  listStoryAuthors,
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
  // 10-07 (D-714): any-of, literals. A holder of `stories.story.manage` keeps the ORGANIZATION history;
  // a member holding `stories.story.publish` (composed with `social`) gets THEIR OWN history.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
  request: { query: storyQuerySchema },
  responses: {
    200: {
      description:
        "For a holder of `stories.story.manage`: every ORGANIZATION story of the tenant (never a member's), expired ones included, newest window first. For any other holder of `stories.story.publish` (a member): that member's OWN stories, expired ones included, newest window first. `isActive` says which are still in the strip; `mediaStatus` / `mediaFailureReason` carry the Phase 3 processing and refusal state.",
      content: { 'application/json': { schema: storyPageSchema } },
    },
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish` in this tenant',
    },
  },
});

/* ── Explorar's story row (10-08, D-714, D-717, D-718) ─────────────────────────────────────────── */

/**
 * `GET /v1/stories/authors` and `GET /v1/stories/authors/{membershipId}`: declared BEFORE `/{storyId}` so the
 * literal `authors` segment is never captured as an id (the `/mine` rule).
 *
 * **Who may call.** A holder of `social.participate` (a member of a `social` tenant) reads the follow-bound
 * row; a holder of `moderation.manage` reads the moderator's all-members row (D-717). A caller holding
 * neither (a real `support_tenant`) is `403 FORBIDDEN`. The `social` switch and both permission flags are
 * read BEFORE the service opens its transaction (the pool is `max: 5`; see `readPlaceGate`), and `social`
 * off is `404 MODULE_DISABLED` for everyone: the row leaves Explorar while a story saved in a community
 * highlight stays readable through the highlight reads (D-718).
 */
const authorsAudience = async (ctx: AppEnv['Variables']['ctx']) => {
  // "Not here" before "not allowed" (the ROLE-06 order): with `social` off a member does not even hold
  // `social.participate`, so the permission check first would answer 403 where D-718 says 404.
  if (!(await moduleFlags.isEnabled(ctx, 'social'))) throw new ApiError(404, 'MODULE_DISABLED');
  const granted = await permissionsForRequest(ctx);
  const canModerate = granted.includes('moderation.manage');
  const isMember = granted.includes('social.participate');
  if (!canModerate && !isMember) throw new ApiError(403, 'FORBIDDEN');
  return { canModerate, isMember };
};

const listAuthorsRoute = createRoute({
  method: 'get',
  path: '/authors',
  request: { query: storyAuthorsQuerySchema },
  responses: {
    200: {
      description:
        "Explorar's story row, one circle per author. A member reads ONE unpaged page: their own circle first (when they have a live story), then the live authors they follow, unseen before seen, newest first, `membership_id` as the tiebreak. A holder of `moderation.manage` reads a keyset page (20 by default, `limit` 1..50) of every live member's circle, newest first, with `isSelf` false and no follow state. A story is in a circle only while `expires_at > now()`; a blocked, removed or viewer-blocked author has no circle. Nothing to show answers `{ items: [], nextCursor: null }`, never an error.",
      content: { 'application/json': { schema: storyAuthorsPageSchema } },
    },
    403: {
      description:
        'The caller holds neither `social.participate` nor `moderation.manage` (a real `support_tenant` session).',
    },
    404: {
      description: '`MODULE_DISABLED`: `social` is off for this tenant (D-718).',
    },
  },
});

const authorStoriesRoute = createRoute({
  method: 'get',
  path: '/authors/{membershipId}',
  request: { params: z.object({ membershipId: z.uuid() }) },
  responses: {
    200: {
      description:
        "One author's live stories, oldest first, in the story projection (`viewerSeen` included). The group a circle opens lazily.",
      content: { 'application/json': { schema: authorStoriesSchema } },
    },
    403: {
      description:
        'The caller holds neither `social.participate` nor `moderation.manage` (a real `support_tenant` session).',
    },
    404: {
      description:
        '`MODULE_DISABLED` when `social` is off; otherwise the bare `NOT_FOUND` with no `details` when the caller can read no live story of that membership: a stranger, an expired story, a blocked, removed or viewer-blocked author, an unknown or another tenant’s id (D-23, T-10-30).',
    },
  },
});

/* ── Highlights (05.2, HIGHLIGHT-01/02, D-100..D-103) ─────────────────────────────────────────── */

/**
 * ALL of them are declared BEFORE `/{storyId}` so the literal `highlights` segment wins the match: it is
 * not a uuid, so the param route would 400 on it rather than falling through.
 *
 * The two READS carry no permission — every member of the tenant sees a place's highlights, exactly
 * as they see its stories — while every WRITE (and the curator's catalog, order and memberships reads)
 * carries the any-of middleware `requirePermission('stories.story.manage', 'stories.story.publish')`,
 * spelled out as a literal at each call site because it is the one string a reviewer greps for when
 * asking "what guards curating highlights?" (10-09, D-713: a creator curates their own community's
 * highlights, so `stories.story.publish` joins `stories.story.manage`). The guard only says "may curate
 * at all": WHICH place the caller may curate is the in-handler check, `resolveHighlight` /
 * `resolveHighlightPlace`, the ONE service seam every handler reaches.
 *
 * Every handler reads the two flags once through `highlightCaller(ctx)` (`permissionsForRequest`) and
 * hands them to the service: the service never compares roles or permissions, it honours the flags and
 * computes `curator` itself, per place.
 *
 * Every miss — unknown, another tenant's, a removed community, the `communities` module off, and
 * for a member an EMPTY highlight — is ONE bare 404 with no `details` (D-23). The only 400 codes are
 * the closed `details.highlight` vocabulary.
 */
const highlightIdParam = z.object({ highlightId: z.uuid() });

/**
 * 10-09 (D-706, T-05-03): the two permission flags every highlight function needs, read through the
 * composed set BEFORE the service opens its transaction (the pool is `max: 5`; see `readPlaceGate`).
 * The service honours the flags and never compares a role: the place rules (an organization place needs
 * the manage half, a member community needs its creator holding the publish half) live in ONE seam,
 * `resolveHighlightPlace`.
 */
const highlightCaller = async (ctx: AppEnv['Variables']['ctx']): Promise<HighlightCaller> => {
  const granted = await permissionsForRequest(ctx);
  return {
    canManage: granted.includes('stories.story.manage'),
    canPublish: granted.includes('stories.story.publish'),
  };
};

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
 * on them rather than falling through. Both take the any-of literal middleware (T-05.2-11, 10-09).
 */
const highlightCatalogRoute = createRoute({
  method: 'get',
  path: '/highlights/catalog',
  // 10-09 (D-713): any-of, literals. The guard only says "may curate highlights at all"; WHICH place the caller
  // may curate is the service's place seam (`resolveHighlight` / `resolveHighlightPlace`), reached by every handler.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
  responses: {
    200: {
      description:
        'Every highlight the "add to highlight" sheet may offer (D-110), in ONE statement: Início’s first, then each ACTIVE community’s, ordered by community, position and id. Highlights of archived or removed communities are absent, and with the `communities` module off no community highlight is listed (their rows are untouched). Empty highlights are included — this is the curator’s read.',
      content: { 'application/json': { schema: highlightListSchema } },
    },
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish`, or may not curate THIS place: Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). Checked after the 404 of a place that does not exist.',
    },
  },
});

const reorderHighlightsRoute = createRoute({
  method: 'put',
  path: '/highlights/order',
  // 10-09 (D-713): any-of, literals. The guard only says "may curate highlights at all"; WHICH place the caller
  // may curate is the service's place seam (`resolveHighlight` / `resolveHighlightPlace`), reached by every handler.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
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
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish`, or may not curate THIS place: Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). Checked after the 404 of a place that does not exist.',
    },
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
  // 10-09 (D-713): any-of, literals. The guard only says "may curate highlights at all"; WHICH place the caller
  // may curate is the service's place seam (`resolveHighlight` / `resolveHighlightPlace`), reached by every handler.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
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
        '`VALIDATION_FAILED` with `details.highlight` carrying exactly one machine code: `title_invalid` (empty after trimming, or longer than 50), `archived` (the community is archived and takes no new content) or `full` (the place already holds 50 highlights). Nothing is written.',
    },
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish`, or may not curate THIS place: Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). Checked after the 404 of a place that does not exist.',
    },
    404: {
      description:
        'The named community is unknown, another tenant’s, removed, or the `communities` module is off. One bare code, no details (D-23).',
    },
  },
});

const addHighlightItemRoute = createRoute({
  method: 'put',
  path: '/highlights/{highlightId}/stories/{storyId}',
  // 10-09 (D-713): any-of, literals. The guard only says "may curate highlights at all"; WHICH place the caller
  // may curate is the service's place seam (`resolveHighlight` / `resolveHighlightPlace`), reached by every handler.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
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
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish`, or may not curate THIS place: Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). Checked after the 404 of a place that does not exist.',
    },
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
  // 10-09 (D-713): any-of, literals. The guard only says "may curate highlights at all"; WHICH place the caller
  // may curate is the service's place seam (`resolveHighlight` / `resolveHighlightPlace`), reached by every handler.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
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
        '`VALIDATION_FAILED` with `details.highlight` = `title_invalid` (empty after trimming, or longer than 50) or `archived` (the highlight’s community is archived and takes no curation); or with `details.issues` for a body naming neither `title` nor `cover`. Nothing is written.',
    },
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish`, or may not curate THIS place: Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). Checked after the 404 of a place that does not exist.',
    },
    404: {
      description:
        'The highlight, the cover story or the cover asset is unknown, another tenant’s, removed, a video, not in this highlight, not a ready cover image — or the highlight’s community is removed or the `communities` module is off. ONE bare code for all of them, no details (D-23).',
    },
  },
});

const deleteHighlightRoute = createRoute({
  method: 'delete',
  path: '/highlights/{highlightId}',
  // 10-09 (D-713): any-of, literals. The guard only says "may curate highlights at all"; WHICH place the caller
  // may curate is the service's place seam (`resolveHighlight` / `resolveHighlightPlace`), reached by every handler.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
  request: { params: highlightIdParam },
  responses: {
    204: {
      description:
        'The highlight is deleted with its items. Its STORIES, their likes and their comments are never touched — a highlight is an editorial pointer. Allowed on an archived community (take-down must stay possible).',
    },
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish`, or may not curate THIS place: Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). Checked after the 404 of a place that does not exist.',
    },
    404: {
      description:
        'No highlight with that id is visible to this tenant — unknown, another tenant’s, ALREADY deleted, in a removed community, or the `communities` module is off. One bare code, no details (D-23).',
    },
  },
});

const removeHighlightItemRoute = createRoute({
  method: 'delete',
  path: '/highlights/{highlightId}/stories/{storyId}',
  // 10-09 (D-713): any-of, literals. The guard only says "may curate highlights at all"; WHICH place the caller
  // may curate is the service's place seam (`resolveHighlight` / `resolveHighlightPlace`), reached by every handler.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
  request: { params: highlightIdParam.extend({ storyId: z.uuid() }) },
  responses: {
    // Deliberately NO 400: removing a story is a TAKE-DOWN, allowed on an archived community.
    200: {
      description:
        'The story is out of the highlight. `highlightCount` is how many highlights the STORY is still in. Idempotent: removing a pair that is not there answers the identical body and announces nothing. The story row is never changed, and the highlight is kept even when this removed its last story. If the story was the chosen cover, the highlight returns to its automatic cover.',
      content: { 'application/json': { schema: highlightMembershipResultSchema } },
    },
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish`, or may not curate THIS place: Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). Checked after the 404 of a place that does not exist.',
    },
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
        '`VALIDATION_FAILED` with `details.story` carrying exactly one machine code: `media_required` (a story with no media has nothing to show) or `media_invalid` (an asset of this tenant whose purpose is not `story`, or whose kind does not match). With a highlight destination, `details.highlight` carries `archived` (the destination community is archived), `title_invalid` (`newHighlight.title` is empty after trimming or longer than 50) or `full` (the highlight or the place is at its cap). Naming both destinations, or any unknown key (05.1’s retired `communityId` included), is a plain `VALIDATION_FAILED`. In every case NO story, highlight or item is written.',
    },
    403: {
      description:
        'The caller does not hold `stories.story.publish` in this tenant — or the body names a destination (`highlightId` or `newHighlight`) in a place the caller may not curate (10-09, D-706): Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). A destination that does not exist is the bare 404 first.',
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
  // 10-07 (D-711): any-of, literals. The guard only says "may act on stories at all"; WHICH story the
  // caller may delete is decided in the service under the row lock from the two flags computed below.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
  request: { params: storyIdParam },
  responses: {
    204: {
      description:
        'The story is SOFT-deleted: the row stays, so the likes and comments members left on it survive and Phase 8 moderation can still read it. The AUTHOR may delete their own story; a holder of `moderation.manage` may delete any MEMBER story (one `moderation_log` row, subject `story`, commits in the same transaction and the author is not told); a holder of `stories.story.manage` deletes an ORGANIZATION story (no row).',
    },
    403: {
      description:
        'The caller holds neither permission, or the story is one they can read but may not delete (another member’s, or an organization story for a member).',
    },
    404: {
      description:
        'No story with that id is visible to this lane — unknown, another tenant’s, not readable by the caller, or already removed. One bare code, no details (D-23).',
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

/**
 * 08-03 (D-336, D-338, T-08-14): whether this caller may remove OTHER people's story comments — the
 * kernel `moderation.manage`, read through the composed permission set BEFORE the service opens its
 * transaction (on a flags-cache miss `permissionsForRequest` opens its own tenant transaction, and
 * holding two of the pool's five connections per request is the starvation `readPlaceGate` avoids).
 * The list uses it too, so each row's `removal` (UI-D-276) and the delete agree.
 */
const canModerateComments = async (ctx: AppEnv['Variables']['ctx']) =>
  (await permissionsForRequest(ctx)).includes('moderation.manage');

const deleteCommentRoute = createRoute({
  method: 'delete',
  path: '/{storyId}/comments/{commentId}',
  request: { params: storyIdParam.extend({ commentId: z.uuid() }) },
  responses: {
    204: {
      description:
        "The comment is SOFT-deleted (`deleted_at`, `deleted_by_user_id`) and the story's count moves exactly once, on the `deleted_at` transition. A caller holding `moderation.manage` may remove anyone's comment; when it is not their own, one `moderation_log` row (`subject_type = 'story_comment'`) commits in the same transaction. The response is identical either way and the author is not notified (D-335).",
    },
    404: {
      description:
        'Unknown, not on this story, already removed, or someone else’s comment for a caller without `moderation.manage` — ONE branch, so a member cannot probe whether a comment exists (T-04-16, T-08-14).',
    },
  },
});

/* ── Highlight memberships (05.2, D-110) ─────────────────────────────────────────────────────── */

const storyHighlightIdsRoute = createRoute({
  method: 'get',
  path: '/{storyId}/highlights',
  // 10-09 (D-713): any-of, literals. The guard only says "may curate highlights at all"; WHICH place the caller
  // may curate is the service's place seam (`resolveHighlight` / `resolveHighlightPlace`), reached by every handler.
  middleware: [requirePermission('stories.story.manage', 'stories.story.publish')] as const,
  request: { params: storyIdParam },
  responses: {
    200: {
      description:
        'The ids of the highlights this story is in — the shared sheet’s initial state (D-110). Ids only: the sheet already holds the titles from the catalogue.',
      content: { 'application/json': { schema: storyHighlightIdsSchema } },
    },
    403: {
      description:
        'The caller holds neither `stories.story.manage` nor `stories.story.publish`, or may not curate THIS place: Início or an organization community without `stories.story.manage`, or a member community that is not the caller’s own (an admin included). Checked after the 404 of a place that does not exist.',
    },
    404: { description: 'No story with that id is visible to this tenant (D-23).' },
  },
});

export const storiesRoutes = stories
  .openapi(listOwnRoute, async (c) => {
    const ctx = c.get('ctx');
    // The route reads the permission set; the service honours the flag (it never compares a role).
    const canManage = (await permissionsForRequest(ctx)).includes('stories.story.manage');
    return c.json(await listOwnStories(ctx, c.req.valid('query'), { canManage }), 200);
  })
  .openapi(listAuthorsRoute, async (c) => {
    const ctx = c.get('ctx');
    const scope = await authorsAudience(ctx);
    return c.json(await listStoryAuthors(ctx, c.req.valid('query'), scope), 200);
  })
  .openapi(authorStoriesRoute, async (c) => {
    const ctx = c.get('ctx');
    const { membershipId } = c.req.valid('param');
    const { canModerate } = await authorsAudience(ctx);
    return c.json(await listAuthorStories(ctx, membershipId, { canModerate }), 200);
  })
  .openapi(listHighlightsRoute, async (c) => {
    const ctx = c.get('ctx');
    const { communityId, scope } = c.req.valid('query');
    // `scope=all` is the curator's read (empty highlights included); it cannot widen anyone else's. WHO the
    // curator is depends on the PLACE, so the service decides (404 for a miss, then 403) from the two flags.
    const caller = await highlightCaller(ctx);
    return c.json(
      await listHighlights(ctx, { communityId: communityId ?? null, all: scope === 'all' }, caller),
      200,
    );
  })
  .openapi(highlightCatalogRoute, async (c) => {
    const ctx = c.get('ctx');
    return c.json(await listHighlightCatalog(ctx, await highlightCaller(ctx)), 200);
  })
  .openapi(reorderHighlightsRoute, async (c) => {
    const ctx = c.get('ctx');
    return c.json(
      await reorderHighlights(ctx, c.req.valid('json'), await highlightCaller(ctx)),
      200,
    );
  })
  .openapi(getHighlightRoute, async (c) => {
    const ctx = c.get('ctx');
    const { highlightId } = c.req.valid('param');
    return c.json(await getHighlight(ctx, highlightId, await highlightCaller(ctx)), 200);
  })
  .openapi(createHighlightRoute, async (c) => {
    const ctx = c.get('ctx');
    return c.json(await createHighlight(ctx, c.req.valid('json'), await highlightCaller(ctx)), 201);
  })
  .openapi(addHighlightItemRoute, async (c) => {
    const ctx = c.get('ctx');
    const { highlightId, storyId } = c.req.valid('param');
    return c.json(
      await addStoryToHighlight(ctx, highlightId, storyId, await highlightCaller(ctx)),
      200,
    );
  })
  .openapi(updateHighlightRoute, async (c) => {
    const ctx = c.get('ctx');
    const { highlightId } = c.req.valid('param');
    return c.json(
      await updateHighlight(ctx, highlightId, c.req.valid('json'), await highlightCaller(ctx)),
      200,
    );
  })
  .openapi(deleteHighlightRoute, async (c) => {
    const ctx = c.get('ctx');
    const { highlightId } = c.req.valid('param');
    await deleteHighlight(ctx, highlightId, await highlightCaller(ctx));
    return c.body(null, 204);
  })
  .openapi(removeHighlightItemRoute, async (c) => {
    const ctx = c.get('ctx');
    const { highlightId, storyId } = c.req.valid('param');
    return c.json(
      await removeStoryFromHighlight(ctx, highlightId, storyId, await highlightCaller(ctx)),
      200,
    );
  })
  .openapi(markSeenRoute, async (c) => {
    const ctx = c.get('ctx');
    const audience = { canModerate: await canModerateComments(ctx) };
    await markStoriesSeen(ctx, c.req.valid('json').storyIds, audience);
    return c.body(null, 204);
  })
  .openapi(listRoute, async (c) =>
    c.json(await listActiveStories(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(getStoryRoute, async (c) => {
    const ctx = c.get('ctx');
    const { storyId } = c.req.valid('param');
    return c.json(
      await getStory(ctx, storyId, { canModerate: await canModerateComments(ctx) }),
      200,
    );
  })
  .openapi(publishStoryRoute, async (c) => {
    const ctx = c.get('ctx');
    const body = c.req.valid('json');
    // 10-09 (D-706, D-716): putting a story somewhere AT PUBLISH — a highlight, or a highlight created
    // inline — is curation of that PLACE. The middleware keeps the publish literal; the place check (an
    // organization place needs the manage half, a member community needs its creator) is the service's
    // ONE seam, `resolveHighlightPlace`, so this handler only hands over the two flags. Replaces 05.2's
    // route-level manage check, which answered 403 before any lookup (T-05.1-05, T-05.2-32): a destination
    // that does not exist is now the bare 404 first, then the 403 for a place the caller may not curate.
    const caller =
      body.highlightId !== undefined || body.newHighlight !== undefined
        ? await highlightCaller(ctx)
        : undefined;
    return c.json(await publishStory(ctx, body, caller), 201);
  })
  .openapi(deleteStoryRoute, async (c) => {
    const ctx = c.get('ctx');
    const { storyId } = c.req.valid('param');
    // Read BEFORE the service opens its transaction (the pool is `max: 5`; see `readPlaceGate`).
    const granted = await permissionsForRequest(ctx);
    await deleteStory(ctx, storyId, {
      canManage: granted.includes('stories.story.manage'),
      canModerate: granted.includes('moderation.manage'),
    });
    return c.body(null, 204);
  })
  .openapi(likeStoryRoute, async (c) => {
    const ctx = c.get('ctx');
    const { storyId } = c.req.valid('param');
    return c.json(
      await likeStory(ctx, storyId, { canModerate: await canModerateComments(ctx) }),
      200,
    );
  })
  .openapi(unlikeStoryRoute, async (c) => {
    const ctx = c.get('ctx');
    const { storyId } = c.req.valid('param');
    return c.json(
      await unlikeStory(ctx, storyId, { canModerate: await canModerateComments(ctx) }),
      200,
    );
  })
  .openapi(listCommentsRoute, async (c) => {
    const ctx = c.get('ctx');
    const { storyId } = c.req.valid('param');
    const opts = { canModerate: await canModerateComments(ctx) };
    return c.json(await listStoryComments(ctx, storyId, c.req.valid('query'), opts), 200);
  })
  .openapi(createCommentRoute, async (c) => {
    const ctx = c.get('ctx');
    const { storyId } = c.req.valid('param');
    const audience = { canModerate: await canModerateComments(ctx) };
    return c.json(await createStoryComment(ctx, storyId, c.req.valid('json'), audience), 201);
  })
  .openapi(deleteCommentRoute, async (c) => {
    const ctx = c.get('ctx');
    const { storyId, commentId } = c.req.valid('param');
    await deleteStoryComment(ctx, storyId, commentId, {
      canModerate: await canModerateComments(ctx),
    });
    return c.body(null, 204);
  })
  .openapi(storyHighlightIdsRoute, async (c) => {
    const ctx = c.get('ctx');
    const { storyId } = c.req.valid('param');
    return c.json(await listStoryHighlightIds(ctx, storyId, await highlightCaller(ctx)), 200);
  });
