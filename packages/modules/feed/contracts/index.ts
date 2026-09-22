import { z } from 'zod';

/**
 * The module's published contract surface (`@tria/module-feed/contracts`). Both the API and the web
 * app import from here — the same Zod schema validates the request body in Hono, the query in the
 * route and the page payload in `apps/web/lib/feed.ts`, so there is exactly one definition of what a
 * feed post is (MOD-01).
 */

/**
 * `FEED_PAGE_SIZE` is deliberately smaller than the directory's 25: a post card is far taller than a
 * member row, so 25 posts is ~10 screens of images. The server clamps `limit` to
 * `1..FEED_MAX_PAGE_SIZE`, so a crafted `?limit=100000` cannot ask for an unbounded page.
 */
export const FEED_PAGE_SIZE = 10;
export const FEED_MAX_PAGE_SIZE = 25;

/**
 * The longest cursor this endpoint will look at. The envelope (`@tria/core/server/paging`) is a
 * base64url JSON object carrying an ISO timestamp and a uuid, so 512 characters is already generous;
 * the bound exists so a megabyte of "cursor" is refused before it is decoded.
 */
export const FEED_MAX_CURSOR_LENGTH = 512;

/**
 * Caption cap, measured in **UTF-16 code units at both ends**: the browser `maxLength` attribute, the
 * `{n}/{max}` counter and `.max()` below all count the same unit, so a caption the counter accepts is
 * never refused by the API and an emoji is never silently cut into a lone surrogate (edge: encoding).
 */
export const FEED_MAX_CAPTION = 2200;

/** Caption characters rendered before the "… mais" toggle (UI-SPEC card anatomy, `[proto]`). */
export const FEED_CAPTION_TRUNCATE_AT = 100;

/** `GET /v1/feed?limit=&cursor=`. `.strict()`: an unknown query key fails loudly (the 03-03 rule). */
export const feedQuerySchema = z
  .object({
    cursor: z.string().max(FEED_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(FEED_MAX_PAGE_SIZE).default(FEED_PAGE_SIZE),
  })
  .strict();
export type FeedQuery = z.infer<typeof feedQuerySchema>;

/**
 * `POST /v1/feed/posts`. V1 a post is caption-only, so the trimmed caption must be non-empty; 04-04
 * relaxes the refinement to "caption OR media" when `feed_post_media` lands.
 *
 * Deliberately NOT idempotent (edge: idempotency): two identical requests create two distinct posts,
 * because a create endpoint with no client-supplied key cannot distinguish a retry from a genuine
 * second announcement. The composer's submit control is the only dedupe and it is disabled with
 * `aria-busy` while the request is in flight.
 */
export const createPostSchema = z
  .object({
    caption: z.string().trim().min(1).max(FEED_MAX_CAPTION),
  })
  .strict();
export type CreatePost = z.infer<typeof createPostSchema>;

/** Authorship as the card renders it (D-52): the PERSON, reached through their membership. */
export const feedPostAuthorSchema = z
  .object({
    membershipId: z.uuid(),
    displayName: z.string(),
    avatarAssetId: z.uuid().nullable(),
  })
  .strict();
export type FeedPostAuthor = z.infer<typeof feedPostAuthorSchema>;

/**
 * The wire shape of one post. `likeCount`, `commentCount` and `viewerLiked` are declared NOW and are
 * always present, so 04-03 adds the behaviour without a contract change and every consumer written
 * this plan already handles the fields. Timestamps cross the wire as ISO strings, never as `Date`.
 *
 * D-51: no `title` and no post-type/category field. One post model, one card, everywhere.
 */
export const feedPostSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.string(),
    editedAt: z.string().nullable(),
    caption: z.string(),
    author: feedPostAuthorSchema,
    likeCount: z.number().int(),
    commentCount: z.number().int(),
    viewerLiked: z.boolean(),
    communityId: z.uuid().nullable(),
    canManage: z.boolean(),
  })
  .strict();
export type FeedPost = z.infer<typeof feedPostSchema>;

