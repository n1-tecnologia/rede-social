import { withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { enqueueInTx } from '@tria/core/server/jobs/boss';
import { moduleLogger } from '@tria/core/server/logging';
import { decodeCursor, encodeCursor } from '@tria/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  CommentsQuery,
  CreateComment,
  CreatePost,
  FeedComment,
  FeedCommentPage,
  FeedPage,
  FeedPost,
  FeedQuery,
  LikeResult,
  LinkPreview,
  LinkPreviewProvider,
  LinkPreviewStatus,
  PostMediaItem,
  RepliesQuery,
} from '../contracts/index';
import {
  FEED_MAX_ATTACHMENTS,
  FEED_MAX_IMAGES,
  FEED_UNFURL_QUEUE,
  firstUrlIn,
} from '../contracts/index';
import { feedPosts } from '../db/schema';
import { assertAllowedUrl, normaliseUrl, urlHash } from './unfurl/guard';

const log = moduleLogger('module-feed');

/**
 * The feed service (FEED-02, FEED-07, FEED-08) — a PURE TENANT-LANE area.
 *
 * Every function is `withTenantTx(ctx, …)`: the tenant is never a parameter and never a written
 * predicate. Layer 3 (`feed_posts_tenant_isolation`, `memberships_tenant_select`,
 * `member_profiles_tenant_select`) supplies it, which is what makes FEED-07's cross-tenant 404 fall
 * out of the same code path as an unknown id — there is nothing here that compares tenant ids, so no
 * later edit can turn that 404 into a 403 that confirms the row exists somewhere.
 */

/**
 * One hydrated row of the list projection. Snake_case: it comes straight off `tx.execute`, which
 * returns the driver's own row objects — NOT Drizzle's column-mapped ones — so the timestamps arrive
 * as text and are formatted by the statement itself (see `ISO_MICROSECONDS`).
 */
type FeedRow = {
  id: string;
  created_at: string;
  edited_at: string | null;
  caption: string;
  community_id: string | null;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
  author_user_id: string;
  membership_id: string;
  display_name: string;
  avatar_asset_id: string | null;
  media_kind: 'none' | 'gallery' | 'video';
  /** `json_agg` of the post's media rows, already ordered. `[]` when the post carries none. */
  media: PostMediaItem[];
  /** The `left join feed_link_previews` half — all null when the post carries no preview row. */
  link_preview_status: LinkPreviewStatus | null;
  link_preview_url: string | null;
  link_preview_title: string | null;
  link_preview_description: string | null;
  link_preview_site_name: string | null;
  link_preview_provider: LinkPreviewProvider | null;
  link_preview_image_asset_id: string | null;
};

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres rather than by JavaScript.
 *
 * This matters for correctness, not tidiness. The cursor's `n` is this exact string, and the page
 * predicate compares it back as `::timestamptz`. Round-tripping through a JS `Date` would truncate
 * `timestamptz`'s microseconds to milliseconds, moving the page boundary EARLIER than the row it
 * came from — which silently SKIPS any post written in the same millisecond but a later microsecond.
 * Keeping the full precision in text makes `(created_at, id)` a genuinely total order end to end.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * THE projection, written once and shared by the list and the detail read so the two can never
 * disagree about what a post looks like.
 *
 * The author's display name and avatar asset id come back in the SAME statement as the post (Pitfall
 * 3): a feed page costs ONE statement against the feed tables, never one plus N. The join carries NO
 * tenant condition — `memberships` and `member_profiles` are both RLS-scoped to this lane, so writing
 * one would be dead weight that a reader could mistake for the actual isolation.
 *
 * 04-03 closed 04-01's `viewerLiked` stub HERE rather than with a second query: the `feed_likes`
 * lookup is a LEFT JOIN in this same statement, bounded to one row by `feed_likes_post_uq`, so the
 * page still costs ONE statement and `feed-query-budget.test.ts` still passes at
 * `FEED_LIST_STATEMENT_BUDGET = 1`. Taking the viewer as a parameter is what keeps that true.
 *
 * 04-04 closed the `hasMedia` stub the SAME way: the media collection is a `left join lateral` that
 * aggregates `feed_post_media` joined to `media_assets` INSIDE this statement, not a second round
 * trip per post. Two consequences worth stating, because both are load-bearing:
 *   - the `join media_assets` runs in the tenant lane, so `media_assets_tenant_select`
 *     (`tenant_id = app.tenant_id() and deleted_at is null`) is what decides visibility. A
 *     soft-deleted asset simply drops out of the array — the card renders one slide fewer rather
 *     than a broken frame;
 *   - the payload carries an ASSET ID and a ladder, never a URL. `MediaImage` derives
 *     `/v1/media/{assetId}/{variant}` on the client, so a cached page can never outlive a signed
 *     Storage URL (R-05, T-04-23).
 */
