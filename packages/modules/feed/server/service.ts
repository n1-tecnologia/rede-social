import { type Tx, withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { enqueueInTx } from '@tria/core/server/jobs/boss';
import { moduleLogger } from '@tria/core/server/logging';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
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
  UpdatePost,
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
  /** The `left join public.communities` half (05-03). Both null for a tenant-wide post. */
  community_name: string | null;
  community_slug: string | null;
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
           c.name as community_name,
           c.slug as community_slug,
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
      -- D-71's "em {Comunidade}" label rides the statement that already exists (Pitfall 3/11): the
      -- container is ONE nullable foreign key, so this is a plain left join and a feed page still
      -- costs ONE statement. Two things about it are deliberate:
      --   * the c.tenant_id = p.tenant_id condition is here even though communities_tenant_isolation
      --     already scopes this lane. It is the ONE join condition in this projection that carries a
      --     tenant predicate, because this is the one join whose failure mode is a FOREIGN TENANT'S
      --     NAME rendered inside a post card (T-05-14). Defence in depth, stated not implied;
      --   * there is NO c.status and no c.deleted_at predicate. Archive is a write gate and a list
      --     gate, never a feed gate (05-RESEARCH Pattern 7): an archived community's posts stay in
      --     the feed, still labelled and still reachable, so the feed keeps exactly one ordering
      --     expression and no outstanding cursor is ever invalidated by an archive.
      left join public.communities c
             on c.id = p.community_id and c.tenant_id = p.tenant_id
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
  // D-71. Both halves of the pair are checked rather than just the id: a `community_id` whose join
  // found nothing (a row the lane cannot see) must read as "tenant-wide" rather than as a community
  // with an empty name — the label is either complete or absent, never a blank link.
  community:
    row.community_id !== null && row.community_name !== null && row.community_slug !== null
      ? { id: row.community_id, name: row.community_name, slug: row.community_slug }
      : null,
  canManage: row.author_user_id === viewerUserId,
  mediaKind: row.media_kind,
  // `coalesce(..., '[]'::json)` inside the lateral means the array is always present; the `?? []`
  // guards only the `left join` miss (a post row with no lateral match cannot happen, but a future
  // projection that drops the join would otherwise crash the map rather than render no media).
  media: row.media ?? [],
  linkPreview: toLinkPreview(row),
});

/**
 * ONE keyset page, given the ONE predicate that distinguishes the three feeds (05-03).
 *
 * Everything below the predicate — the projection, the cursor comparison, the ordering expression,
 * the over-fetch and the `encodeCursor` — is written once HERE, so the merged feed, the module-off
 * fallback and a community's own page cannot drift apart on any of them. That is the whole content
 * of D-73's "one query, one ordering expression": the difference between the three is a `where`
 * fragment, never a second query path and never a second route.
 */
