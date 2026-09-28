import { MEDIA_STATUSES } from '@rede-social/contracts/media';
import { z } from 'zod';

/**
 * The module's published contract surface (`@rede-social/module-feed/contracts`). Both the API and the web
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
 * The longest cursor this endpoint will look at. The envelope (`@rede-social/core/server/paging`) is a
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

/**
 * `GET /v1/feed?limit=&cursor=&communityId=&media=`. `.strict()`: an unknown query key fails loudly (the
 * 03-03 rule).
 *
 * **`communityId` is a FILTER, never an authorisation.** Present, the page is that community's own
 * posts — the query `feed_posts_tenant_community_created_idx` was built for (COMM-03). Absent, it is
 * the merged feed (D-73). It is ONE endpoint and one cursor envelope on purpose: a second route
 * would be a second ordering expression waiting to drift, and the two pages must stay
 * interchangeable for the reader. The community's visibility is re-resolved server-side inside the
 * same transaction, so this parameter can only ever narrow what the tenant lane already allows.
 *
 * **`media=video` is a FILTER too, never an authorisation (REELS-03, 05.3).** Present, the page is
 * narrowed to posts whose `mediaKind` is `video` AND whose video asset is `ready` — a post still
 * transcoding, failed or rejected is absent here while Início still lists it (D-53). It narrows the
 * SAME endpoint, the same ordering expression and the same cursor envelope, and it combines with
 * `communityId` (one community's ready videos). Reels (`@rede-social/module-reels`, D-121) is its reader:
 * Reels owns no route and reads posts only through this parameter, so it can never list a post the
 * feed would not show the same member. Any other value is a 400 (`z.enum`).
 */
export const feedQuerySchema = z
  .object({
    cursor: z.string().max(FEED_MAX_CURSOR_LENGTH).optional(),
    limit: z.coerce.number().int().min(1).max(FEED_MAX_PAGE_SIZE).default(FEED_PAGE_SIZE),
    communityId: z.uuid().optional(),
    media: z.enum(['video']).optional(),
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

/* ── Publishing INTO a community (COMM-04, D-72) ───────────────────────────────────────────────── */

/**
 * The closed refusal vocabulary a post write can answer with, as `details.community` — the
 * `FEED_MEDIA_ISSUES` rule restated for the destination half. The web switches on it exhaustively
 * and maps each code to pt-BR copy; the copy never lives here.
 *
 * **There is exactly ONE code, and that is the point** (COMM-04, D-23, T-05-13). An unknown
 * community id, ANOTHER TENANT'S id and a soft-deleted one all answer a BARE 404 with no `details`
 * at all — a per-cause code over an enumerable uuid space would be an existence oracle. Only an
 * ARCHIVED community *of this tenant* gets a distinguishable refusal, and it discloses nothing the
 * member cannot already read on the community page.
 */
export const FEED_COMMUNITY_ISSUES = ['archived'] as const;
export type FeedCommunityIssue = (typeof FEED_COMMUNITY_ISSUES)[number];

/** The route `defaultHook`'s lookup: a Zod issue whose `message` is in here becomes `details.community`. */
export const FEED_COMMUNITY_ISSUE_SET: ReadonlySet<string> = new Set(FEED_COMMUNITY_ISSUES);

/**
 * The community a post belongs to, as the FEED projects it (D-71) — a NAME and the two ids the host
 * needs to build a route, and deliberately nothing else.
 *
 * **This is not `@rede-social/module-communities`' `CommunitySummary`, and it must not become it.** Two
 * reasons, and both are load-bearing:
 *
 *  1. **The boundary.** `turbo.json`'s tag allowlist lets a module depend on the kernel, the shared
 *     contracts and tooling — never on another module (MOD-02, `packages/boundary-fixture` is the
 *     negative proof). So the feed cannot import the communities module's contracts at all, and a
 *     three-field shape it publishes itself is the honest way to say what a post header needs.
 *  2. **The label is a label.** A cover, a post count, a status and an ordering timestamp on every
 *     post of the merged feed would be payload nobody renders — and the day one of them IS rendered,
 *     the "em {Comunidade}" segment has quietly become a second community card inside a post.
 *
 * `.strict()` is what keeps rule 2 true: a field cannot be added here by accident.
 */
export const postCommunitySchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
  })
  .strict();
export type PostCommunity = z.infer<typeof postCommunitySchema>;

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
    /**
     * COMM-04 / D-72 — the post's destination, chosen ONCE, at publication.
     *
     * Omitted (or absent), the post is tenant-wide. Present, it must name an ACTIVE community of
     * THIS tenant: the service re-resolves it inside the post's own transaction and answers a bare
     * 404 for an unknown, foreign or removed id and `400 { community: 'archived' }` for an archived
     * one. That check is VALIDATION, not authorisation — the permission is still the route's literal
     * `requirePermission('feed.post.create')`.
     *
     * It is deliberately NOT on `updatePostSchema`: a published post cannot move between
     * communities, because a move would have to decide what happens to the likes, comments and share
     * links it already accumulated in its old placement. A mis-placed post is deleted and reposted.
     */
    communityId: z.uuid().optional(),
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