const postProjection = (viewerUserId: string) => sql`
    select p.id,
           to_char(p.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
           to_char(p.edited_at at time zone 'utc', ${ISO_MICROSECONDS}) as edited_at,
           p.caption,
           p.community_id,
           p.like_count,
           p.comment_count,
           (pl.id is not null) as viewer_liked,
           p.author_user_id,
           p.media_kind,
           pm.media,
           lp.status as link_preview_status,
           lp.url as link_preview_url,
           lp.title as link_preview_title,
           lp.description as link_preview_description,
           lp.site_name as link_preview_site_name,
           lp.provider as link_preview_provider,
           lp.image_asset_id as link_preview_image_asset_id,
           ms.id as membership_id,
           mp.display_name,
           mp.avatar_asset_id
      from feed_posts p
      join memberships ms on ms.user_id = p.author_user_id
      join member_profiles mp on mp.membership_id = ms.id
      left join feed_likes pl on pl.post_id = p.id and pl.user_id = ${viewerUserId}::uuid
      -- MEDIA-04 rides the statement that already exists (Pitfall 3 / the query budget): a preview
      -- is ONE nullable foreign key, so this is a plain left join and the page still costs ONE
      -- statement. The join carries no tenant condition: feed_link_previews_tenant_isolation
      -- scopes it, exactly like every other table in this lane.
      left join feed_link_previews lp on lp.id = p.link_preview_id
      left join lateral (
        select coalesce(
                 json_agg(
                   json_build_object(
                     'assetId', m.media_asset_id,
                     'kind', m.kind,
                     'position', m.position,
                     'status', a.status,
                     'width', a.width,
                     'height', a.height,
                     'mime', a.mime,
                     'bytes', a.bytes,
                     'filename', a.filename,
                     'variantWidths', a.variant_widths
                   )
                   -- Gallery/video first, attachments after, each in its own position order. A bare
                   -- "order by kind" would sort 'file' ahead of 'image' alphabetically and put the
                   -- PDFs above the photos.
                   order by (m.kind = 'file'), m.position
                 ),
                 '[]'::json
               ) as media
          from feed_post_media m
          join media_assets a on a.id = m.media_asset_id
         where m.post_id = p.id
      ) pm on true`;

/**
 * Row → published contract. Timestamps cross the wire as ISO strings, never as `Date` — and here
 * they already ARE ISO strings, formatted by the statement (`ISO_MICROSECONDS`).
 *
 * `viewerLiked` comes from the projection's `left join feed_likes` (04-03) — not from a second query
 * per post, and not from application state. `canManage` is "I wrote it" for now; Phase 8's MODER-01
 * widens it to the moderator case.
 */
/**
 * The preview, projected ONLY when it actually resolved (UI-D-11).
 *
 * A `'pending'` or `'failed'` row returns null here, so a post whose link was refused is
 * INDISTINGUISHABLE on the wire from a post that carried no link at all — which is UI-D-13's
 * silence expressed as an absence rather than as a field the client would have to be trusted to
 * ignore. `hostname` is derived here so the card never parses a URL; if the stored URL somehow will
 * not parse, the preview degrades to null rather than raising.
 */
function toLinkPreview(row: FeedRow): LinkPreview | null {
  if (row.link_preview_status !== 'resolved' || row.link_preview_url === null) return null;
  let hostname: string;
  try {
    hostname = new URL(row.link_preview_url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  return {
    status: 'resolved',
    url: row.link_preview_url,
    title: row.link_preview_title,
    description: row.link_preview_description,
    siteName: row.link_preview_site_name,
    hostname,
    provider: row.link_preview_provider,
    imageAssetId: row.link_preview_image_asset_id,
  };
}

const toPost = (row: FeedRow, viewerUserId: string): FeedPost => ({
  id: row.id,
  createdAt: row.created_at,
  editedAt: row.edited_at,
  caption: row.caption,
  author: {
    membershipId: row.membership_id,
    displayName: row.display_name,
    avatarAssetId: row.avatar_asset_id,
  },
  likeCount: row.like_count,
  commentCount: row.comment_count,
  viewerLiked: row.viewer_liked,
  communityId: row.community_id,
  canManage: row.author_user_id === viewerUserId,
  mediaKind: row.media_kind,
  // `coalesce(..., '[]'::json)` inside the lateral means the array is always present; the `?? []`
  // guards only the `left join` miss (a post row with no lateral match cannot happen, but a future
  // projection that drops the join would otherwise crash the map rather than render no media).
  media: row.media ?? [],
  linkPreview: toLinkPreview(row),
});

/**
 * `GET /v1/feed?limit=&cursor=` (FEED-02) — one keyset page of the tenant's main feed, newest first.
 *
 * Ordering is `created_at desc, id desc`, which is the ordered pair
 * `feed_posts_tenant_community_created_idx` is built on and is TOTAL: two posts written in the same
 * microsecond occupy two stable adjacent slots that a page boundary can neither duplicate nor skip,
 * even while somebody else is publishing. The cursor's `n` is the row's own `created_at`, read back
 * from the projection rather than re-derived in JavaScript, so it can never disagree with the index.
 *
 * `decodeCursor` is TOTAL (see its docblock): a tampered, truncated or stale envelope degrades to
 * page 1 instead of raising, and nothing from the string reaches SQL before `cursorSchema` accepted
 * it (T-03-52). The tenant predicate is RLS, never the cursor.
 */
export async function listFeed(ctx: RequestContext, query: FeedQuery): Promise<FeedPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<FeedRow>(sql`
      ${postProjection(ctx.userId)}
       -- Phase 5 widens "community_id is null" to "community_id in (...)"; the index already carries it.
       where p.deleted_at is null
         and p.community_id is null
         and (
           ${afterAt}::timestamptz is null
           or (p.created_at, p.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by p.created_at desc, p.id desc
       limit ${limit + 1}`),
  );

  // Over-fetch by one: `nextCursor` is non-null EXACTLY when another row exists, so the sentinel
  // never fires a "load more" that comes back empty.
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  // T-04-05: the SHAPE of the read — counts, ids and flags. A caption is member content and never
  // reaches a log line, an error `details` payload or an OpenAPI example.
  log.info(
    {
      event: 'feed.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'feed listed',
  );

  return { items: page.map((row) => toPost(row, ctx.userId)), nextCursor };
}

/**
 * `GET /v1/feed/posts/{postId}` (FEED-07 groundwork, T-04-01).
 *
 * ONE bare 404 with NO `details` payload for every miss — unknown id, another tenant's id,
 * soft-deleted. A details key here, even `{ post: 'not_found' }` vs `{ post: 'deleted' }`, would be an
 * existence oracle over an enumerable uuid space (D-23, the `getItem` posture).
 */
export async function getPost(ctx: RequestContext, postId: string): Promise<FeedPost> {
  const row = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<FeedRow>(sql`
      ${postProjection(ctx.userId)}
       where p.id = ${postId}::uuid
         and p.deleted_at is null
       limit 1`);
    return rows[0];
  });

  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toPost(row, ctx.userId);
}

