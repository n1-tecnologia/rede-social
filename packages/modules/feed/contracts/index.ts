import { MEDIA_STATUSES } from '@tria/contracts/media';
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

/* ── Media on a post (FEED-01, D-53) ───────────────────────────────────────────────────────────── */

/**
 * Per-post counts. They are NOT in `MEDIA_LIMITS` (which caps a single upload's bytes and mime);
 * these cap how many assets one post may REFERENCE, and they are enforced twice — by the Zod array
 * bound below, and again in the service before any row is inserted.
 *
 * Ten dots at 6px fit the carousel's scrim pill well inside a 320px viewport (UI-D-10), which is the
 * concrete reason `FEED_MAX_IMAGES` is 10 and not an arbitrary larger number.
 */
export const FEED_MAX_IMAGES = 10;
export const FEED_MAX_ATTACHMENTS = 5;

/**
 * The closed refusal vocabulary a post WRITE can answer with, as `details.media`. The web switches
 * on it exhaustively and maps each to pt-BR copy, exactly as it does for `MEDIA_ISSUES`.
 *
 * `gallery_and_video` is the API's translation of the DATABASE's refusal (23503 on
 * `feed_post_media_kind_fk`, 23505 on `feed_post_media_video_uq`, 23514 on the kind check) as well
 * as of the schema's own `.superRefine`: the rule holds even for a caller that never touches the
 * composer. `asset_not_usable` deliberately covers "unknown id", "another tenant's id", "wrong
 * purpose", "wrong kind" and "not ready" with ONE code and NO id echoed back — a per-cause code over
 * an enumerable uuid space would be an existence oracle (the D-23 posture, T-04-22).
 */
export const FEED_MEDIA_ISSUES = [
  'too_many_images',
  'too_many_attachments',
  'gallery_and_video',
  'asset_not_usable',
] as const;
export type FeedMediaIssue = (typeof FEED_MEDIA_ISSUES)[number];

/**
 * One media row as the feed projects it. It carries the ASSET ID and the facts the renderer needs
 * (the ladder for `srcSet`, the stored width/height for the ratio box, the filename and byte size
 * for an attachment row) — and NEVER a URL: `MediaImage` derives `/v1/media/{assetId}/{variant}`
 * itself, so a cached payload can never outlive a signed URL (R-05, T-04-23).
 *
 * `status` rides along because a video may be published while its transcode runs (D-53): the card
 * shows the Phase 3 `processando` placeholder rather than an empty frame.
 */
export const postMediaSchema = z
  .object({
    assetId: z.uuid(),
    kind: z.enum(['image', 'video', 'file']),
    position: z.number().int().min(0),
    status: z.enum(MEDIA_STATUSES),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    mime: z.string(),
    bytes: z.number().int(),
    filename: z.string().nullable(),
    variantWidths: z.array(z.number().int()),
  })
  .strict();
export type PostMediaItem = z.infer<typeof postMediaSchema>;

/**
 * `POST /v1/feed/posts`. A post is publishable with a caption, with media, or with both — never with
 * neither (the UI-SPEC's publishable rule; 04-01's caption-non-empty refinement is relaxed here now
 * that `feed_post_media` exists).
 *
 * **The arrays' ORDER IS THE GALLERY ORDER.** `imageAssetIds[i]` becomes `position = i`, and the
 * composer's drag-to-reorder is a reorder of this array and nothing else — there is no separate
 * position field to keep in sync.
 *
 * `imageAssetIds` and `videoAssetId` are mutually exclusive (D-53). The refinement below is the
 * FRIENDLY half of that rule; the binding half is `feed_post_media_kind_fk` in the database, which
 * refuses the same shape for a caller that never validated anything.
 *
 * Deliberately NOT idempotent (edge: idempotency): two identical requests create two distinct posts,
 * because a create endpoint with no client-supplied key cannot distinguish a retry from a genuine
 * second announcement. The composer's submit control is the only dedupe and it is disabled with
 * `aria-busy` while the request is in flight.
 */
export const createPostSchema = z
  .object({
    caption: z.string().trim().max(FEED_MAX_CAPTION).default(''),
    imageAssetIds: z.array(z.uuid()).optional(),
    videoAssetId: z.uuid().optional(),
    attachmentAssetIds: z.array(z.uuid()).optional(),
    /**
     * An EXPLICIT link to preview. Omitted, the service takes the first URL in the caption
     * (`firstUrlIn`). Either way the URL is validated synchronously and, if the policy refuses it,
     * SILENTLY dropped — the post still publishes and the admin is told nothing (UI-D-13).
     */
    linkUrl: z.string().max(2048).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const images = value.imageAssetIds ?? [];
    const attachments = value.attachmentAssetIds ?? [];
    if (images.length > 0 && value.videoAssetId !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['videoAssetId'], message: 'gallery_and_video' });
    }
    if (images.length > FEED_MAX_IMAGES) {
      ctx.addIssue({ code: 'custom', path: ['imageAssetIds'], message: 'too_many_images' });
    }
    if (attachments.length > FEED_MAX_ATTACHMENTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['attachmentAssetIds'],
        message: 'too_many_attachments',
      });
    }
    // Caption OR media — never neither. A post with no caption and no asset has nothing to render.
    if (
      value.caption.length === 0 &&
      images.length === 0 &&
      attachments.length === 0 &&
      value.videoAssetId === undefined
    ) {
      ctx.addIssue({ code: 'custom', path: ['caption'], message: 'empty_post' });
    }
  });