async function feedPage(
  ctx: RequestContext,
  query: FeedQuery,
  communityPredicate: ReturnType<typeof sql>,
): Promise<FeedPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<FeedRow>(sql`
      ${postProjection(ctx.userId)}
       where p.deleted_at is null
         ${communityPredicate}
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

  return { items: page.map((row) => toPost(row, ctx.userId)), nextCursor };
}

/**
 * `GET /v1/feed?limit=&cursor=` (FEED-02, D-73, D-74) — one keyset page of the tenant's MAIN feed:
 * tenant-wide posts and community posts interleaved, strictly chronological, newest first.
 *
 * **D-73: the merged predicate is an ABSENCE.** Because COMM-02 makes every member of the tenant a
 * viewer of every community, "which communities may this member see" has no answer to compute — the
 * V1 merged feed is simply the feed with no filter on `community_id` at all. There is no per-source
 * cap, no ranking and no interleaving rule: `created_at desc, id desc` is the whole ordering, so a
 * community post and a tenant-wide post written a second apart sit a second apart on screen.
 *
 * **D-74: the module flag is the SINGLE switch.** With `communities` disabled for this tenant the
 * predicate reverts to Phase 4's `community_id is null` — the rows are untouched, the community
 * posts simply stop being listed, and re-enabling restores them with no migration and no backfill.
 * Nothing else in this file branches on the flag, and there is deliberately no second route: a
 * tenant that turns the module off must get the OLD feed, not a different one.
 *
 * Reading the flag costs nothing measurable: `requireModule('feed')` has already populated
 * `moduleFlags` for this tenant on this very request, so this is a cache hit, and the cache's own
 * read is against `tenant_modules` — a table outside the feed query budget's regex either way.
 *
 * **Which index serves which predicate is a MEASURED fact, not an assumption** (05-RESEARCH
 * §Pattern 3, and the schema docblock repeats the table): enabled → `feed_posts_tenant_created_all_idx`,
 * disabled → the partial `feed_posts_tenant_created_idx`. `090-feed.sql` pins BOTH plans on a volume
 * fixture, so losing either one is a red pgTAP run rather than a silent sequential scan.
 *
 * Ordering is TOTAL: two posts written in the same microsecond occupy two stable adjacent slots that
 * a page boundary can neither duplicate nor skip, even while somebody else is publishing. The
 * cursor's `n` is the row's own `created_at`, read back from the projection rather than re-derived
 * in JavaScript, so it can never disagree with the index.
 *
 * `decodeCursor` is TOTAL (see its docblock): a tampered, truncated or stale envelope degrades to
 * page 1 instead of raising, and nothing from the string reaches SQL before `cursorSchema` accepted
 * it (T-03-52). The tenant predicate is RLS, never the cursor.
 */
export async function listFeed(ctx: RequestContext, query: FeedQuery): Promise<FeedPage> {
  const communitiesEnabled = await moduleFlags.isEnabled(ctx, 'communities');
  const page = await feedPage(
    ctx,
    query,
    // D-73 enabled: NO filter. D-74 disabled: the Phase 4 predicate, unchanged.
    communitiesEnabled ? sql`` : sql`and p.community_id is null`,
  );

  // T-04-05: the SHAPE of the read — counts, ids and flags. A caption is member content and never
  // reaches a log line, an error `details` payload or an OpenAPI example.
  log.info(
    {
      event: 'feed.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      limit: query.limit,
      returned: page.items.length,
      hasNext: page.nextCursor !== null,
      communitiesEnabled,
    },
    'feed listed',
  );

  return page;
}

/**
 * `GET /v1/feed?communityId=…` (COMM-03) — one community's own posts, same projection, same cursor
 * envelope, same ordering expression as the merged feed.
 *
 * It is exposed as a PARAMETER of the existing feed route rather than as a sibling path
 * (`/v1/feed/communities/{id}`) for one reason that outlives the choice: the cursor. Both pages are
 * built by `feedPage` from the identical `(created_at, id)` tuple, so a cursor is meaningful in
 * either — and the day the community page gains a filter the main feed also wants, there is one
 * `FeedQuery` to add it to instead of two that have to be kept in step. The equality predicate here
 * is the query `feed_posts_tenant_community_created_idx` was built for in Phase 4.
 *
 * **The community is resolved FIRST, inside the tenant lane, and a miss is a BARE 404** — unknown
 * id, another tenant's id, soft-deleted: one answer for all three, with no `details` (D-23,
 * T-05-02). There is nothing here that compares tenant ids, so no later edit can turn that 404 into
 * a 403 that confirms the row exists somewhere.
 *
 * An ARCHIVED community still lists its posts (05-RESEARCH §Pattern 7): archiving gates the WRITES
 * and removes the container from the tab, it does not retract what members already read.
 *
 * With the `communities` module disabled the route answers the same bare 404 — not because the id is
 * wrong, but because a tenant without the module has no communities to name (D-74, ROLE-06's "never
 * tell 'you may not' from 'there is nothing here'").
 */
export async function listCommunityFeed(
  ctx: RequestContext,
  communityId: string,
  query: FeedQuery,
): Promise<FeedPage> {
  if (!(await moduleFlags.isEnabled(ctx, 'communities'))) throw new ApiError(404, 'NOT_FOUND');

  const visible = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      select c.id from public.communities c
       where c.id = ${communityId}::uuid
         and c.tenant_id = ${ctx.tenantId}::uuid
         and c.deleted_at is null
       limit 1`);
    return rows[0];
  });
  if (!visible) throw new ApiError(404, 'NOT_FOUND');

  const page = await feedPage(ctx, query, sql`and p.community_id = ${communityId}::uuid`);

  // The SHAPE of the read. A community NAME is member-facing content and never reaches a log line
  // (T-05-06) — the id does, exactly as the post id does.
  log.info(
    {
      event: 'feed.community.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId,
      limit: query.limit,
      returned: page.items.length,
      hasNext: page.nextCursor !== null,
    },
    'community feed listed',
  );

  return page;
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