/**
 * `POST /v1/feed/posts` (FEED-08).
 *
 * - `tenantId` and `authorUserId` come from `ctx`, never from the body (T-04-02, T-07-01). The
 *   policy's `with check (tenant_id = app.tenant_id())` makes a forged stamp a `42501` rather than a
 *   cross-tenant write, so the rule is enforced twice on purpose.
 * - `emit` runs only after `withTenantTx` RESOLVES, and even then only QUEUES the event on
 *   `ctx.events`; the response middleware delivers it once the handler returned. A subscriber can
 *   therefore never observe a post that a rollback erased (MOD-03, criterion 4).
 */
export async function createPost(ctx: RequestContext, input: CreatePost): Promise<FeedPost> {
  const images = input.imageAssetIds ?? [];
  const attachments = input.attachmentAssetIds ?? [];
  const video = input.videoAssetId;

  // The counts and the XOR again, in the SERVICE. The schema already refuses these shapes, and this
  // is not redundant defence: `createPost` is also reachable from the seed, from a future admin
  // import and from any handler that assembles its own `CreatePost`, none of which pass through the
  // route's validator.
  if (images.length > 0 && video !== undefined) {
    throw new ApiError(400, 'VALIDATION_FAILED', { media: 'gallery_and_video' });
  }
  if (images.length > FEED_MAX_IMAGES) {
    throw new ApiError(400, 'VALIDATION_FAILED', { media: 'too_many_images' });
  }
  if (attachments.length > FEED_MAX_ATTACHMENTS) {
    throw new ApiError(400, 'VALIDATION_FAILED', { media: 'too_many_attachments' });
  }

  // D-53's discriminator, derived from the input — never sent by the client. The parent's single
  // `media_kind` is what `feed_post_media_kind_fk` then constrains every media row against.
  const mediaKind: 'none' | 'gallery' | 'video' =
    video !== undefined ? 'video' : images.length > 0 ? 'gallery' : 'none';

  /** Every referenced asset, in insert order, with the (kind, purpose) pair it MUST have. */
  const wanted: { assetId: string; kind: 'image' | 'video' | 'file'; position: number }[] = [
    ...images.map((assetId, position) => ({ assetId, kind: 'image' as const, position })),
    ...(video !== undefined ? [{ assetId: video, kind: 'video' as const, position: 0 }] : []),
    ...attachments.map((assetId, position) => ({ assetId, kind: 'file' as const, position })),
  ];

  /**
   * MEDIA-04, the CREATE-TIME half. The roadmap's "unfurled server-side at create time" is satisfied
   * here: the URL is chosen, validated and its cache row created inside the post's own transaction.
   * The bytes are fetched by the worker (`server/unfurl/job.ts`) — an outbound fetch to a host the
   * caption named has no business inside a Cloud Run request.
   *
   * **A refusal is SWALLOWED (UI-D-13).** `assertAllowedUrl` throwing means the policy said no; the
   * post still publishes, the link still renders bare inside the caption, and the response carries
   * nothing that separates "blocked host" from "no metadata". An error here would turn the composer
   * into an internal-network scanner: an admin could paste `http://169.254.169.254/` and read the
   * difference. Silence is the mitigation.
   */
  const linkCandidate = (() => {
    const raw = input.linkUrl ?? firstUrlIn(input.caption);
    if (raw === null || raw === undefined) return null;
    try {
      // The SAME matcher the caption renderer auto-links with (`firstUrlIn`), then the same
      // synchronous policy the worker re-applies. Two matchers would mean a card under a URL the
      // caption did not turn blue, or the reverse.
      assertAllowedUrl(raw);
      // NOTE the create path deliberately does NOT check the target's ADDRESS. It cannot: deciding
      // whether a hostname points into a private range needs a resolver, and a resolver in a
      // request path is the outbound work this whole design moves to the worker. The SOCKET is the
      // boundary (`guardedAgent`), so a refused URL costs one row and one job that lands 'failed'.
      // Adding a partial IP-literal check here would buy no safety and would only split one rule
      // across two places.
      return { url: raw, hash: urlHash(raw), normalised: normaliseUrl(raw) };
    } catch {
      return null;
    }
  })();

  const created = await withTenantTx(ctx, async (tx) => {
    if (wanted.length > 0) {
      // ONE validation read for every referenced id, inside the writing transaction. The read runs
      // in the TENANT LANE, so `media_assets_tenant_select` is what scopes it: another tenant's
      // asset id simply does not come back, and the refusal below is the same one an unknown id
      // gets — there is nothing here that compares tenant ids, so no later edit can turn this into
      // a 403 that confirms the asset exists somewhere (T-04-22).
      const ids = wanted.map((item) => item.assetId);
      // `in (…)` over individually-cast literals rather than `= any($1::uuid[])`: the driver binds a
      // JS string array as `text[]`, and the cast to `uuid[]` is the kind of implicit conversion
      // that works until one id is malformed and the statement fails as a 500 instead of a 400.
      const idList = sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      );
      const rows = await tx.execute<{ id: string; kind: string; purpose: string; status: string }>(
        sql`select id, kind, purpose, status from media_assets where id in (${idList})`,
      );
      const byId = new Map(rows.map((row) => [row.id, row]));

      for (const item of wanted) {
        const asset = byId.get(item.assetId);
        // A duplicate id in the array would pass this loop but fail `feed_post_media_position_uq`
        // only if it landed on the same position, so it is refused here instead.
        const expectedPurpose = item.kind === 'file' ? 'attachment' : 'post';
        // D-53 / Phase 3: a video may be published while its transcode runs — the card shows the
        // `processando` placeholder. Everything else must already be `ready`.
        const statusOk =
          asset?.status === 'ready' || (item.kind === 'video' && asset?.status === 'processing');
        if (!asset || asset.kind !== item.kind || asset.purpose !== expectedPurpose || !statusOk) {
          throw new ApiError(400, 'VALIDATION_FAILED', { media: 'asset_not_usable' });
        }
      }
      if (new Set(ids).size !== ids.length) {
        throw new ApiError(400, 'VALIDATION_FAILED', { media: 'asset_not_usable' });
      }
    }

    /**
     * The per-tenant cache, resolved BEFORE the post insert so `link_preview_id` can be stamped in
     * one write.
     *
     * `on conflict (tenant_id, url_hash) do nothing` is what makes a second post of the same link
     * cost NO second outbound fetch: the insert returns a row only when it actually created one, so
     * `enqueueInTx` below runs exactly once per (tenant, url). A cache hit falls through to the
     * select and reuses whatever the first post already resolved. The uniqueness is per TENANT, so
     * the same link in another community is a separate row and a separate fetch — the price of the
     * isolation (T-04-34).
     */
    let previewId: string | null = null;
    let previewIsNew = false;
    if (linkCandidate !== null) {
      const insertedPreview = await tx.execute<{ id: string }>(sql`
        insert into feed_link_previews (tenant_id, url_hash, url, status)
        values (${ctx.tenantId}::uuid, ${linkCandidate.hash}, ${linkCandidate.normalised}, 'pending')
        on conflict (tenant_id, url_hash) do nothing
        returning id`);
      const fresh = insertedPreview[0];
      if (fresh) {
        previewId = fresh.id;
        previewIsNew = true;
      } else {
        const existing = await tx.execute<{ id: string }>(sql`
          select id from feed_link_previews where url_hash = ${linkCandidate.hash} limit 1`);
        previewId = existing[0]?.id ?? null;
      }
    }

    const [inserted] = await tx
      .insert(feedPosts)
      .values({
        tenantId: ctx.tenantId,
        authorUserId: ctx.userId,
        caption: input.caption,
        mediaKind,
        linkPreviewId: previewId,
      })
      .returning();
    if (!inserted) throw new ApiError(500, 'INTERNAL');

    // In the SAME transaction as the post and the cache row: a rollback takes the job with it, so
    // there is no window where a `pending` preview exists with nothing to resolve it. `singletonKey`
    // is the preview id, so a retried request cannot stack two fetches of one URL (T-07-04).
    if (previewId !== null && previewIsNew) {
      await enqueueInTx(
        tx,
        FEED_UNFURL_QUEUE,
        { tenantId: ctx.tenantId, previewId, url: linkCandidate?.normalised ?? '' },
        { singletonKey: previewId },
      );
    }

    if (wanted.length > 0) {
      // ONE multi-row insert. `post_media_kind` is the parent's own `media_kind`, so the composite
      // foreign key has something to match; a row that disagreed would be refused by the database
      // rather than by this function.
      const values = sql.join(
        wanted.map(
          (item) =>
            sql`(${ctx.tenantId}::uuid, ${inserted.id}::uuid, ${mediaKind}, ${item.assetId}::uuid, ${item.kind}, ${item.position})`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        insert into feed_post_media
          (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
        values ${values}`);
    }

    // The author's own membership + profile, in the SAME transaction: the created post is returned
    // in exactly the shape the list returns, so the composer can prepend it without a re-read.
    const rows = await tx.execute<FeedRow>(sql`
      ${postProjection(ctx.userId)}
       where p.id = ${inserted.id}::uuid
       limit 1`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return row;
  }).catch((error: unknown) => {
    // The DATABASE's own refusal of D-53, translated. Named constraints only: an unrelated
    // integrity error must still surface as a 500 rather than a 400 the client would act on.
    if (isMediaShapeViolation(error)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { media: 'gallery_and_video' });
    }
    throw error;
  });

  emit(ctx, 'post.published', {
    tenantId: ctx.tenantId,
    postId: created.id,
    authorUserId: ctx.userId,
    communityId: created.community_id,
    // 04-04 closed 04-01's stub (WINDOWS #17). "Has media" is "carries any asset at all" — a
    // PDF-only announcement is a media post for Phase 7's purposes even though its `media_kind` is
    // `'none'`, which is why this reads the projected collection rather than the discriminator.
    hasMedia: created.media.length > 0,
    occurredAt: created.created_at,
  });

  log.info(
    {
      event: 'feed.post.created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      postId: created.id,
      captionLength: input.caption.length,
      // The SHAPE of the media, never an id or a filename (T-04-05): a filename is member content.
      mediaKind,
      mediaCount: created.media.length,
    },
    'post created',
  );

  return toPost(created, ctx.userId);
}

/**
 * The constraint names that mean "you tried to build a post the renderer could not draw", and
 * nothing else:
 *   - `feed_post_media_kind_fk`  — 23503, a media row naming a `(post_id, media_kind)` pair the
 *     parent does not have (an image row on a video post, or the reverse);
 *   - `feed_post_media_kind_chk` — 23514, a row lying about its own `kind`/`post_media_kind` pair;
 *   - `feed_post_media_video_uq` — 23505, a second video on one post.
 *
 * All three answer `400 { media: 'gallery_and_video' }`: from the caller's side they are one rule.
 * The cause chain is walked exactly as `isReplyDepthViolation` walks it, `seen` set included.
 */
const MEDIA_SHAPE_CONSTRAINTS = new Set([
  'feed_post_media_kind_fk',
  'feed_post_media_kind_chk',
  'feed_post_media_video_uq',
]);

function isMediaShapeViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (e.code === '23503' || e.code === '23505' || e.code === '23514') {
      const name =
        typeof e.constraint_name === 'string'
          ? e.constraint_name
          : typeof e.constraint === 'string'
            ? e.constraint
            : '';
      return MEDIA_SHAPE_CONSTRAINTS.has(name);
    }
    current = e.cause;
  }
  return false;
}

/* ── Interactions: likes, comments, replies (FEED-04, FEED-05, FEED-06) ────────────────────────── */

/**
 * COUNTERS ARE NOT WRITTEN HERE. `feed_posts.like_count`, `feed_posts.comment_count` and
 * `feed_comments.like_count` are owned exclusively by the triggers in `*_feed_counters.sql`; every
 * function below READS them back inside the same transaction that wrote the row. If a reviewer ever
 * finds an assignment to one of those columns in this file, it is a bug: two statements that must
 * both succeed will eventually not, and the counter drifts from the rows it summarises.
 */

/** One hydrated row of the comment projection — the `FeedRow` discipline, restated for comments. */
type CommentRow = {
  id: string;
  created_at: string;
  body: string;
  like_count: number;
  viewer_liked: boolean;
  reply_count: number;
  depth: number;
  author_user_id: string;
  /** UI-D-24 — true when the author's membership is gone or soft-deleted. See `commentProjection`. */
  author_removed: boolean;
  /** All three are NULL exactly when `author_removed` is true, and never otherwise. */
  membership_id: string | null;
  display_name: string | null;
  avatar_asset_id: string | null;
};

/**
 * THE comment projection, shared by the root list, the reply list and the create read-back.
 *
 * `viewer_liked` is a LEFT JOIN in this same statement (bounded to one row by
 * `feed_likes_comment_uq`) and `reply_count` is a correlated count over the LIVE replies — both
 * hydrated rather than fetched per row, so a comment page is ONE statement however long it is.
 * Ends without a `where`, so each caller appends its own predicate and ordering.
 *
 * THE AUTHOR JOIN IS A LEFT JOIN, AND THAT IS LOAD-BEARING (UI-D-24). An INNER join here would
 * DROP the whole row the moment the author's membership is soft-deleted — which would orphan every
 * reply written under that root (they hang off `parent_id`, not off the author) and would leave the
 * trigger-maintained `feed_posts.comment_count` describing a comment nobody can see. The row
 * therefore survives the person: the body, the timestamp, the like count and the replies are all
 * still returned, and `author_removed` is the flag the client turns into the "Membro removido"
 * label from the catalog — the copy stays in ONE place, never in this file.
 *
 * The membership lifecycle predicate rides the JOIN condition (`ms.deleted_at is null`, the same
 * rule `membershipOfRecord` applies and the same one the members directory applies), so a removed
 * author yields `ms.id is null` and therefore a null `membership_id`, `display_name` AND
 * `avatar_asset_id` in one step: there is no code path that can hand the client a removed member's
 * name, and none that can reconstruct a profile link for them (T-04-45).
 */
const commentProjection = (viewerUserId: string) => sql`
    select c.id,
           to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
           c.body,
           c.like_count,
           (cl.id is not null) as viewer_liked,
           (
             select count(*)::int from feed_comments r
              where r.parent_id = c.id and r.deleted_at is null
           ) as reply_count,
           c.depth,
           c.author_user_id,
           (ms.id is null) as author_removed,
           ms.id as membership_id,
           mp.display_name,
           mp.avatar_asset_id
      from feed_comments c
      left join memberships ms on ms.user_id = c.author_user_id and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id
      left join feed_likes cl on cl.comment_id = c.id and cl.user_id = ${viewerUserId}::uuid`;

/**
 * Row → published contract. `isReply` is `depth = 1` — the RENDERED half of the one-level cap
 * (D-60: a reply shows no "Responder" and no replies toggle), read from the same column the
 * database enforces the cap with, so the UI and the constraint can never disagree.
 */
const toComment = (row: CommentRow, viewerUserId: string): FeedComment => ({
  id: row.id,
  createdAt: row.created_at,
  body: row.body,
  // UI-D-24: `authorRemoved` and the three nulls move together, because the projection's LEFT JOIN
  // produces them together. The client reads the flag and substitutes the catalog's fixed label —
  // nothing here invents a display name, so a removed member cannot be named by any response.
  authorRemoved: row.author_removed,
  author: {
    membershipId: row.membership_id,
    displayName: row.display_name,
    avatarAssetId: row.avatar_asset_id,
  },
  likeCount: row.like_count,
  viewerLiked: row.viewer_liked,
  replyCount: row.reply_count,
  isReply: row.depth === 1,
  canDelete: row.author_user_id === viewerUserId,
});

/**
 * The two constraint names that mean "you tried to build a second reply level", and nothing else.
 *
 * Naming them individually is the point: an unrelated integrity error must still surface as a 500
 * rather than being mistranslated into a 400 the client would act on. `feed_comments_parent_fk`
 * raises `23503` (the parent is a reply, so `(id, 0)` does not exist); the shape check raises
 * `23514` (a row lying about `depth`/`parent_depth`).
 */
const REPLY_DEPTH_CONSTRAINTS = new Set([
  'feed_comments_parent_fk',
  'feed_comments_parent_shape_chk',
]);

/**
 * Postgres `23503`/`23514` on one of those two constraints, possibly wrapped by drizzle's
 * `DrizzleQueryError` — the cause chain is walked exactly as `isUniqueViolation` does for 02-05's
 * duplicate-slug mapping (`packages/core/server/platform/tenants.ts`), with a `seen` set so a
 * self-referential `cause` cannot loop.
 */
function isReplyDepthViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23503' || e.code === '23514') {
      const name = typeof e.constraint_name === 'string' ? e.constraint_name : '';
      return REPLY_DEPTH_CONSTRAINTS.has(name);
    }
    current = e.cause;
  }
  return false;
}

/** The post's counter and its author, read back inside the writing transaction. */
type PostCounterRow = { like_count: number; author_user_id: string };
/** The comment's counter and its author, read back inside the writing transaction. */
type CommentCounterRow = { like_count: number; author_user_id: string };

/**
 * `POST /v1/feed/posts/{postId}/like` (FEED-04) — an IDEMPOTENT toggle, not a create.
 *
 * The partial unique index `feed_likes_post_uq` is the arbiter: `on conflict … do nothing` means a
 * double-tap, a retried request and five concurrent requests all leave exactly ONE row, fire the
 * counter trigger exactly ONCE and change no counter thereafter. There is no read-then-write window
 * in this function, so there is nothing to lose a race with.
 *
 * It answers 200 with the CURRENT `{ liked, likeCount }` every time — **never 409**. A conflict
 * status would surface as an error toast on every double-tap gesture, which is exactly what the
 * requirement's "idempotent toggle" forbids.
 *
 * An unknown id, another tenant's id and a removed post are ONE branch: a bare 404 (T-04-21).
 */
export async function likePost(ctx: RequestContext, postId: string) {
  const { likeCount, authorUserId } = await withTenantTx(ctx, async (tx) => {
    // The insert SELECTS the post rather than trusting the path parameter, so a like can only ever
    // name a row this lane can see and that is not soft-deleted.
    await tx.execute(sql`
      insert into feed_likes (tenant_id, user_id, post_id)
      select ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, p.id
        from feed_posts p
       where p.id = ${postId}::uuid and p.deleted_at is null
      on conflict (user_id, post_id) where post_id is not null do nothing`);

    const rows = await tx.execute<PostCounterRow>(sql`
      select p.like_count, p.author_user_id
        from feed_posts p
       where p.id = ${postId}::uuid and p.deleted_at is null`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return { likeCount: row.like_count, authorUserId: row.author_user_id };
  });

  emit(ctx, 'post.liked', {
    tenantId: ctx.tenantId,
    postId,
    postAuthorUserId: authorUserId,
    actorUserId: ctx.userId,
  });

  return { liked: true, likeCount } satisfies LikeResult;
}

/**
 * `DELETE /v1/feed/posts/{postId}/like` — the other half of the toggle, equally idempotent.
 *
 * Unliking something never liked is a successful NO-OP: 200 with the current count, and **no
 * event**, because nothing happened. Only a delete that actually removed a row is worth telling
 * Phase 7 about.
 */
export async function unlikePost(ctx: RequestContext, postId: string) {
  const { likeCount, authorUserId, removed } = await withTenantTx(ctx, async (tx) => {
    const deleted = await tx.execute<{ id: string }>(sql`
      delete from feed_likes
       where user_id = ${ctx.userId}::uuid and post_id = ${postId}::uuid
      returning id`);

    const rows = await tx.execute<PostCounterRow>(sql`
      select p.like_count, p.author_user_id
        from feed_posts p
       where p.id = ${postId}::uuid and p.deleted_at is null`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return {
      likeCount: row.like_count,
      authorUserId: row.author_user_id,
      removed: deleted.length > 0,
    };
  });

  if (removed) {
    emit(ctx, 'post.unliked', {
      tenantId: ctx.tenantId,
      postId,
      postAuthorUserId: authorUserId,
      actorUserId: ctx.userId,
    });
  }

  return { liked: false, likeCount } satisfies LikeResult;
}

/**
 * `POST /v1/feed/comments/{commentId}/like` (FEED-06) — the SAME table and the SAME toggle as a
 * post, arbitrated by `feed_likes_comment_uq`. A reply is a comment, so liking one takes this exact
 * path with no special case.
 */
export async function likeComment(ctx: RequestContext, commentId: string) {
  const { likeCount, authorUserId } = await withTenantTx(ctx, async (tx) => {
    await tx.execute(sql`
      insert into feed_likes (tenant_id, user_id, comment_id)
      select ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, c.id
        from feed_comments c
       where c.id = ${commentId}::uuid and c.deleted_at is null
      on conflict (user_id, comment_id) where comment_id is not null do nothing`);

    const rows = await tx.execute<CommentCounterRow>(sql`
      select c.like_count, c.author_user_id
        from feed_comments c
       where c.id = ${commentId}::uuid and c.deleted_at is null`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return { likeCount: row.like_count, authorUserId: row.author_user_id };
  });

  emit(ctx, 'comment.liked', {
    tenantId: ctx.tenantId,
    commentId,
    commentAuthorUserId: authorUserId,
    actorUserId: ctx.userId,
  });

  return { liked: true, likeCount } satisfies LikeResult;
}

/** `DELETE /v1/feed/comments/{commentId}/like` — `unlikePost`'s shape against `comment_id`. */
export async function unlikeComment(ctx: RequestContext, commentId: string) {
  const { likeCount, authorUserId, removed } = await withTenantTx(ctx, async (tx) => {
    const deleted = await tx.execute<{ id: string }>(sql`
      delete from feed_likes
       where user_id = ${ctx.userId}::uuid and comment_id = ${commentId}::uuid
      returning id`);

    const rows = await tx.execute<CommentCounterRow>(sql`
      select c.like_count, c.author_user_id
        from feed_comments c
       where c.id = ${commentId}::uuid and c.deleted_at is null`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return {
      likeCount: row.like_count,
      authorUserId: row.author_user_id,
      removed: deleted.length > 0,
    };
  });

  if (removed) {
    emit(ctx, 'comment.unliked', {
      tenantId: ctx.tenantId,
      commentId,
      commentAuthorUserId: authorUserId,
      actorUserId: ctx.userId,
    });
  }

  return { liked: false, likeCount } satisfies LikeResult;
}

/**
 * `POST /v1/feed/posts/{postId}/comments` (FEED-05).
 *
 * **The one-level cap is the DATABASE's answer, translated — never pre-empted.** There is no
 * `if (parent.parentId) throw` anywhere in this file: an application check is a read-then-write
 * that two concurrent inserts can both pass, and it would keep a test suite green while the
 * constraint was missing. A reply is inserted with `depth 1, parent_depth 0` and the composite
 * foreign key decides whether a row with that `(id, depth)` pair exists. When it does not — because
 * the named parent is itself a reply — Postgres raises `23503` and this function turns it into
 * `400 VALIDATION_FAILED { comment: 'reply_depth_exceeded' }`.
 *
 * The reply insert SELECTS its parent through the post (`c.post_id = p.id`), so a `parentId` that
 * names a live comment on a DIFFERENT post selects nothing and takes the same bare 404 as an
 * unknown post — never a created row hanging under a parent from another thread.
 */
export async function createComment(
  ctx: RequestContext,
  postId: string,
  input: CreateComment,
): Promise<FeedComment> {
  const parentId = input.parentId ?? null;

  const created = await withTenantTx(ctx, async (tx) => {
    let inserted: { id: string }[];
    try {
      inserted =
        parentId === null
          ? await tx.execute<{ id: string }>(sql`
              insert into feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
              select ${ctx.tenantId}::uuid, p.id, ${ctx.userId}::uuid, ${input.body}, 0, null, null
                from feed_posts p
               where p.id = ${postId}::uuid and p.deleted_at is null
              returning id`)
          : // `parent_depth` is the LITERAL 0, not `c.depth`: naming a reply as the parent must be
            // refused by the foreign key rather than quietly recorded as a second level.
            await tx.execute<{ id: string }>(sql`
              insert into feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth)
              select ${ctx.tenantId}::uuid, p.id, ${ctx.userId}::uuid, ${input.body}, 1, c.id, 0
                from feed_posts p
                join feed_comments c on c.post_id = p.id and c.deleted_at is null
               where p.id = ${postId}::uuid and p.deleted_at is null
                 and c.id = ${parentId}::uuid
              returning id`);
    } catch (error) {
      if (isReplyDepthViolation(error)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { comment: 'reply_depth_exceeded' });
      }
      throw error;
    }

    const id = inserted[0]?.id;
    // Zero rows: the post is unknown / another tenant's / removed, or the named parent is not a
    // live comment on THIS post. One bare 404, no `details` to read (T-04-21).
    if (!id) throw new ApiError(404, 'NOT_FOUND');

    // The created comment in exactly the shape the list returns, plus the two recipient ids the
    // event needs — read here so Phase 7 never re-reads the post or the parent.
    const rows = await tx.execute<
      CommentRow & { post_author_user_id: string; parent_author_user_id: string | null }
    >(sql`
      select hydrated.*,
             p.author_user_id as post_author_user_id,
             pc.author_user_id as parent_author_user_id
        from (${commentProjection(ctx.userId)} where c.id = ${id}::uuid) hydrated
        join feed_posts p on p.id = ${postId}::uuid
        left join feed_comments pc on pc.id = ${parentId}::uuid`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return row;
  });

  emit(ctx, 'comment.created', {
    tenantId: ctx.tenantId,
    postId,
    commentId: created.id,
    parentCommentId: parentId,
    postAuthorUserId: created.post_author_user_id,
    parentAuthorUserId: created.parent_author_user_id,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'feed.comment.created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      postId,
      commentId: created.id,
      isReply: parentId !== null,
      bodyLength: input.body.length,
    },
    'comment created',
  );

  return toComment(created, ctx.userId);
}

/**
 * `DELETE /v1/feed/comments/{commentId}` (D-61) — a member removes their OWN comment or reply.
 *
 * The authority is IN THE PREDICATE (`author_user_id = ctx.userId`), so someone else's comment, an
 * unknown id and an already-deleted one are ONE branch answering a bare 404: a member cannot even
 * probe whether a comment exists (T-04-16, T-04-21). Phase 8's MODER-01 widens this exact route
 * with one more permission — the row stays, only `deleted_at` is set.
 *
 * Comments are NOT editable in V1 (D-61): there is no update-body path here and none in the routes.
 */
export async function deleteComment(ctx: RequestContext, commentId: string): Promise<void> {
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update feed_comments
         set deleted_at = now()
       where id = ${commentId}::uuid
         and author_user_id = ${ctx.userId}::uuid
         and deleted_at is null
      returning id`);
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND');
  });

  emit(ctx, 'comment.deleted', {
    tenantId: ctx.tenantId,
    commentId,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'feed.comment.deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      commentId,
    },
    'comment soft-deleted',
  );
}

/**
 * `GET /v1/feed/posts/{postId}/comments` (D-62) — ROOT comments, newest first.
 *
 * Two statements, both bounded: one that decides whether this lane may see the post at all (so a
 * foreign-tenant post answers the same bare 404 the detail read gives, rather than an empty list
 * that would confirm nothing), and ONE hydrated keyset page. Replies are NOT fanned out here —
 * `reply_count` tells the UI how many there are and `listReplies` fetches them when the member taps
 * "Ver N respostas" (D-60). N roots therefore cost 1 statement, never N.
 *
 * The order is `(created_at desc, id desc)` — the exact expression
 * `feed_comments_tenant_post_root_idx` carries, tie-breaker included, so it is TOTAL.
 *
 * UI-D-24: because the shared projection reaches the author through a `left join` on `memberships`,
 * a root whose author has since been removed from the tenant STAYS on this page — with
 * `authorRemoved: true` and a null name — rather than vanishing and taking its replies with it.
 */
export async function listComments(
  ctx: RequestContext,
  postId: string,
  query: CommentsQuery,
): Promise<FeedCommentPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, async (tx) => {
    const posts = await tx.execute<{ id: string }>(sql`
      select p.id from feed_posts p where p.id = ${postId}::uuid and p.deleted_at is null`);
    if (!posts[0]) throw new ApiError(404, 'NOT_FOUND');

    // The projection's author relation is a `left join` (UI-D-24): a root whose author has since
    // been removed from the tenant is still ON this page, nameless — never silently absent from it.
    return tx.execute<CommentRow>(sql`
      ${commentProjection(ctx.userId)}
       where c.post_id = ${postId}::uuid
         and c.parent_id is null
         and c.deleted_at is null
         and (
           ${afterAt}::timestamptz is null
           or (c.created_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by c.created_at desc, c.id desc
       limit ${limit + 1}`);
  });

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  // The SHAPE only — a comment body is member content and never reaches a log line (T-04-19).
  log.info(
    {
      event: 'feed.comments.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      postId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'comments listed',
  );

  return { items: page.map((row) => toComment(row, ctx.userId)), nextCursor };
}