/**
 * `PATCH /v1/feed/posts/{postId}` (FEED-03) — the composer's edit half, and the SAME field set
 * `createPostSchema` accepts plus the one nullable `linkPreviewId` the remove-prévia affordance
 * writes (`postLinkPreviewPatchSchema` above, spread in here so there is one definition of it).
 *
 * **Every key is optional, but the body may not be empty.** A `PATCH {}` is refused: it would be a
 * request to set `edited_at` and nothing else, which is a marker without an edit.
 *
 * **The media triple is a REPLACEMENT, not a merge.** Present any one of `imageAssetIds`,
 * `videoAssetId` or `attachmentAssetIds` and the post's whole media set becomes exactly what the
 * three keys describe (an omitted sibling meaning "none"); present none of them and the media is
 * untouched. A per-key merge would need a second vocabulary for "remove this one", and the composer
 * already holds the complete set on screen — it sends what the post should BE, which is also what
 * makes `media_kind` recomputable from the body alone.
 *
 * **`videoAssetId` is nullable here and not in `createPostSchema`**: an edit that removes the video
 * has to be able to SAY so while still sending the key.
 *
 * The publishable rule (caption OR media, never neither) is restated below for the case the body
 * fully determines, and re-checked in the service against the RESULTING row — a body that only
 * clears the caption cannot be judged here, because the media it keeps is in the database.
 */
export const updatePostSchema = z
  .object({
    caption: z.string().trim().max(FEED_MAX_CAPTION).optional(),
    imageAssetIds: z.array(z.uuid()).optional(),
    videoAssetId: z.uuid().nullable().optional(),
    attachmentAssetIds: z.array(z.uuid()).optional(),
    linkUrl: z.string().max(2048).optional(),
  })
  .extend(postLinkPreviewPatchSchema.shape)
  .strict()
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: 'empty_update' });
      return;
    }
    const images = value.imageAssetIds ?? [];
    const attachments = value.attachmentAssetIds ?? [];
    const hasVideo = value.videoAssetId !== undefined && value.videoAssetId !== null;

    if (images.length > 0 && hasVideo) {
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

    // Judgeable here ONLY when the body determines both halves: an empty caption together with a
    // complete media replacement that carries nothing. Every other shape is the service's call.
    const mediaReplaced =
      value.imageAssetIds !== undefined ||
      value.videoAssetId !== undefined ||
      value.attachmentAssetIds !== undefined;
    if (
      value.caption !== undefined &&
      value.caption.length === 0 &&
      mediaReplaced &&
      images.length === 0 &&
      attachments.length === 0 &&
      !hasVideo
    ) {
      ctx.addIssue({ code: 'custom', path: ['caption'], message: 'empty_post' });
    }
  });
export type UpdatePost = z.infer<typeof updatePostSchema>;

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
    /**
     * D-71 — WHERE THIS POST CAME FROM, on every post, always present.
     *
     * `null` is the tenant-wide answer and a summary is the community answer; there is no third
     * state and no optional key, so a renderer never has to guess whether the absence of a label
     * means "tenant-wide" or "the server forgot". It arrives from the SAME statement as the post (a
     * `left join public.communities` inside `postProjection`), so the label costs no extra query —
     * which is what `feed-query-budget.test.ts` holds honest with a ceiling AND a floor.
     *
     * `communityId` above stays because `post.published` carries it to Phase 7 and the composer
     * reads it; this is the same fact HYDRATED for the reader.
     */
    community: postCommunitySchema.nullable(),
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
 * The most rows `GET /v1/feed/video-communities` answers (D-119). The Reels lane row SCROLLS
 * (UI-D-84), so this cap bounds the READ — one statement, one bounded index walk (T-05.3-08) — and
 * never the product: a tenant with more than fifty communities holding videos sees the fifty with
 * the most recent activity, in the Comunidades list's own order.
 */
export const FEED_VIDEO_COMMUNITIES_CAP = 50;

/**
 * `GET /v1/feed/video-communities` (REELS-04, D-117, D-119, D-120) — the communities worth a Reels
 * lane, as feed's own published contract. Its one reader is Reels (`@rede-social/module-reels`, D-121),
 * which owns no route and so reads the lanes here, beside the list they open.
 *
 * - **Lanes are communities, never tags (D-117).** The read takes no parameter: no composer field
 *   and no per-tenant tag list stands behind a lane.
 * - **Which communities (D-119):** the tenant's `active`, not-deleted communities that hold at least
 *   one post the `?media=video` list would show — the SAME ready-video fragment the list uses, so a
 *   lane can never open empty (RESEARCH Pitfall 7). An archived community and a community whose only
 *   videos are still transcoding are absent.
 * - **Order (D-76):** `last_activity_at desc, id desc` — exactly the Comunidades list's active
 *   ordering, so the lane row reads in the order the member already knows.
 * - **Communities off (D-120):** the answer is an honest `{ items: [] }` (200, never 404), so the
 *   lane row simply hides; a tenant without the module has no community to name.
 *
 * Each item is `postCommunitySchema` — the same `{ id, name, slug }` label a post carries, and
 * `.strict()` for the same reason: a lane is a name and a route, never a second community card.
 */