/* ── Shared by the create and the edit path (04-09) ────────────────────────────────────────────── */

/** One referenced asset, in insert order, with the `(kind, purpose)` pair it MUST have. */
type WantedMedia = { assetId: string; kind: 'image' | 'video' | 'file'; position: number };

/**
 * The three body-shape rules, in the SERVICE (D-53 and the two per-post caps).
 *
 * The route's schema already refuses these shapes and this is not redundant defence: `createPost`
 * and `updatePost` are also reachable from the seed, from a future admin import and from any handler
 * that assembles its own input, none of which pass through the route's validator.
 */
function assertMediaShape(images: string[], attachments: string[], hasVideo: boolean): void {
  if (images.length > 0 && hasVideo) {
    throw new ApiError(400, 'VALIDATION_FAILED', { media: 'gallery_and_video' });
  }
  if (images.length > FEED_MAX_IMAGES) {
    throw new ApiError(400, 'VALIDATION_FAILED', { media: 'too_many_images' });
  }
  if (attachments.length > FEED_MAX_ATTACHMENTS) {
    throw new ApiError(400, 'VALIDATION_FAILED', { media: 'too_many_attachments' });
  }
}

/** The insert order the gallery's `position` comes from: images, then the video, then the files. */
function wantedMediaFor(
  images: string[],
  video: string | null,
  attachments: string[],
): WantedMedia[] {
  return [
    ...images.map((assetId, position) => ({ assetId, kind: 'image' as const, position })),
    ...(video !== null ? [{ assetId: video, kind: 'video' as const, position: 0 }] : []),
    ...attachments.map((assetId, position) => ({ assetId, kind: 'file' as const, position })),
  ];
}

/**
 * ONE validation read for every referenced id, inside the writing transaction — shared verbatim by
 * create and edit (T-04-56: an edit that attaches another tenant's asset must be refused by the
 * SAME rule, not by a second copy of it that could drift).
 *
 * The read runs in the TENANT LANE, so `media_assets_tenant_select` is what scopes it: another
 * tenant's asset id simply does not come back, and the refusal is the same one an unknown id gets —
 * there is nothing here that compares tenant ids, so no later edit can turn this into a 403 that
 * confirms the asset exists somewhere (T-04-22).
 */
async function validateAssets(tx: Tx, wanted: WantedMedia[]): Promise<void> {
  if (wanted.length === 0) return;
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
    const expectedPurpose = item.kind === 'file' ? 'attachment' : 'post';
    // D-53 / Phase 3: a video may be published while its transcode runs — the card shows the
    // `processando` placeholder. Everything else must already be `ready`.
    const statusOk =
      asset?.status === 'ready' || (item.kind === 'video' && asset?.status === 'processing');
    if (!asset || asset.kind !== item.kind || asset.purpose !== expectedPurpose || !statusOk) {
      throw new ApiError(400, 'VALIDATION_FAILED', { media: 'asset_not_usable' });
    }
  }
  // A duplicate id in the array would pass the loop above but fail `feed_post_media_position_uq`
  // only if it landed on the same position, so it is refused here instead.
  if (new Set(ids).size !== ids.length) {
    throw new ApiError(400, 'VALIDATION_FAILED', { media: 'asset_not_usable' });
  }
}

/** ONE multi-row insert of the post's media. `postMediaKind` is the PARENT's own `media_kind`. */
async function insertPostMedia(
  tx: Tx,
  ctx: RequestContext,
  postId: string,
  mediaKind: string,
  wanted: WantedMedia[],
): Promise<void> {
  if (wanted.length === 0) return;
  const values = sql.join(
    wanted.map(
      (item) =>
        sql`(${ctx.tenantId}::uuid, ${postId}::uuid, ${mediaKind}, ${item.assetId}::uuid, ${item.kind}, ${item.position})`,
    ),
    sql`, `,
  );
  await tx.execute(sql`
    insert into feed_post_media
      (tenant_id, post_id, post_media_kind, media_asset_id, kind, position)
    values ${values}`);
}

type LinkCandidate = { url: string; hash: string; normalised: string };

