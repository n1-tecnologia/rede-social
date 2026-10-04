import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { AppEnv } from '@rede-social/core/server/auth/context';
import { requireAuth } from '@rede-social/core/server/auth/require-auth';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { requireModule } from '@rede-social/core/server/modules/require-module';
import { requirePermission } from '@rede-social/core/server/rbac/permissions';
import {
  commentPageSchema,
  commentSchema,
  commentsQuerySchema,
  commentThreadSchema,
  createCommentSchema,
  createPostSchema,
  FEED_COMMUNITY_ISSUES,
  FEED_MEDIA_ISSUES,
  feedPageSchema,
  feedPostSchema,
  feedQuerySchema,
  likeResultSchema,
  repliesQuerySchema,
  updatePostSchema,
  videoCommunitiesSchema,
} from '../contracts/index';
import {
  createComment,
  createPost,
  deleteComment,
  getCommentThread,
  getPost,
  likeComment,
  likePost,
  listComments,
  listCommunityFeed,
  listFeed,
  listReplies,
  listVideoCommunities,
  softDeletePost,
  unlikeComment,
  unlikePost,
  updatePost,
} from './service';

/**
 * The module owns its guard chain: the mount in `apps/api/src/app.ts` is a plain
 * `.route('/v1/feed', feedRoutes)` and cannot forget a guard, because they live here.
 *
 * Order is the ROLE-06 order extended by one, and it matters: `requireAuth` (401 without a session)
 * -> `requireModule` (404 when the tenant does not have the feed — never 403, so a member cannot
 * tell "not allowed" from "not here") -> `requirePermission` on the write route only (403).
 *
 * The write guard is a PERMISSION, never `requireRole` (FEED-08, T-04-03): a role comparison would
 * hard-code V1's "only the admin publishes" into the route, and flipping
 * `tenant_modules['feed'].settings.postingPolicy` to `'members'` would then still need a code change.
 */
/**
 * The media refusals `createPostSchema`'s refinement raises, as a lookup. The refinement carries the
 * MACHINE CODE as its issue `message` (there is nowhere else on a Zod issue to put one), and this
 * hook lifts it to `details.media` so the web switches on the same closed vocabulary the service
 * uses when it refuses the same shape — one code per rule, whichever layer caught it.
 */
const MEDIA_ISSUE_SET: ReadonlySet<string> = new Set(FEED_MEDIA_ISSUES);

/**
 * The same lift for COMM-04's destination vocabulary. It is a SECOND set rather than one merged
 * bag because the two land on different `details` KEYS (`details.media` vs `details.community`), and
 * the web switches on each exhaustively: merging them would let a media code surface as a community
 * refusal the day someone reuses a word.
 */
const COMMUNITY_ISSUE_SET: ReadonlySet<string> = new Set(FEED_COMMUNITY_ISSUES);

const feed = new OpenAPIHono<AppEnv>({
  defaultHook: (result) => {
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      const media = messages.find((message) => MEDIA_ISSUE_SET.has(message));
      if (media) throw new ApiError(400, 'VALIDATION_FAILED', { media });
      const community = messages.find((message) => COMMUNITY_ISSUE_SET.has(message));
      if (community) throw new ApiError(400, 'VALIDATION_FAILED', { community });
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      });
    }
  },
});

feed.use('*', requireAuth, requireModule('feed'));

const listRoute = createRoute({
  method: 'get',
  path: '/',
  request: { query: feedQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the tenant's feed, newest first. `nextCursor` is non-null exactly when another post exists; it is OPAQUE and must be passed back untouched.\n\nWithout `communityId` this is the MERGED feed (D-73): tenant-wide posts and community posts interleaved by `created_at desc, id desc`, with no per-source cap and no ranking. Every item carries `community` — `null` for a tenant-wide post, `{ id, name, slug }` for a community post (D-71). When the tenant does not have the `communities` module the same endpoint returns only tenant-wide posts and the community rows are untouched (D-74).\n\nWith `communityId` it is that community's own posts, same ordering and same cursor envelope (COMM-03).\n\nWith `media=video` either page is narrowed to posts whose `mediaKind` is `video` and whose video asset is `ready` — same ordering, same cursor envelope (REELS-03); a video still transcoding is absent here while the unfiltered feed lists it. Any other `media` value is a 400.",
      content: { 'application/json': { schema: feedPageSchema } },
    },
    404: {
      description:
        "`communityId` names no community visible to this tenant — unknown, another tenant's, removed, or the tenant does not have the `communities` module. One bare code, no details (D-23).",
    },
  },
});

