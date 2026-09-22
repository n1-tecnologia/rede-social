import { withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleLogger } from '@tria/core/server/logging';
import { decodeCursor, encodeCursor } from '@tria/core/server/paging';
import { sql } from 'drizzle-orm';
import type { CreatePost, FeedPage, FeedPost, FeedQuery } from '../contracts/index';
import { feedPosts } from '../db/schema';

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

/** One hydrated row of the list projection. Snake_case: it comes straight off `tx.execute`. */
type FeedRow = {
  id: string;
  created_at: Date;
  edited_at: Date | null;
  caption: string;
  community_id: string | null;
  like_count: number;
  comment_count: number;
  author_user_id: string;
  membership_id: string;
  display_name: string;
  avatar_asset_id: string | null;
};

/**
 * THE projection, written once and shared by the list and the detail read so the two can never
 * disagree about what a post looks like.
 *
 * The author's display name and avatar asset id come back in the SAME statement as the post (Pitfall
 * 3): a feed page costs ONE statement against the feed tables, never one plus N. The join carries NO
 * tenant condition — `memberships` and `member_profiles` are both RLS-scoped to this lane, so writing
 * one would be dead weight that a reader could mistake for the actual isolation.
 */
const PROJECTION = sql`
    select p.id,
           p.created_at,
           p.edited_at,
           p.caption,
           p.community_id,
           p.like_count,
           p.comment_count,
           p.author_user_id,
           ms.id as membership_id,
           mp.display_name,
           mp.avatar_asset_id
      from feed_posts p
      join memberships ms on ms.user_id = p.author_user_id
      join member_profiles mp on mp.membership_id = ms.id`;

/**
 * Row → published contract. Timestamps cross the wire as ISO strings, never as `Date`.
 *
 * `viewerLiked` is hard-`false` here: 04-03 adds `left join feed_likes l on l.post_id = p.id and
 * l.user_id = app.user_id()` to the SAME statement rather than a second query per post.
 * `canManage` is "I wrote it" for now; Phase 8's MODER-01 widens it to the moderator case.
 */
const toPost = (row: FeedRow, viewerUserId: string): FeedPost => ({
  id: row.id,
  createdAt: row.created_at.toISOString(),
  editedAt: row.edited_at?.toISOString() ?? null,
  caption: row.caption,
  author: {
    membershipId: row.membership_id,
    displayName: row.display_name,
    avatarAssetId: row.avatar_asset_id,
  },
  likeCount: row.like_count,
  commentCount: row.comment_count,
  viewerLiked: false,
  communityId: row.community_id,
  canManage: row.author_user_id === viewerUserId,
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
      ${PROJECTION}
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
    rows.length > limit && last
      ? encodeCursor({ n: last.created_at.toISOString(), id: last.id })
      : null;

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
      ${PROJECTION}
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
  const created = await withTenantTx(ctx, async (tx) => {
    const [inserted] = await tx
      .insert(feedPosts)
      .values({
        tenantId: ctx.tenantId,
        authorUserId: ctx.userId,
        caption: input.caption,
      })
      .returning();
    if (!inserted) throw new ApiError(500, 'INTERNAL');

    // The author's own membership + profile, in the SAME transaction: the created post is returned
    // in exactly the shape the list returns, so the composer can prepend it without a re-read.
    const rows = await tx.execute<FeedRow>(sql`
      ${PROJECTION}
       where p.id = ${inserted.id}::uuid
       limit 1`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return row;
  });

  emit(ctx, 'post.published', {
    tenantId: ctx.tenantId,
    postId: created.id,
    authorUserId: ctx.userId,
    communityId: created.community_id,
    // 04-04 sets this from `media_kind` once `feed_post_media` exists.
    hasMedia: false,
    occurredAt: created.created_at.toISOString(),
  });

  log.info(
    {
      event: 'feed.post.created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      postId: created.id,
      captionLength: input.caption.length,
    },
    'post created',
  );

  return toPost(created, ctx.userId);
}