/**
 * MEDIA-04, the WRITE-TIME half, shared by create and edit.
 *
 * **A refusal is SWALLOWED (UI-D-13).** `assertAllowedUrl` throwing means the policy said no; the
 * post still publishes, the link still renders bare inside the caption, and the response carries
 * nothing that separates "blocked host" from "no metadata". An error here would turn the composer
 * into an internal-network scanner: an admin could paste `http://169.254.169.254/` and read the
 * difference. Silence is the mitigation. An EMPTY string is the composer's "no preview, thank you"
 * — `new URL('')` throws, so removing the prévia needs no second field on the create path.
 *
 * NOTE the write path deliberately does NOT check the target's ADDRESS. It cannot: deciding whether
 * a hostname points into a private range needs a resolver, and a resolver in a request path is the
 * outbound work this whole design moves to the worker. The SOCKET is the boundary (`guardedAgent`),
 * so a refused URL costs one row and one job that lands 'failed'.
 */
function resolveLinkCandidate(raw: string | null | undefined): LinkCandidate | null {
  if (raw === null || raw === undefined) return null;
  try {
    // The SAME matcher the caption renderer auto-links with (`firstUrlIn`), then the same
    // synchronous policy the worker re-applies. Two matchers would mean a card under a URL the
    // caption did not turn blue, or the reverse.
    assertAllowedUrl(raw);
    return { url: raw, hash: urlHash(raw), normalised: normaliseUrl(raw) };
  } catch {
    return null;
  }
}

/**
 * The per-tenant cache row for a candidate link, plus its unfurl job — resolved BEFORE the post
 * write so `link_preview_id` is stamped in one statement.
 *
 * `on conflict (tenant_id, url_hash) do nothing` is what makes a second post of the same link cost
 * NO second outbound fetch: the insert returns a row only when it actually created one, so the
 * enqueue runs exactly once per (tenant, url). A cache hit falls through to the select and reuses
 * whatever the first post already resolved. The uniqueness is per TENANT, so the same link in
 * another community is a separate row and a separate fetch — the price of the isolation (T-04-34).
 *
 * The enqueue is in the SAME transaction as the row: a rollback takes the job with it, so there is
 * no window where a `pending` preview exists with nothing to resolve it. `singletonKey` is the
 * preview id, so a retried request cannot stack two fetches of one URL (T-07-04).
 */
async function upsertLinkPreview(
  tx: Tx,
  ctx: RequestContext,
  candidate: LinkCandidate | null,
): Promise<string | null> {
  if (candidate === null) return null;

  const insertedPreview = await tx.execute<{ id: string }>(sql`
    insert into feed_link_previews (tenant_id, url_hash, url, status)
    values (${ctx.tenantId}::uuid, ${candidate.hash}, ${candidate.normalised}, 'pending')
    on conflict (tenant_id, url_hash) do nothing
    returning id`);

  const fresh = insertedPreview[0];
  if (fresh) {
    await enqueueInTx(
      tx,
      FEED_UNFURL_QUEUE,
      { tenantId: ctx.tenantId, previewId: fresh.id, url: candidate.normalised },
      { singletonKey: fresh.id },
    );
    return fresh.id;
  }

  const existing = await tx.execute<{ id: string }>(sql`
    select id from feed_link_previews where url_hash = ${candidate.hash} limit 1`);
  return existing[0]?.id ?? null;
}

/**
 * COMM-04's destination check — VALIDATION, never a permission, and it runs inside the post's OWN
 * transaction so a community cannot be archived between the check and the insert.
 *
 * Three answers, and the asymmetry between them is the security decision (D-23, T-05-12, T-05-13):
 *  - not visible in this lane (unknown id, ANOTHER TENANT'S id, soft-deleted) → a BARE 404 with no
 *    `details`. A per-cause code over an enumerable uuid space would let the composer enumerate
 *    another organisation's containers one 400 at a time;
 *  - visible but `archived` → `400 VALIDATION_FAILED { community: 'archived' }`. This one IS
 *    distinguishable, and safely: the member can already read that community's page and see the
 *    "Arquivada" pill, so the code discloses nothing new;
 *  - active → the insert proceeds.
 *
 * The read runs in the TENANT LANE, so `communities_tenant_isolation` is what scopes it. The
 * explicit `tenant_id` predicate beside it is layer 2 of the three, exactly as `listCommunityFeed`
 * carries it: a cross-tenant `communityId` cannot be written even if a policy were ever relaxed,
 * and the foreign key is the third layer underneath both.
 */