/**
 * REELS-04's lanes read (D-119). A sibling path rather than a `listRoute` parameter because it is
 * not a page of posts: no cursor, a different item shape, and a different empty answer (200 `[]`
 * with communities off, where the community page answers 404). It inherits the file's
 * `requireAuth, requireModule('feed')` guard, so with feed off it is the same 404 as every feed route.
 */
const videoCommunitiesRoute = createRoute({
  method: 'get',
  path: '/video-communities',
  responses: {
    200: {
      description:
        "The communities worth a Reels lane (D-117, D-119): this tenant's ACTIVE, not-removed communities holding at least one post whose video is `ready` — the same predicate `GET /v1/feed?media=video&communityId=` pages on, so every lane opens with at least one item. Ordered `position asc, last_activity_at desc, id desc` (D-76 and 2026-10-03, the Comunidades list's own order: the admin's order, then the activity), at most 50 rows. Takes no parameter.\n\nWhen the tenant does not have the `communities` module the answer is `{ items: [] }` — 200, never 404 — so the lane row simply hides (D-120).",
      content: { 'application/json': { schema: videoCommunitiesSchema } },
    },
  },
});

const getPostRoute = createRoute({
  method: 'get',
  path: '/posts/{postId}',
  request: { params: z.object({ postId: z.uuid() }) },
  responses: {
    200: {
      description: 'One post',
      content: { 'application/json': { schema: feedPostSchema } },
    },
    404: {
      description:
        'No post with that id is visible to this tenant — unknown, another tenant’s, or removed. One bare code, no details (D-23).',
    },
  },
});

const createPostRoute = createRoute({
  method: 'post',
  path: '/posts',
  // The literal, not `FEED_PERMISSIONS.create`: this string is the one thing a reviewer greps for
  // when asking "what guards publishing?", and an indirection here is the kind that hides a change.
  middleware: [requirePermission('feed.post.create')] as const,
  request: {
    body: { content: { 'application/json': { schema: createPostSchema } }, required: true },
  },
  responses: {
    201: {
      description: 'The created post, in the same shape the feed list returns',
      content: { 'application/json': { schema: feedPostSchema } },
    },
    400: {
      description:
        "`VALIDATION_FAILED` with `details.media` carrying exactly one machine code: `gallery_and_video` (D-53 — photos and a video on one post, refused by the schema AND by `feed_post_media_kind_fk`), `too_many_images`, `too_many_attachments`, or `asset_not_usable` (an asset that is not this tenant's, not the right kind/purpose, or not in a usable status — ONE code for all of them, and no id echoed back).\n\nOr `details.community = 'archived'` (COMM-04): the named community exists in this tenant but has been archived, so it accepts no new posts. That is the ONLY distinguishable community refusal — see the 404.",
    },
    403: {
      description: "The tenant's posting policy does not grant this caller `feed.post.create`",
    },
    404: {
      description:
        "`communityId` names no community visible to this tenant — unknown, another tenant's, or removed. One BARE code with no `details` for all three (D-23, T-05-13), so the composer cannot enumerate another organisation's containers.",
    },
  },
});

/** The post id every post-scoped route takes; a miss is a bare 404 (D-23). */
const postIdParam = z.object({ postId: z.uuid() });

/**
 * FEED-03's two write routes.
 *
 * **The permission is on the route; the AUTHORSHIP is in the statement.** `feed.post.manage` says
 * "this role may manage posts" and is what a tenant grants (never `requireRole`, FEED-08/T-04-03);
 * `updatePost`/`softDeletePost` additionally carry `author_user_id = ctx.userId` in their own `where`
 * clause, which is what stops a SECOND `admin_tenant` of the same tenant from editing or removing a
 * colleague's post in V1 (T-04-54). Phase 8 widens moderation by granting a permission and relaxing
 * that predicate deliberately — not by discovering the route was already open.
 */
const updatePostRoute = createRoute({
  method: 'patch',
  path: '/posts/{postId}',
  // The literal, not `FEED_PERMISSIONS.manage`: this string is the one thing a reviewer greps for.
  middleware: [requirePermission('feed.post.manage')] as const,
  request: {
    params: postIdParam,
    body: { content: { 'application/json': { schema: updatePostSchema } }, required: true },
  },
  responses: {
    200: {
      description:
        'The updated post, in the same shape the feed list returns. `editedAt` is set on ANY persisted change, media included (UI-D-15) — re-saving identical content still advances it.',
      content: { 'application/json': { schema: feedPostSchema } },
    },
    400: {
      description:
        "`VALIDATION_FAILED`. `details.media` carries one of the create path's machine codes; an edit that would leave the post with neither a caption nor any media answers `details.issues` with `empty_post`, exactly as the create path does.",
    },
    403: { description: 'The caller does not hold `feed.post.manage` in this tenant' },
    404: {
      description:
        "Not this author's post, unknown, another tenant's, or soft-deleted — ONE bare code for all four, with no `details` (D-23). A soft delete therefore WINS a concurrent edit: the update's predicate carries `deleted_at is null`, so the edit touches zero rows.",
    },
  },
});