export type CreatePost = z.infer<typeof createPostSchema>;

/* ── Link previews (MEDIA-04, UI-D-11 / UI-D-12 / UI-D-13) ─────────────────────────────────────── */

/**
 * THE URL matcher, exported so the caption renderer and the create path can never disagree about
 * what counts as a link in a post.
 *
 * Two copies of this rule would mean a caption that renders a link the unfurler never saw, or a
 * preview card under a URL the caption did not turn blue. Deliberately conservative: a run of
 * non-space characters after `http://` or `https://`, with trailing sentence punctuation pushed
 * back into the text so "veja https://exemplo.com." matches the URL and not the full stop. The
 * scheme restriction is load-bearing — a `javascript:` or `data:` URL simply is not a match, so it
 * can never become an `href` and can never be enqueued.
 */
export const FEED_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
export const FEED_URL_TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** One match, trimmed of trailing punctuation. `matchAll` clones the regex, so `lastIndex` is safe. */
export function trimMatchedUrl(raw: string): string {
  const trailing = FEED_URL_TRAILING_PUNCTUATION.exec(raw);
  return trailing ? raw.slice(0, raw.length - trailing[0].length) : raw;
}

/** The FIRST link in a caption — the one, and only one, a post may preview. */
export function firstUrlIn(text: string): string | null {
  for (const match of text.matchAll(FEED_URL_PATTERN)) {
    const url = trimMatchedUrl(match[0]);
    if (url.length > 0) return url;
  }
  return null;
}

/** The queue the create path enqueues onto and the worker binds. */
export const FEED_UNFURL_QUEUE = 'feed.unfurl-link';

/**
 * The unfurl job's payload.
 *
 * `tenantId` is DATA, NOT AUTHORITY (T-07-03). The handler re-enters the tenant lane with it and
 * lets RLS decide what may be written: a payload naming the wrong tenant updates zero rows rather
 * than another tenant's preview. The field exists so the worker knows WHICH lane to enter, never to
 * grant access to one.
 */
export interface FeedUnfurlJob {
  tenantId: string;
  previewId: string;
  url: string;
}

/** The status vocabulary, mirrored by `feed_link_previews_status_chk`. */
export const LINK_PREVIEW_STATUSES = ['pending', 'resolved', 'failed'] as const;
export type LinkPreviewStatus = (typeof LINK_PREVIEW_STATUSES)[number];

/** The oEmbed providers that resolve to a thumbnail card rather than an Open Graph scrape. */
export const LINK_PREVIEW_PROVIDERS = ['youtube', 'vimeo'] as const;
export type LinkPreviewProvider = (typeof LINK_PREVIEW_PROVIDERS)[number];

/**
 * The MACHINE failure codes a preview row can carry. They never cross the wire and never reach the
 * admin: UI-D-13 makes every refusal silent, because a message separating "blocked host" from "no
 * metadata" is an internal-network oracle an admin could point at the VPC.
 */
export const LINK_PREVIEW_FAILURE_REASONS = [
  'blocked',
  'timeout',
  'unreachable',
  'no_metadata',
] as const;
export type LinkPreviewFailureReason = (typeof LINK_PREVIEW_FAILURE_REASONS)[number];

/**
 * A preview as the feed projects it. `hostname` is derived server-side from the stored URL so the
 * card never parses one, and `failureReason` is deliberately ABSENT from this shape — the client is
 * told the status and nothing about why (UI-D-13).
 *
 * Every string here is untrusted remote metadata. It crosses the wire as PLAIN TEXT and is rendered
 * through React's default escaping; nothing in the card is an HTML-injection sink (T-04-32).
 */
export const linkPreviewSchema = z
  .object({
    status: z.enum(LINK_PREVIEW_STATUSES),
    url: z.string(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    siteName: z.string().nullable(),
    hostname: z.string(),
    provider: z.enum(LINK_PREVIEW_PROVIDERS).nullable(),
    imageAssetId: z.uuid().nullable(),
  })
  .strict();
export type LinkPreview = z.infer<typeof linkPreviewSchema>;

/**
 * The remove affordance, as one nullable field (04-09 spreads it into the post-edit body).
 *
 * There is no override: an admin may DROP a resolved preview, never supply their own title, image
 * or description. Letting one hand-write the card would turn a post into an arbitrary link-styled
 * banner that looks like it came from the linked site.
 */
export const postLinkPreviewPatchSchema = z.object({
  linkPreviewId: z.uuid().nullable().optional(),
});
export type PostLinkPreviewPatch = z.infer<typeof postLinkPreviewPatchSchema>;

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
    /**
     * D-53's discriminator — what `PostMedia` BRANCHES on. It is the parent's own column, not a
     * count over `media`, so a post with three attachments and no photos is still `'none'` and
     * renders no media frame at all.
     */
    mediaKind: z.enum(['none', 'gallery', 'video']),
    /** Images/video first in `position` order, then the attachments in their own `position` order. */
    media: z.array(postMediaSchema),
    /**
     * At most one, and null until it actually RESOLVES. The card draws only on `'resolved'`
     * (UI-D-11), so a `'pending'` or `'failed'` row is indistinguishable here from a post that
     * carried no link at all — which is exactly the silence UI-D-13 asks for.
     */
    linkPreview: linkPreviewSchema.nullable(),
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