async function resolveCommunityTarget(
  ctx: RequestContext,
  tx: Tx,
  communityId: string,
): Promise<void> {
  const rows = await tx.execute<{ status: string }>(sql`
    select c.status from public.communities c
     where c.id = ${communityId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid
       and c.deleted_at is null
     limit 1`);
  const community = rows[0];
  if (!community) throw new ApiError(404, 'NOT_FOUND');
  if (community.status === 'archived') {
    throw new ApiError(400, 'VALIDATION_FAILED', { community: 'archived' });
  }
}

/**
 * `POST /v1/feed/posts` (FEED-08, COMM-04).
 *
 * - `tenantId` and `authorUserId` come from `ctx`, never from the body (T-04-02, T-07-01). The
 *   policy's `with check (tenant_id = app.tenant_id())` makes a forged stamp a `42501` rather than a
 *   cross-tenant write, so the rule is enforced twice on purpose.
 * - `emit` runs only after `withTenantTx` RESOLVES, and even then only QUEUES the event on
 *   `ctx.events`; the response middleware delivers it once the handler returned. A subscriber can
 *   therefore never observe a post that a rollback erased (MOD-03, criterion 4).
 * - **COMM-04's write is TWO checks, not one.** The PERMISSION is the route's literal
 *   `requirePermission('feed.post.create')` — it is a post, and publishing into a community is not a
 *   second kind of act. The destination is then VALIDATED here (`resolveCommunityTarget`) against
 *   this tenant's own rows. Do not collapse the two: a role check on the community would hard-code
 *   V1's posting policy, and a permission-shaped refusal would answer 403 where the product means
 *   "that container is archived".
 */