const deletePostRoute = createRoute({
  method: 'delete',
  path: '/posts/{postId}',
  middleware: [requirePermission('feed.post.manage')] as const,
  request: { params: postIdParam },
  responses: {
    200: {
      description:
        'The post was SOFT-deleted (FEED-03). The row keeps its `deleted_at` stamp, and its media rows, comments and assets are left for Phase 8 moderation and the Phase 3 sweeper.',
      content: { 'application/json': { schema: z.object({ deleted: z.literal(true) }).strict() } },
    },
    403: { description: 'The caller does not hold `feed.post.manage` in this tenant' },
    404: {
      description:
        "Not this author's post, unknown, another tenant's, or ALREADY removed — one bare code for all four, which is what makes a repeat delete a no-op with no second event.",
    },
  },
});

/* ── Interactions (FEED-04, FEED-05, FEED-06) ─────────────────────────────────────────────────── */

/**
 * Every route below is MEMBER-REACHABLE: `requireAuth` + `requireModule('feed')` and nothing else.
 * There is deliberately no per-route permission — the posting policy gates AUTHORING a post, not
 * interacting with one, and every member of the tenant may like and comment (FEED-04/05/06).
 *
 * Two response facts a reader should not have to dig for:
 *  - a like or unlike ALWAYS answers 200 with the current `{ liked, likeCount }`. A repeat is a
 *    no-op, not a conflict — there is no conflict status anywhere in this file, on purpose;
 *  - a miss is a BARE 404 with no `details` (unknown id, another tenant's, removed, or — for a
 *    delete — someone else's). Only the reply-depth refusal carries a machine code.
 */
const commentIdParam = z.object({ commentId: z.uuid() });

const likeResponses = {
  200: {
    description:
      'The CURRENT state after the toggle, read back in the same transaction. Idempotent: a repeat returns the identical body.',
    content: { 'application/json': { schema: likeResultSchema } },
  },
  404: {
    description: 'No such post/comment is visible to this tenant — unknown, foreign, or removed.',
  },
} as const;

const likePostRoute = createRoute({
  method: 'post',
  path: '/posts/{postId}/like',
  request: { params: postIdParam },
  responses: likeResponses,
});

const unlikePostRoute = createRoute({
  method: 'delete',
  path: '/posts/{postId}/like',
  request: { params: postIdParam },
  responses: likeResponses,
});

const likeCommentRoute = createRoute({
  method: 'post',
  path: '/comments/{commentId}/like',
  request: { params: commentIdParam },
  responses: likeResponses,
});

const unlikeCommentRoute = createRoute({
  method: 'delete',
  path: '/comments/{commentId}/like',
  request: { params: commentIdParam },
  responses: likeResponses,
});

const listCommentsRoute = createRoute({
  method: 'get',
  path: '/posts/{postId}/comments',
  request: { params: postIdParam, query: commentsQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of the post's ROOT comments, newest first (D-62). Replies are not included — `replyCount` says how many there are and `/comments/{commentId}/replies` fetches them.",
      content: { 'application/json': { schema: commentPageSchema } },
    },
    404: { description: 'No such post is visible to this tenant.' },
  },
});

const createCommentRoute = createRoute({
  method: 'post',
  path: '/posts/{postId}/comments',
  request: {
    params: postIdParam,
    body: { content: { 'application/json': { schema: createCommentSchema } }, required: true },
  },
  responses: {
    201: {
      description: 'The created comment or reply, in the same shape the comment list returns',
      content: { 'application/json': { schema: commentSchema } },
    },
    400: {
      description:
        "`VALIDATION_FAILED` with `details.comment = 'reply_depth_exceeded'` when `parentId` names a reply: the DATABASE refused the second reply level (SQLSTATE 23503/23514) and this is its translation.",
    },
    404: {
      description:
        'No such post is visible to this tenant, or `parentId` is not a live comment on this post.',
    },
  },
});

