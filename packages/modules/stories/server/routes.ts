import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@tria/core/server/auth/context';
import { requireAuth } from '@tria/core/server/auth/require-auth';
import { ApiError } from '@tria/core/server/http/api-error';
import { requireModule } from '@tria/core/server/modules/require-module';
import { requirePermission } from '@tria/core/server/rbac/permissions';
import {
  createStoryCommentSchema,
  publishStorySchema,
  STORY_ISSUE_SET,
  storyCommentPageSchema,
  storyCommentSchema,
  storyCommentsQuerySchema,
  storyLikeResultSchema,
  storyPageSchema,
  storyQuerySchema,
  storySummarySchema,
} from '../contracts/index';
import {
  createStoryComment,
  deleteStory,
  deleteStoryComment,
  getStory,
  likeStory,
  listActiveStories,
  listOwnStories,
  listStoryComments,
  publishStory,
  unlikeStory,
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
 */
const stories = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
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

/** The story id every story-scoped route takes; a miss is a bare 404 (D-23). */
const storyIdParam = z.object({ storyId: z.uuid() });

const getStoryRoute = createRoute({
  method: 'get',
  path: '/{storyId}',
  request: { params: storyIdParam },
  responses: {
    200: {
      description:
        'One story, ACTIVE OR NOT — the viewer opens an expired story from the history and 05-08 pins one to a community. The strip is what filters; this read never does.',
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
        '`VALIDATION_FAILED` with `details.story` carrying exactly one machine code: `media_required` (a story with no media has nothing to show) or `media_invalid` (an asset of this tenant whose purpose is not `story`, or whose kind does not match).',
    },
    403: { description: 'The caller does not hold `stories.story.publish` in this tenant' },
    404: {
      description:
        'The media asset is unknown, another tenant’s, or removed. One bare code, no details (T-05-26).',
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
 * read; 05-08 pins expired stories to communities, and an affordance that answered 400 there would
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
 * read and nothing else, and 05-08 pins expired stories to communities.
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

export const storiesRoutes = stories
  .openapi(listOwnRoute, async (c) =>
    c.json(await listOwnStories(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(listRoute, async (c) =>
    c.json(await listActiveStories(c.get('ctx'), c.req.valid('query')), 200),
  )
  .openapi(getStoryRoute, async (c) => {
    const { storyId } = c.req.valid('param');
    return c.json(await getStory(c.get('ctx'), storyId), 200);
  })
  .openapi(publishStoryRoute, async (c) =>
    c.json(await publishStory(c.get('ctx'), c.req.valid('json')), 201),
  )
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
  });