export const videoCommunitiesSchema = z
  .object({
    items: z.array(postCommunitySchema),
  })
  .strict();
export type VideoCommunities = z.infer<typeof videoCommunitiesSchema>;

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
/**
 * A COMMENT's author (UI-D-24) — the post author's shape with every identifying field nullable.
 *
 * It is deliberately NOT `feedPostAuthorSchema`. A post is written by the tenant's admin and the
 * card's whole identity claim (D-52) rests on that person being present; a comment outlives its
 * author's membership, because removing the row would orphan every reply under it. The two shapes
 * therefore have different nullability, and sharing one schema would force the looser rule onto the
 * post card, where a null name is a bug rather than a state.
 *
 * `displayName` is null in EXACTLY ONE case — `authorRemoved === true`, i.e. the author's membership
 * is missing or soft-deleted. There is no other path that produces a nameless comment: a live member
 * always has a `member_profiles` row (the `member_profiles_from_membership` trigger guarantees it),
 * so a null name is never "the profile has not been filled in yet". The client reads `authorRemoved`
 * and renders the catalog's fixed removed-member label as PLAIN TEXT — `membershipId` is null with
 * it, so there is nothing to build a profile link out of even if a caller tried (T-04-45).
 */
export const commentAuthorSchema = z
  .object({
    membershipId: z.uuid().nullable(),
    displayName: z.string().nullable(),
    avatarAssetId: z.uuid().nullable(),
  })
  .strict();
export type FeedCommentAuthor = z.infer<typeof commentAuthorSchema>;

export const commentSchema = z
  .object({
    id: z.uuid(),
    createdAt: z.string(),
    body: z.string(),
    author: commentAuthorSchema,
    /** UI-D-24 — true exactly when `author.displayName` is null; see `commentAuthorSchema`. */
    authorRemoved: z.boolean(),
    likeCount: z.number().int(),
    viewerLiked: z.boolean(),
    /**
     * Live replies under THIS comment, hydrated in the same statement the row came from (D-60).
     * It is what the "Ver N respostas" toggle renders its ICU plural from, and it is why loading N
     * roots costs no reply requests at all: zero means the toggle is not drawn, above zero means one
     * bounded request when — and only when — the member expands that root.
     */
    replyCount: z.number().int().min(0),
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
 *
 * **The two STORY-05 codes are SEPARATE codes, not a reuse of `reply_depth_exceeded` (05-07).**
 * Three different refusals travel these paths now — "you replied to a reply", "you replied to a
 * story comment" and "you liked a story comment" — and each earns its own pt-BR sentence. One code
 * covering two of them would make one of the two sentences wrong for the member who reads it, which
 * is the entire reason this vocabulary is closed and enumerated rather than a free-text message.
 *
 * `story_comment_not_likeable` rides `details.like` (it is answered by the comment LIKE route, not
 * by a comment write); `story_comment_no_reply` rides `details.comment` like its siblings. Both are
 * translations of a SQLSTATE the database raised — `feed_likes_comment_kind_chk` / `feed_likes_comment_fk`
 * and `feed_comments_parent_shape_chk` / `feed_comments_parent_fk` — never a pre-check.
 */
export const FEED_COMMENT_ISSUES = [
  'reply_depth_exceeded',
  'story_comment_no_reply',
  'story_comment_not_likeable',
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
 * FEED-03's two write events (04-09). Both over-carry `authorUserId` for the same reason every
 * payload above does: Phase 7 and Phase 8 build their row straight from the event, without
 * re-reading a post that — in the delete case — its own read path now refuses.
 *
 * `actorUserId` is separate from `authorUserId` even though V1's author predicate makes them equal:
 * Phase 8's moderator delete is the SAME event with a different actor, and a payload that conflated
 * the two would have to change shape then.
 */
export interface PostEdited {
  tenantId: string;
  postId: string;
  authorUserId: string;
  actorUserId: string;
  occurredAt: string;
}

/** A SOFT delete (FEED-03): the row keeps its `deleted_at` stamp for Phase 8's moderation. */
export interface PostDeleted {
  tenantId: string;
  postId: string;
  authorUserId: string;
  actorUserId: string;
  occurredAt: string;
}

/**
 * MOD-02 in one block: the module teaches the KERNEL's `EventMap` about its own events instead of
 * the kernel knowing modules exist. Anything that imports this file gets `emit`/`subscribe` typed
 * for all nine.
 */
declare module '@rede-social/contracts' {
  interface EventMap {
    'post.published': PostPublished;
    'post.edited': PostEdited;
    'post.deleted': PostDeleted;
    'post.liked': PostLiked;
    'post.unliked': PostUnliked;
    'comment.created': CommentCreated;
    'comment.deleted': CommentDeleted;
    'comment.liked': CommentLiked;
    'comment.unliked': CommentUnliked;
  }
}