/**
 * `GET /v1/feed/comments/{commentId}/replies` (D-60, D-62) — one root's replies, OLDEST first.
 *
 * The opposite direction from the roots, which is why it is its own keyset (`>` and an ascending
 * order) over its own index, `feed_comments_tenant_parent_idx`. The two cursors are therefore NOT
 * interchangeable; feeding one to the other degrades to page 1, exactly as a tampered cursor does.
 *
 * ONE statement: an unknown, foreign-tenant or removed comment id yields the same empty page a real
 * root with no replies yields, so there is nothing here to probe with.
 *
 * UI-D-24: the same `left join` on `memberships` applies to replies AND to the root they hang off,
 * which is the half that matters — a removed root author must not take live members' replies down
 * with them, and a removed replier must not take their own reply out of a thread that counts it.
 */
export async function listReplies(
  ctx: RequestContext,
  commentId: string,
  query: RepliesQuery,
): Promise<FeedCommentPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    // Same `left join` (UI-D-24), and it matters on BOTH ends of a thread: a removed root author
    // must not take live members' replies down with them, and a removed replier must not take their
    // own reply out of a thread whose `reply_count` still counts the row.
    tx.execute<CommentRow>(sql`
      ${commentProjection(ctx.userId)}
       where c.parent_id = ${commentId}::uuid
         and c.deleted_at is null
         and (
           ${afterAt}::timestamptz is null
           or (c.created_at, c.id) > (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by c.created_at asc, c.id asc
       limit ${limit + 1}`),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  log.info(
    {
      event: 'feed.replies.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      commentId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'replies listed',
  );

  return { items: page.map((row) => toComment(row, ctx.userId)), nextCursor };
}

/**
 * The post-edit path's REMOVE affordance (MEDIA-04, UI-D-11), called by 04-09's edit route.
 *
 * Nulling `link_preview_id` is the WHOLE affordance: an admin may drop a resolved preview and may
 * not override it. There is no title, image or description parameter here and there must never be
 * one — letting an admin hand-write the card would turn a post into an arbitrary banner that looks
 * like it came from the linked site.
 *
 * Runs in the tenant lane, so a post id from another tenant simply updates zero rows and answers
 * the same 404 an unknown id gets — there is nothing here that compares tenant ids (FEED-07).
 */
export async function setPostLinkPreview(
  ctx: RequestContext,
  postId: string,
  linkPreviewId: string | null,
): Promise<void> {
  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      update feed_posts
         set link_preview_id = ${linkPreviewId}::uuid,
             edited_at = now()
       where id = ${postId}::uuid
         and deleted_at is null
     returning id`),
  );
  if (rows.length === 0) throw new ApiError(404, 'NOT_FOUND');

  log.info(
    {
      event: 'feed.post.link_preview_set',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      postId,
      cleared: linkPreviewId === null,
    },
    'post link preview set',
  );
}