export async function createPost(ctx: RequestContext, input: CreatePost): Promise<FeedPost> {
  const images = input.imageAssetIds ?? [];
  const attachments = input.attachmentAssetIds ?? [];
  const video = input.videoAssetId ?? null;

  assertMediaShape(images, attachments, video !== null);

  // D-53's discriminator, derived from the input — never sent by the client. The parent's single
  // `media_kind` is what `feed_post_media_kind_fk` then constrains every media row against.
  const mediaKind: 'none' | 'gallery' | 'video' =
    video !== null ? 'video' : images.length > 0 ? 'gallery' : 'none';

  const wanted = wantedMediaFor(images, video, attachments);

  /**
   * MEDIA-04, the CREATE-TIME half. The roadmap's "unfurled server-side at create time" is satisfied
   * here: the URL is chosen, validated and its cache row created inside the post's own transaction.
   * The bytes are fetched by the worker (`server/unfurl/job.ts`) — an outbound fetch to a host the
   * caption named has no business inside a Cloud Run request.
   */
  const linkCandidate = resolveLinkCandidate(input.linkUrl ?? firstUrlIn(input.caption));

  const communityId = input.communityId ?? null;

  const created = await withTenantTx(ctx, async (tx) => {
    // BEFORE the assets and before the preview: a refused destination must cost neither an asset
    // validation nor an outbound-fetch cache row, and it must be the first thing the caller is told.
    if (communityId !== null) await resolveCommunityTarget(ctx, tx, communityId);
    await validateAssets(tx, wanted);
    const previewId = await upsertLinkPreview(tx, ctx, linkCandidate);

    const [inserted] = await tx
      .insert(feedPosts)
      .values({
        tenantId: ctx.tenantId,
        authorUserId: ctx.userId,
        communityId,
        caption: input.caption,
        mediaKind,
        linkPreviewId: previewId,
      })
      .returning();
    if (!inserted) throw new ApiError(500, 'INTERNAL');

    await insertPostMedia(tx, ctx, inserted.id, mediaKind, wanted);

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
      // The destination as an ID (COMM-04). A community NAME is member-facing content and never
      // reaches a log line, exactly as a caption does not (T-05-06).
      communityId,
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

/* ── FEED-03: the edit and the soft delete (04-09) ─────────────────────────────────────────────── */

/**
 * The shape the update needs before it can decide anything: the post's current caption, its
 * `media_kind`, its preview and HOW MANY media rows it carries — read in ONE statement behind the
 * SAME two predicates the update itself carries.
 */
type EditableRow = {
  caption: string;
  media_kind: 'none' | 'gallery' | 'video';
  link_preview_id: string | null;
  media_count: number;
};

/**
 * `PATCH /v1/feed/posts/{postId}` (FEED-03).
 *
 * **TWO PREDICATES, AND NEITHER IS A ROLE CHECK — do not "simplify" either away.**
 *
 *  - `author_user_id = ctx.userId` is the AUTHORISATION, and it lives in the statement rather than
 *    in a branch above it. The route's `requirePermission('feed.post.manage')` says "this role may
 *    manage posts"; this says "this one is yours". V1 needs both, because a second `admin_tenant`
 *    of the same tenant holds the permission and must still not touch a colleague's post (T-04-54).
 *    Replacing it with a role comparison would silently widen the route to every admin.
 *  - `deleted_at is null` is what makes DELETE WIN a concurrent edit: an edit applied to a post that
 *    was soft-deleted in between touches zero rows and answers the same bare 404 an unknown id gets,
 *    rather than resurrecting or half-updating it (T-04-57).
 *
 * Zero rows is ONE bare 404 for all of it — someone else's post, an unknown id, another tenant's,
 * already removed — so a second admin cannot even probe existence (D-23).
 *
 * **`edited_at` is set on ANY persisted change, media included** (UI-D-15), and a re-save of
 * byte-identical content still advances it: "edited" here means "the author saved this post again",
 * not "the bytes differ". A diff-gated marker would need a canonical comparison of caption, media
 * order and preview, and would quietly tell the reader nothing happened when the author reordered
 * two photos back and forth.
 *
 * **`community_id` IS NOT IN THIS STATEMENT, and adding it would be a product change** (D-72,
 * T-05-17). A post's placement is fixed at publication: `updatePostSchema` has no `communityId` key
 * and is `.strict()`, so an edit body carrying one is REFUSED rather than ignored, and the `set`
 * list below never names the column even for a caller that assembled its own input. A "Mover para…"
 * would have to decide what happens to the likes, comments and share links the post already
 * accumulated in its old placement; a mis-placed post is deleted and reposted instead.
 *
 * **The media triple is a REPLACEMENT** (see `updatePostSchema`): present any of the three keys and
 * the post's whole media set becomes what they describe. The rows are deleted BEFORE the parent's
 * `media_kind` moves, because `feed_post_media_kind_fk` points at `(id, media_kind)` and would
 * refuse the update while a row still named the old pair.
 */
export async function updatePost(
  ctx: RequestContext,
  postId: string,
  input: UpdatePost,
): Promise<FeedPost> {
  const mediaReplaced =
    input.imageAssetIds !== undefined ||
    input.videoAssetId !== undefined ||
    input.attachmentAssetIds !== undefined;

  const images = input.imageAssetIds ?? [];
  const attachments = input.attachmentAssetIds ?? [];
  const video = input.videoAssetId ?? null;
  if (mediaReplaced) assertMediaShape(images, attachments, video !== null);
  const wanted = mediaReplaced ? wantedMediaFor(images, video, attachments) : [];
  const nextMediaKind: 'none' | 'gallery' | 'video' =
    video !== null ? 'video' : images.length > 0 ? 'gallery' : 'none';

  const updated = await withTenantTx(ctx, async (tx) => {
    // The author + live-row pair, read first so the resulting state can be judged before anything
    // is written. `for update` holds the row for the rest of the transaction, so a delete that
    // arrives mid-edit queues behind it instead of interleaving with the media rewrite.
    const current = await tx.execute<EditableRow>(sql`
      select p.caption,
             p.media_kind,
             p.link_preview_id,
             (select count(*) from feed_post_media m where m.post_id = p.id)::int as media_count
        from feed_posts p
       where p.id = ${postId}::uuid
         and p.author_user_id = ${ctx.userId}::uuid
         and p.deleted_at is null
       for update`);
    const row = current[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');

    const caption = input.caption ?? row.caption;
    const mediaKind = mediaReplaced ? nextMediaKind : row.media_kind;
    const mediaCount = mediaReplaced ? wanted.length : row.media_count;

    // The publishable rule, judged against the RESULTING row rather than against the body: an edit
    // that only clears the caption is refused exactly when the post keeps no media (FEED-01/empty).
    // Same `empty_post` code `createPostSchema` raises, so both paths read as one rule.
    if (caption.length === 0 && mediaCount === 0) {
      throw new ApiError(400, 'VALIDATION_FAILED', {
        issues: [{ path: 'caption', message: 'empty_post' }],
      });
    }

    if (mediaReplaced) {
      await validateAssets(tx, wanted);
      // BEFORE the parent's `media_kind` moves — see the docblock.
      await tx.execute(sql`delete from feed_post_media where post_id = ${postId}::uuid`);
    }

    /**
     * The preview, in three mutually exclusive branches:
     *  - `linkPreviewId` present (the composer's "Remover prévia", which only ever sends `null`):
     *    that value wins. A uuid is re-read in the TENANT LANE first, so a crafted id belonging to
     *    another tenant cannot be stamped onto this post — referential checks run as the referenced
     *    table's owner and would not see RLS at all;
     *  - otherwise a caption or an explicit `linkUrl` in the body re-resolves the candidate exactly
     *    as `createPost` does, so an edited caption that drops its URL also drops the card;
     *  - otherwise (a media-only edit) the post keeps whatever preview it had.
     */
    let previewId = row.link_preview_id;
    if (input.linkPreviewId !== undefined) {
      if (input.linkPreviewId === null) {
        previewId = null;
      } else {
        const visible = await tx.execute<{ id: string }>(
          sql`select id from feed_link_previews where id = ${input.linkPreviewId}::uuid limit 1`,
        );
        if (!visible[0])
          throw new ApiError(400, 'VALIDATION_FAILED', { media: 'asset_not_usable' });
        previewId = input.linkPreviewId;
      }
    } else if (input.caption !== undefined || input.linkUrl !== undefined) {
      previewId = await upsertLinkPreview(
        tx,
        ctx,
        resolveLinkCandidate(input.linkUrl ?? firstUrlIn(caption)),
      );
    }

    const written = await tx.execute<{ id: string }>(sql`
      update feed_posts
         set caption = ${caption},
             media_kind = ${mediaKind},
             link_preview_id = ${previewId}::uuid,
             edited_at = now()
       where id = ${postId}::uuid
         and author_user_id = ${ctx.userId}::uuid
         and deleted_at is null
      returning id`);
    if (!written[0]) throw new ApiError(404, 'NOT_FOUND');

    if (mediaReplaced) await insertPostMedia(tx, ctx, postId, mediaKind, wanted);

    const rows = await tx.execute<FeedRow>(sql`
      ${postProjection(ctx.userId)}
       where p.id = ${postId}::uuid
       limit 1`);
    const projected = rows[0];
    if (!projected) throw new ApiError(500, 'INTERNAL');
    return projected;
  }).catch((error: unknown) => {
    if (isMediaShapeViolation(error)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { media: 'gallery_and_video' });
    }
    throw error;
  });

  emit(ctx, 'post.edited', {
    tenantId: ctx.tenantId,
    postId: updated.id,
    authorUserId: updated.author_user_id,
    actorUserId: ctx.userId,
    occurredAt: updated.edited_at ?? updated.created_at,
  });

  log.info(
    {
      event: 'feed.post.edited',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      postId: updated.id,
      // Shape only, never a caption or a filename (T-04-05).
      captionLength: updated.caption.length,
      mediaKind: updated.media_kind,
      mediaCount: updated.media.length,
    },
    'post edited',
  );

  return toPost(updated, ctx.userId);
}

/**
 * `DELETE /v1/feed/posts/{postId}` (FEED-03) — a SOFT delete.
 *
 * **NOTHING IS DELETED.** The row keeps its `deleted_at` stamp, its `feed_post_media` rows, its
 * comments and its media assets: Phase 8's MODER-01 has to be able to SEE a removed post through
 * the tenant lane, and the Phase 3 sweeper collects orphaned bytes on its own schedule rather than
 * inline on a request that a member is waiting on. A `delete from` here would also take the
 * comments with it by cascade, which is a moderation decision this route does not get to make.
 *
 * The SAME two predicates `updatePost` carries, for the same two reasons: `author_user_id` is the
 * authorisation (a second admin holding `feed.post.manage` still cannot remove a colleague's post,
 * T-04-54) and `deleted_at is null` makes a REPEAT delete a no-op that answers the identical bare
 * 404 an unknown id gets — idempotent from the caller's side, with no second event and no second
 * stamp (FEED-03/idempotency). Neither is a role check; do not "simplify" either into one.
 */
export async function softDeletePost(ctx: RequestContext, postId: string): Promise<void> {
  const authorUserId = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ author_user_id: string }>(sql`
      update feed_posts
         set deleted_at = now()
       where id = ${postId}::uuid
         and author_user_id = ${ctx.userId}::uuid
         and deleted_at is null
      returning author_user_id`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return row.author_user_id;
  });

  emit(ctx, 'post.deleted', {
    tenantId: ctx.tenantId,
    postId,
    authorUserId,
    actorUserId: ctx.userId,
    occurredAt: new Date().toISOString(),
  });

  log.info(
    {
      event: 'feed.post.deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      postId,
    },
    'post soft-deleted',
  );
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
 * The two constraint names that mean "you tried to like a STORY comment" (STORY-05, 05-07), and
 * nothing else. Same discipline as above: naming them individually is what keeps an unrelated
 * integrity error a 500 instead of a 400 the client would act on.
 *
 * `feed_likes_comment_kind_chk` raises `23514` when the row names the target honestly; the composite
 * `feed_likes_comment_fk` raises `23503` when it lies, because `(comment, 'post')` does not exist
 * for a comment whose generated `target_kind` is `'story'`. Both are the DATABASE refusing — this
 * file never reads the parent comment's target to decide.
 */
const STORY_COMMENT_LIKE_CONSTRAINTS = new Set([
  'feed_likes_comment_kind_chk',
  'feed_likes_comment_fk',
]);

/**
 * Postgres `23503`/`23514` on one of a named set of constraints, possibly wrapped by drizzle's
 * `DrizzleQueryError` — the cause chain is walked exactly as `isUniqueViolation` does for 02-05's
 * duplicate-slug mapping (`packages/core/server/platform/tenants.ts`), with a `seen` set so a
 * self-referential `cause` cannot loop.
 */
function isConstraintViolation(error: unknown, constraints: ReadonlySet<string>): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23503' || e.code === '23514') {
      const name = typeof e.constraint_name === 'string' ? e.constraint_name : '';
      return constraints.has(name);
    }
    current = e.cause;
  }
  return false;
}