/** One keyset page. `nextCursor` is non-null EXACTLY when another row exists (the over-fetch rule). */
export const feedPageSchema = z
  .object({
    items: z.array(feedPostSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type FeedPage = z.infer<typeof feedPageSchema>;

/**
 * FEED-08 in one value: who may publish is `tenant_modules['feed'].settings.postingPolicy`, never a
 * column, never a role hard-coded into a route. V2 member posting is
 * `update tenant_modules set settings = settings || '{"postingPolicy":"members"}'` and nothing else.
 */
export const FEED_POSTING_POLICIES = ['admins_only', 'members'] as const;
export type FeedPostingPolicy = (typeof FEED_POSTING_POLICIES)[number];

/** Tolerant on purpose: an unknown settings blob parses to the safe default rather than throwing. */
export const feedSettingsSchema = z.object({
  postingPolicy: z.enum(FEED_POSTING_POLICIES).default('admins_only'),
});
export type FeedSettings = z.infer<typeof feedSettingsSchema>;

/** The permission STRINGS, exported so the route, the registry and the web tier never retype them. */
export const FEED_PERMISSIONS = {
  create: 'feed.post.create',
  manage: 'feed.post.manage',
} as const;

/**
 * Payload of the module's first domain event (MOD-03). It carries everything Phase 7 needs to build a
 * notification row without re-reading the post.
 */
export interface PostPublished {
  tenantId: string;
  postId: string;
  authorUserId: string;
  communityId: string | null;
  hasMedia: boolean;
  occurredAt: string;
}

/* ── Comments and likes (FEED-04, FEED-05, FEED-06 / D-59..D-62) ───────────────────────────────── */

/**
 * Root comments page in 20s, replies in 10s: a reply block is nested under its root and a phone
 * screen holds far fewer of them before the thread stops reading as a conversation. Both are
 * refused above their cap rather than silently clamped — the repo's posture since `GET /v1/media`.
 */
export const COMMENTS_PAGE_SIZE = 20;
export const COMMENTS_MAX_PAGE_SIZE = 50;
export const REPLIES_PAGE_SIZE = 10;
export const REPLIES_MAX_PAGE_SIZE = 25;

/** Comment cap, measured in UTF-16 code units at both ends — the `FEED_MAX_CAPTION` rule restated. */
export const FEED_MAX_COMMENT = 1000;

/** `GET /v1/feed/posts/{postId}/comments`. `.strict()`: an unknown query key fails loudly. */
export const commentsQuerySchema = z
  .object({
    cursor: z.string().max(FEED_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(COMMENTS_MAX_PAGE_SIZE).default(COMMENTS_PAGE_SIZE),
  })
  .strict();
export type CommentsQuery = z.infer<typeof commentsQuerySchema>;

/** `GET /v1/feed/comments/{commentId}/replies` — the same envelope, the OPPOSITE direction (D-62). */
export const repliesQuerySchema = z
  .object({
    cursor: z.string().max(FEED_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(REPLIES_MAX_PAGE_SIZE).default(REPLIES_PAGE_SIZE),
  })
  .strict();
export type RepliesQuery = z.infer<typeof repliesQuerySchema>;

/**
 * `POST /v1/feed/posts/{postId}/comments`. `parentId` present means "this is a reply"; the DATABASE
 * decides whether that parent may have children (`feed_comments_parent_fk`), not this schema and
 * not the service. A reply to a reply is a well-formed request that the database refuses.
 */
export const createCommentSchema = z
  .object({
    body: z.string().trim().min(1).max(FEED_MAX_COMMENT),
    parentId: z.uuid().optional(),
  })
  .strict();
export type CreateComment = z.infer<typeof createCommentSchema>;

/**
 * The wire shape of one comment or reply. `isReply` is the rendered half of the one-level cap
 * (D-60: a reply shows no "Responder" and no replies toggle) and `replyCount` drives "Ver N
 * respostas"; a reply always reports `replyCount: 0` because it can have none.
 */
export const commentSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.string(),
    body: z.string(),
    author: feedPostAuthorSchema,
    likeCount: z.number().int(),
    viewerLiked: z.boolean(),
    replyCount: z.number().int(),
    isReply: z.boolean(),
    canDelete: z.boolean(),
  })
  .strict();
export type FeedComment = z.infer<typeof commentSchema>;

/** One keyset page of comments or replies. `nextCursor` is non-null EXACTLY when another row exists. */
export const commentPageSchema = z
  .object({
    items: z.array(commentSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type FeedCommentPage = z.infer<typeof commentPageSchema>;

/**
 * The answer to every like and unlike, on a post or on a comment: the CURRENT state, read back in
 * the same transaction that wrote it. A repeat like returns the identical body with a 200 — never a
 * 409 (FEED-04, idempotent toggle).
 */
export const likeResultSchema = z
  .object({
    liked: z.boolean(),
    likeCount: z.number().int().min(0),
  })
  .strict();
export type LikeResult = z.infer<typeof likeResultSchema>;

/**
 * The machine codes a comment write can answer with, as `details.comment`. `reply_depth_exceeded` is
 * the API's translation of the database's 23503/23514 refusal — the only comment issue a client
 * branches on. The other two are documentation: the module answers a BARE 404 for a missing post or
 * comment (D-23), with no `details` payload to read.
 */
export const FEED_COMMENT_ISSUES = [
  'reply_depth_exceeded',
  'comment_not_found',
  'post_not_found',
] as const;
export type FeedCommentIssue = (typeof FEED_COMMENT_ISSUES)[number];

/* ── Domain events (MOD-03) ────────────────────────────────────────────────────────────────────── */

/**
 * Every payload below OVER-CARRIES the recipient id on purpose: Phase 7 builds a notification row
 * straight from the event, without re-reading the post or the comment it is about. The actor is
 * always `actorUserId`; the recipient is whichever author field the event names.
 */
export interface PostLiked {
  tenantId: string;
  postId: string;
  /** The notification recipient. Read inside the same transaction as the like. */
  postAuthorUserId: string;
  actorUserId: string;
}
export type PostUnliked = PostLiked;

export interface CommentCreated {
  tenantId: string;
  postId: string;
  commentId: string;
  /** Null for a root comment; the root's id for a reply. */
  parentCommentId: string | null;
  postAuthorUserId: string;
  /** Null for a root comment; the ROOT's author for a reply — the second recipient Phase 7 needs. */
  parentAuthorUserId: string | null;
  actorUserId: string;
}

export interface CommentDeleted {
  tenantId: string;
  commentId: string;
  actorUserId: string;
}

export interface CommentLiked {
  tenantId: string;
  commentId: string;
  /** The notification recipient. */
  commentAuthorUserId: string;
  actorUserId: string;
}
export type CommentUnliked = CommentLiked;

/**
 * MOD-02 in one block: the module teaches the KERNEL's `EventMap` about its own events instead of
 * the kernel knowing modules exist. Anything that imports this file gets `emit`/`subscribe` typed
 * for all seven.
 */
declare module '@tria/contracts' {
  interface EventMap {
    'post.published': PostPublished;
    'post.liked': PostLiked;
    'post.unliked': PostUnliked;
    'comment.created': CommentCreated;
    'comment.deleted': CommentDeleted;
    'comment.liked': CommentLiked;
    'comment.unliked': CommentUnliked;
  }
}