const deleteCommentRoute = createRoute({
  method: 'delete',
  path: '/comments/{commentId}',
  request: { params: commentIdParam },
  responses: {
    200: {
      description: 'The comment was soft-deleted (D-61). The row stays for Phase 8 moderation.',
      content: { 'application/json': { schema: z.object({ deleted: z.literal(true) }).strict() } },
    },
    404: {
      description:
        "Not this member's comment, unknown, or already removed — one bare code for all three.",
    },
  },
});

const listRepliesRoute = createRoute({
  method: 'get',
  path: '/comments/{commentId}/replies',
  request: { params: commentIdParam, query: repliesQuerySchema },
  responses: {
    200: {
      description:
        "One keyset page of a root comment's replies, OLDEST first (D-62). Its cursor is not interchangeable with the root list's.",
      content: { 'application/json': { schema: commentPageSchema } },
    },
  },
});

const commentThreadRoute = createRoute({
  method: 'get',
  path: '/comments/{commentId}/thread',
  request: { params: commentIdParam },
  responses: {
    200: {
      description:
        "07-04 (UI-D-254): the ROOT thread holding this live post comment — the root, its replies oldest first up to the replies page cap, and the target appended when it lies beyond that cap. What the post page's `?comentario=` highlight pins first.",
      content: { 'application/json': { schema: commentThreadSchema } },
    },
    404: {
      description:
        'No such live post comment is visible to this tenant — unknown, foreign, deleted, a story comment, or on a removed post. One bare code for all.',
    },
  },
});

export const feedRoutes = feed
  // ONE route, two predicates (D-73/COMM-03): the parameter chooses which page this is, and both
  // are built by the same projection, the same ordering expression and the same cursor envelope.
  .openapi(listRoute, async (c) => {
    const query = c.req.valid('query');
    const ctx = c.get('ctx');
    const page = query.communityId
      ? await listCommunityFeed(ctx, query.communityId, query)
      : await listFeed(ctx, query);
    return c.json(page, 200);
  })
  .openapi(videoCommunitiesRoute, async (c) =>
    c.json(await listVideoCommunities(c.get('ctx')), 200),
  )
  .openapi(getPostRoute, async (c) => {
    const { postId } = c.req.valid('param');
    return c.json(await getPost(c.get('ctx'), postId), 200);
  })
  .openapi(createPostRoute, async (c) =>
    c.json(await createPost(c.get('ctx'), c.req.valid('json')), 201),
  )
  .openapi(updatePostRoute, async (c) => {
    const { postId } = c.req.valid('param');
    return c.json(await updatePost(c.get('ctx'), postId, c.req.valid('json')), 200);
  })
  .openapi(deletePostRoute, async (c) => {
    const { postId } = c.req.valid('param');
    await softDeletePost(c.get('ctx'), postId);
    return c.json({ deleted: true } as const, 200);
  })
  .openapi(likePostRoute, async (c) => {
    const { postId } = c.req.valid('param');
    return c.json(await likePost(c.get('ctx'), postId), 200);
  })
  .openapi(unlikePostRoute, async (c) => {
    const { postId } = c.req.valid('param');
    return c.json(await unlikePost(c.get('ctx'), postId), 200);
  })
  .openapi(listCommentsRoute, async (c) => {
    const { postId } = c.req.valid('param');
    return c.json(await listComments(c.get('ctx'), postId, c.req.valid('query')), 200);
  })
  .openapi(createCommentRoute, async (c) => {
    const { postId } = c.req.valid('param');
    return c.json(await createComment(c.get('ctx'), postId, c.req.valid('json')), 201);
  })
  .openapi(deleteCommentRoute, async (c) => {
    const { commentId } = c.req.valid('param');
    await deleteComment(c.get('ctx'), commentId);
    return c.json({ deleted: true } as const, 200);
  })
  .openapi(likeCommentRoute, async (c) => {
    const { commentId } = c.req.valid('param');
    return c.json(await likeComment(c.get('ctx'), commentId), 200);
  })
  .openapi(unlikeCommentRoute, async (c) => {
    const { commentId } = c.req.valid('param');
    return c.json(await unlikeComment(c.get('ctx'), commentId), 200);
  })
  .openapi(listRepliesRoute, async (c) => {
    const { commentId } = c.req.valid('param');
    return c.json(await listReplies(c.get('ctx'), commentId, c.req.valid('query')), 200);
  })
  .openapi(commentThreadRoute, async (c) => {
    const { commentId } = c.req.valid('param');
    return c.json(await getCommentThread(c.get('ctx'), commentId), 200);
  });