/** A reply that tried to become a second level — the Phase 4 rule, unchanged by 05-07. */
function isReplyDepthViolation(error: unknown): boolean {
  return isConstraintViolation(error, REPLY_DEPTH_CONSTRAINTS);
}

/** A like that named a STORY comment — refused by the CHECK if honest, by the FK if lying. */
function isStoryCommentLikeViolation(error: unknown): boolean {
  return isConstraintViolation(error, STORY_COMMENT_LIKE_CONSTRAINTS);
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
 *
 * **STORY-05's second half is refused HERE, by the database, on this exact statement (05-07).**
 * `comment_target_kind` is the LITERAL `'post'`, never `c.target_kind`: a like that names a STORY
 * comment therefore asks `feed_likes_comment_fk` for a `(comment, 'post')` pair that does not exist
 * and gets `23503`, which this function turns into `400 VALIDATION_FAILED
 * { like: 'story_comment_not_likeable' }`. There is no `if (comment.storyId) throw` anywhere in
 * this file, and adding one would be the bug — it would keep the suite green with the constraint
 * missing, and it would be a read-then-write two concurrent requests could both pass.
 */
export async function likeComment(ctx: RequestContext, commentId: string) {
  const { likeCount, authorUserId } = await withTenantTx(ctx, async (tx) => {
    try {
      await tx.execute(sql`
        insert into feed_likes (tenant_id, user_id, comment_id, comment_target_kind)
        select ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, c.id, 'post'
          from feed_comments c
         where c.id = ${commentId}::uuid and c.deleted_at is null
        on conflict (user_id, comment_id) where comment_id is not null do nothing`);
    } catch (error) {
      if (isStoryCommentLikeViolation(error)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { like: 'story_comment_not_likeable' });
      }
      throw error;
    }

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
              insert into feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
              select ${ctx.tenantId}::uuid, p.id, ${ctx.userId}::uuid, ${input.body}, 0, null, null, null
                from feed_posts p
               where p.id = ${postId}::uuid and p.deleted_at is null
              returning id`)
          : // `parent_depth` is the LITERAL 0, not `c.depth`, and `parent_target_kind` is the
            // LITERAL 'post', not `c.target_kind`: naming a reply — or a STORY comment (05-07) — as
            // the parent must be refused by the foreign key rather than quietly recorded.
            await tx.execute<{ id: string }>(sql`
              insert into feed_comments (tenant_id, post_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
              select ${ctx.tenantId}::uuid, p.id, ${ctx.userId}::uuid, ${input.body}, 1, c.id, 0, 'post'
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
