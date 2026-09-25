import { type Tx, withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleLogger } from '@tria/core/server/logging';
import { moduleFlags } from '@tria/core/server/modules/flags-cache';
import { decodeCursor, encodeCursor, keysetComparison } from '@tria/core/server/paging';
import { type SQL, sql } from 'drizzle-orm';
import {
  type CreateStoryComment,
  type CreateStoryHighlight,
  type HighlightCover,
  type HighlightDetail,
  type HighlightList,
  type HighlightMembershipResult,
  type HighlightSummary,
  type PublishStory,
  STORY_HIGHLIGHT_MAX_ITEMS,
  STORY_HIGHLIGHT_MAX_PER_PLACE,
  STORY_HIGHLIGHT_MAX_TITLE,
  type StoryComment,
  type StoryCommentPage,
  type StoryCommentsQuery,
  type StoryLikeResult,
  type StoryMediaKind,
  type StoryPage,
  type StoryPinResult,
  type StoryPins,
  type StoryQuery,
  type StorySummary,
  type UpdateHighlight,
} from '../contracts/index';

const log = moduleLogger('module-stories');

/**
 * The stories service (STORY-01, STORY-03) — a PURE TENANT-LANE area.
 *
 * Every function is `withTenantTx(ctx, …)`: the tenant is never a parameter a caller supplies and
 * never a value this file compares. Layer 3 (`stories_tenant_isolation`) supplies it under the
 * explicit `tenant_id` predicate the statements also carry, which is what makes the cross-tenant 404
 * fall out of the SAME code path as an unknown id — there is nothing here that compares tenant ids,
 * so no later edit can turn that 404 into a 403 that confirms the row exists somewhere (D-23).
 *
 * **Every read carries `deleted_at is null` ITSELF.** Phase 4 deliberately kept that predicate out
 * of `tenantIsolationPolicy` so Phase 8's moderation can still see removed rows through the tenant
 * lane (Pitfall 9); a read that forgets it shows deleted content and does not fail a test that only
 * checks tenant isolation.
 *
 * **There is no expiry job in this file, and there must never be one.** `expires_at > now()` is a
 * PREDICATE on one read. Nothing here updates, blanks or deletes a row because a clock passed
 * (STORY-03).
 */

/**
 * One hydrated row of the projection. Snake_case: it comes straight off `tx.execute`, which returns
 * the driver's own row objects — NOT Drizzle's column-mapped ones — so the timestamps arrive as text
 * and are formatted by the statement itself (see `ISO_MICROSECONDS`).
 */
type StoryRow = {
  id: string;
  author_user_id: string;
  media_asset_id: string;
  media_kind: StoryMediaKind;
  media_variant_widths: number[] | null;
  media_status: StorySummary['mediaStatus'];
  media_failure_reason: string | null;
  duration_seconds: number | null;
  caption: string;
  published_at: string;
  expires_at: string;
  is_active: boolean;
  like_count: number;
  comment_count: number;
  viewer_liked: boolean;
  /** STORY-04's per-story pin count, counted in the SAME statement (null before 05-08's GREEN). */
  pinned_community_count: number | null;
};

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres rather than by JavaScript — the
 * `listFeed` / `listCommunities` rule restated for this module's ordering column.
 *
 * This matters for correctness, not tidiness. The cursor's `n` is this exact string, and the page
 * predicate compares it back as `::timestamptz`. Round-tripping through a JS `Date` would truncate
 * `timestamptz`'s microseconds to milliseconds, moving the page boundary EARLIER than the row it
 * came from — which silently SKIPS any story whose window ends in the same millisecond but a later
 * microsecond. Keeping the full precision in text makes `(expires_at, id)` a genuinely total order
 * end to end.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/**
 * THE projection, written once and shared by the strip, the admin history and the read-back after a
 * publish, so the three can never disagree about what a story looks like.
 *
 * The media asset's ladder, status, failure reason and duration come back in the SAME statement as
 * the story (Pitfall 11): a page costs ONE statement, never one plus N, and
 * `feed-query-budget.test.ts` asserts that with a ceiling AND a floor. The `join media_assets`
 * carries NO tenant condition — `media_assets_tenant_select` is what decides visibility in this
 * lane, so writing one would be dead weight a reader could mistake for the actual isolation. It is
 * an INNER join because `media_asset_id` is NOT NULL: a story whose asset the lane cannot see has
 * nothing to render and must not occupy a circle.
 *
 * `viewer_liked` reads `feed_likes` through RAW SQL rather than through `@tria/module-feed`'s
 * schema export: a `module -> module` package dependency is denied by `turbo boundaries`, and the
 * table is Phase 4's published shape (`feed_likes_story_uq` already scopes it per user and story).
 * The same posture 05-03 took for the feed's `left join public.communities`.
 *
 * `is_active` is computed HERE, under the statement's own `now()`, so the flag and the rows it
 * describes come from one clock (UI-D-14).
 *
 * `pinned_community_count` (STORY-04) is counted in the SAME statement for the same reason
 * everything else is: UI-D-40's history row renders it, and fetching it per row would be the N+1
 * `feed-query-budget.test.ts` has a ceiling for. It rides the strip's read too, unread, because one
 * projection serving three surfaces is what stops the three disagreeing about what a story is.
 *
 * `extra` is how the Destaques read adds the two PIN columns its cursor is built from without
 * either duplicating this column list or pushing pin-specific columns onto the other two reads.
 */
function storyProjection(viewerUserId: string, extra: SQL | null = null) {
  return sql`
    select s.id,
           s.author_user_id,
           s.media_asset_id,
           s.media_kind,
           a.variant_widths as media_variant_widths,
           a.status as media_status,
           a.failure_reason as media_failure_reason,
           a.duration_seconds,
           s.caption,
           to_char(s.published_at at time zone 'utc', ${ISO_MICROSECONDS}) as published_at,
           to_char(s.expires_at at time zone 'utc', ${ISO_MICROSECONDS}) as expires_at,
           (s.expires_at > now()) as is_active,
           s.like_count,
           s.comment_count,
           exists (
             select 1 from feed_likes l
              where l.story_id = s.id
                and l.user_id = ${viewerUserId}::uuid
           ) as viewer_liked,
           (
             select count(*)::int from story_community_pins sp
              where sp.story_id = s.id
           ) as pinned_community_count
           ${extra ?? sql``}
      from stories s
      join media_assets a on a.id = s.media_asset_id`;
}

/** Row → published contract. Timestamps cross the wire as ISO strings, never as `Date`. */
const toStory = (row: StoryRow): StorySummary => ({
  id: row.id,
  authorUserId: row.author_user_id,
  mediaAssetId: row.media_asset_id,
  mediaKind: row.media_kind,
  // `[]` for an asset whose worker has not derived a ladder yet — `MediaImage` then renders its
  // neutral box, which is the same branch a failed fetch takes.
  mediaVariantWidths: row.media_variant_widths ?? [],
  mediaStatus: row.media_status,
  mediaFailureReason: row.media_failure_reason,
  caption: row.caption,
  publishedAt: row.published_at,
  expiresAt: row.expires_at,
  isActive: row.is_active,
  durationSeconds: row.duration_seconds,
  likeCount: row.like_count,
  commentCount: row.comment_count,
  viewerLiked: row.viewer_liked,
  pinnedCommunityCount: row.pinned_community_count ?? 0,
});

/** The over-fetch page split, shared by both list reads so the two cannot disagree about `nextCursor`. */
function toPage(rows: StoryRow[], limit: number): StoryPage {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.expires_at, id: last.id }) : null;
  return { items: page.map(toStory), nextCursor };
}

/**
 * `GET /v1/stories?limit=&cursor=` (STORY-01, STORY-03, D-78) — one keyset page of the tenant's
 * ACTIVE stories, newest first.
 *
 * **Three predicates, and each one is load-bearing:**
 *  - `expires_at > now()` is STORY-03 in full. There is no job, no sweeper and no status column
 *    behind it — a story leaves this list because the clock moved, and its ROW IS UNTOUCHED.
 *  - `deleted_at is null` is carried here rather than by the policy (Pitfall 9).
 *  - `a.status = 'ready'` is R-P8: a video that is still transcoding, or one the worker REFUSED for
 *    duration, must never occupy a circle. The admin still sees both in `listOwnStories`, which is
 *    the whole point — a story that vanished with no explanation must not be the only feedback.
 *
 * Ordering is `expires_at desc, id desc`: the ordered pair `stories_tenant_expires_idx` is built on,
 * and the column the range predicate is ON. Ordering by `published_at` would mean exactly the same
 * thing under a fixed 24 h window and would cost a sort over a bitmap heap scan (both plans
 * measured). The cursor's `n` is the row's own `expires_at`, read back from the projection rather
 * than re-derived in JavaScript, so it can never disagree with the index.
 *
 * `decodeCursor` is TOTAL: a tampered, truncated or stale envelope degrades to page 1 instead of
 * raising, and nothing from the string reaches SQL before `cursorSchema` accepted it.
 */
export async function listActiveStories(
  ctx: RequestContext,
  query: StoryQuery,
): Promise<StoryPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<StoryRow>(sql`
      ${storyProjection(ctx.userId)}
       where s.tenant_id = ${ctx.tenantId}::uuid
         and s.deleted_at is null
         and s.expires_at > now()
         and a.status = 'ready'
         and (
           ${afterAt}::timestamptz is null
           or (s.expires_at, s.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by s.expires_at desc, s.id desc
       limit ${limit + 1}`),
  );

  const page = toPage(rows, limit);

  // The SHAPE of the read — counts, ids and flags. A story CAPTION is member-facing content and
  // never reaches a log line, an error `details` payload or an OpenAPI example (T-05-29).
  log.info(
    {
      event: 'stories.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      limit,
      returned: page.items.length,
      hasNext: page.nextCursor !== null,
    },
    'stories listed',
  );

  return page;
}

/**
 * `GET /v1/stories/mine` (D-84) — the SAME query as the strip with the range predicate and the
 * readiness filter DROPPED, which is the whole reason `stories_tenant_expires_idx` serves both.
 *
 * "Own" is the MANAGING view of the tenant's stories, not an author filter: the guard is
 * `stories.story.manage`, and V1's single publisher makes the two sets identical anyway. An author
 * predicate would be a second shape the one index would then have to serve badly, and it would hide
 * a co-admin's story from the person responsible for moderating it.
 *
 * This is where a `processing` story and a `rejected` one are visible — with `mediaStatus` and
 * `mediaFailureReason` on the payload so the history screen can render the Phase 3 `Processando` /
 * `Recusado` pill and the media catalog's own reason string (Pitfall 5).
 */
export async function listOwnStories(ctx: RequestContext, query: StoryQuery): Promise<StoryPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<StoryRow>(sql`
      ${storyProjection(ctx.userId)}
       where s.tenant_id = ${ctx.tenantId}::uuid
         and s.deleted_at is null
         and (
           ${afterAt}::timestamptz is null
           or (s.expires_at, s.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by s.expires_at desc, s.id desc
       limit ${limit + 1}`),
  );

  const page = toPage(rows, limit);

  log.info(
    {
      event: 'stories.list_own',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      limit,
      returned: page.items.length,
      hasNext: page.nextCursor !== null,
    },
    'own stories listed',
  );

  return page;
}

/**
 * `GET /v1/stories/{storyId}` — one story, ACTIVE OR NOT.
 *
 * ONE bare 404 with NO `details` payload for every miss — unknown id, another tenant's id,
 * soft-deleted (D-23, T-05-30). An EXPIRED story is deliberately still readable by id: 05-06's
 * viewer opens a single-item sequence from the history, and 05-08's pins make an expired story a
 * legitimate thing to fetch. The STRIP is what filters; the row read never does.
 */
export async function getStory(ctx: RequestContext, storyId: string): Promise<StorySummary> {
  const row = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<StoryRow>(sql`
      ${storyProjection(ctx.userId)}
       where s.tenant_id = ${ctx.tenantId}::uuid
         and s.id = ${storyId}::uuid
         and s.deleted_at is null
       limit 1`);
    return rows[0];
  });

  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return toStory(row);
}

/** What the asset lookup inside `publishStory`'s transaction needs to decide. */
type AssetRow = { kind: string; purpose: string };

/**
 * `POST /v1/stories` (STORY-01).
 *
 * - `tenantId` and `authorUserId` come from `ctx`, never from the body (T-05-25). The policy's
 *   `with check (tenant_id = app.tenant_id())` makes a forged stamp a `42501` rather than a
 *   cross-tenant write, so the rule is enforced twice on purpose.
 * - **The asset is resolved INSIDE the same transaction** (T-05-26). It must belong to this tenant
 *   (RLS decides that, not a comparison here) and carry `purpose = 'story'` with a matching kind. A
 *   foreign or unknown id is a BARE 404; a real asset of this tenant with the wrong purpose is a
 *   `400 { story: 'media_invalid' }`, because the caller can see that one and fixing it is their job.
 * - **A `processing` asset is ACCEPTED.** Publishing while a video transcodes is allowed (D-53's
 *   precedent): the row is created immediately, the strip filters it out until the asset is ready,
 *   and the 24 h window starts at PUBLISH rather than at ready. The copy says so; silently losing
 *   story life would be the alternative.
 * - `expires_at` is NOT in the insert. The column default is the window (STORY-03), so no client
 *   value and no service edit can lengthen it.
 * - `like_count` / `comment_count` are NOT in the insert either: both are trigger-owned.
 * - `emit` runs only after `withTenantTx` RESOLVES, and even then only QUEUES the event on
 *   `ctx.events`; the response middleware delivers it once the handler returned. A subscriber can
 *   therefore never observe a story that a rollback erased (MOD-03).
 *
 * **Born attached (05.1, D-99).** An optional `communityId` makes the story and its
 * `story_community_pins` row ONE write: the community lookup, the story insert and the pin insert
 * share this `withTenantTx`, so any refusal rolls the whole publish back and no client-side "publish
 * then pin" sequence exists anywhere. The target rules are `pinStory`'s own, through the SAME
 * helpers (`assertCommunityPinnable`, `insertStoryPin`): this tenant, not deleted, `status =
 * 'active'`; archived is `400 { pin: 'archived' }`, every miss the bare 404.
 *
 * - **Destination first**, as `createPost` does: community → asset → insert → pin → projection. A
 *   refused destination costs no asset validation, is the first thing the caller is told, and a
 *   refusal never follows a (rolled-back) insert. WITHOUT a community the statements are exactly
 *   today's three (asset → insert → projection).
 * - **The ROUTE owns the permission.** A body naming a community additionally needs
 *   `stories.story.manage` (pinning is the manage half); that check runs in the handler before this
 *   function is called, so this file never compares roles or permissions.
 * - **Events:** `story.published` keeps its five keys; when a pin row was written, `story.pinned` is
 *   emitted once in the existing `StoryPinned` shape — one event per pin row, whichever path wrote
 *   it. **Phase 7 caveat:** a born-attached story therefore raises BOTH events; a member-notification
 *   consumer must dedupe by `storyId` (or ignore `story.pinned`), or members get two notifications
 *   for one story.
 */
export async function publishStory(
  ctx: RequestContext,
  input: PublishStory,
): Promise<StorySummary> {
  // The service re-states the route's rule: `publishStory` is also reachable from the seed and from
  // any handler that assembles its own input, none of which pass through the route validator.
  const mediaAssetId = input.mediaAssetId;
  if (mediaAssetId === null) {
    throw new ApiError(400, 'VALIDATION_FAILED', { story: 'media_required' });
  }

  const communityId = input.communityId;

  const { row: created, pinned } = await withTenantTx(ctx, async (tx) => {
    // BEFORE the asset: a refused destination is the first thing the caller is told (see above).
    if (communityId !== undefined) {
      const community = await resolvePublishCommunity(tx, ctx, communityId);
      assertCommunityPinnable(community.status);
    }

    const assets = await tx.execute<AssetRow>(sql`
      select kind, purpose
        from media_assets
       where id = ${mediaAssetId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
         and deleted_at is null
       limit 1`);
    const asset = assets[0];
    // Unknown, another tenant's, or soft-deleted — one indistinguishable answer, no details.
    if (!asset) throw new ApiError(404, 'NOT_FOUND');
    if (asset.purpose !== 'story' || asset.kind !== input.mediaKind) {
      throw new ApiError(400, 'VALIDATION_FAILED', { story: 'media_invalid' });
    }

    const inserted = await tx.execute<{ id: string }>(sql`
      insert into stories (tenant_id, author_user_id, media_asset_id, media_kind, caption)
      values (${ctx.tenantId}::uuid,
              ${ctx.userId}::uuid,
              ${mediaAssetId}::uuid,
              ${input.mediaKind},
              ${input.caption})
      returning id`);
    const id = inserted[0]?.id;
    if (!id) throw new ApiError(500, 'INTERNAL');

    // A brand-new story cannot already be pinned, so this always inserts; the boolean is still read
    // from `returning id` rather than assumed, because it is what decides the event below.
    const pinWritten =
      communityId !== undefined ? await insertStoryPin(tx, ctx, id, communityId) : false;

    const rows = await tx.execute<StoryRow>(sql`
      ${storyProjection(ctx.userId)}
       where s.id = ${id}::uuid
       limit 1`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return { row, pinned: pinWritten };
  });

  emit(ctx, 'story.published', {
    tenantId: ctx.tenantId,
    storyId: created.id,
    authorUserId: created.author_user_id,
    mediaKind: created.media_kind,
    expiresAt: created.expires_at,
  });

  if (pinned && communityId !== undefined) {
    emit(ctx, 'story.pinned', {
      tenantId: ctx.tenantId,
      storyId: created.id,
      communityId,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'stories.published',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId: created.id,
      mediaKind: created.media_kind,
      mediaStatus: created.media_status,
      // An id or null, never a community NAME (T-05-06).
      communityId: communityId ?? null,
      // Lengths and flags, never the words themselves (T-05-29).
      captionLength: input.caption.length,
    },
    'story published',
  );

  return toStory(created);
}

/**
 * `DELETE /v1/stories/{storyId}` (D-84) — a SOFT delete behind `stories.story.manage`.
 *
 * Soft, not hard, for the same reason expiry is a predicate: the likes and comments members left on
 * a story are theirs, and a cascade would erase them. Phase 8's moderation reads the row through the
 * same tenant lane afterwards (Pitfall 9).
 *
 * A second delete of the same story is a no-op that still answers 204 and emits nothing: the
 * statement's `deleted_at is null` predicate matches zero rows, and an event counting transitions
 * must not announce one that did not happen.
 */
export async function deleteStory(ctx: RequestContext, storyId: string): Promise<void> {
  const removed = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string; author_user_id: string }>(sql`
      update stories
         set deleted_at = now()
       where tenant_id = ${ctx.tenantId}::uuid
         and id = ${storyId}::uuid
         and deleted_at is null
      returning id, author_user_id`);
    return rows[0];
  });

  // Unknown, another tenant's, or ALREADY deleted — one bare 404, no details (D-23). "Already
  // deleted" answering 404 is deliberate: the alternative tells a caller that an id they cannot see
  // exists, which is the existence oracle the whole posture removes.
  if (!removed) throw new ApiError(404, 'NOT_FOUND');

  emit(ctx, 'story.deleted', {
    tenantId: ctx.tenantId,
    storyId: removed.id,
    authorUserId: removed.author_user_id,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'stories.deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId: removed.id,
    },
    'story soft-deleted',
  );
}

/* ── Likes (STORY-05, first half) ─────────────────────────────────────────────────────────────── */

/** What the read-back after a toggle needs: the authoritative count and the notification recipient. */
type StoryCounterRow = { like_count: number; author_user_id: string };

/**
 * `POST /v1/stories/{storyId}/likes` (STORY-05) — a DIRECT copy of `likePost`, because it is the
 * same behaviour over the same table.
 *
 * Four properties, each of which is one line of SQL below:
 *
 *  - **The insert SELECTS the story rather than trusting the path parameter** (T-05-33). A story id
 *    this lane cannot see produces zero rows to insert, so a cross-tenant id cannot create a like
 *    row even though the row it names exists somewhere.
 *  - **`feed_likes_story_uq` is the idempotency arbiter, not application code.** `on conflict … do
 *    nothing` means a repeat like inserts nothing, fires no trigger and moves no counter — and
 *    answers 200 with the current state, NEVER a 409. A 409 would surface as an error toast on a
 *    tap the member has every right to repeat.
 *  - **The count is READ BACK from the row**, not computed here and not incremented here. The
 *    trigger is the only writer of `stories.like_count`; anything else is a second writer that
 *    drifts the day it half-succeeds.
 *  - **EXPIRY IS NOT A PREDICATE HERE.** A pinned expired story stays likeable (A-4): expiry gates
 *    the STRIP's read and nothing else, so there is no affordance that answers 400 and no second
 *    copy of the window to keep in step.
 */
export async function likeStory(ctx: RequestContext, storyId: string): Promise<StoryLikeResult> {
  const { likeCount, authorUserId } = await withTenantTx(ctx, async (tx) => {
    await tx.execute(sql`
      insert into feed_likes (tenant_id, user_id, story_id)
      select ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, s.id
        from stories s
       where s.id = ${storyId}::uuid and s.deleted_at is null
      on conflict (user_id, story_id) where story_id is not null do nothing`);

    const rows = await tx.execute<StoryCounterRow>(sql`
      select s.like_count, s.author_user_id
        from stories s
       where s.id = ${storyId}::uuid and s.deleted_at is null`);
    const row = rows[0];
    // Unknown, another tenant's, or removed — one bare 404, no details (D-23, T-05-35).
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return { likeCount: row.like_count, authorUserId: row.author_user_id };
  });

  emit(ctx, 'story.liked', {
    tenantId: ctx.tenantId,
    storyId,
    storyAuthorUserId: authorUserId,
    actorUserId: ctx.userId,
  });

  return { liked: true, likeCount };
}

/**
 * `DELETE /v1/stories/{storyId}/likes` — the other half, equally idempotent.
 *
 * Unliking something never liked is a successful NO-OP: 200 with the current count and **no
 * event**, because nothing happened. Only a delete that really removed a row is worth telling
 * Phase 7 about.
 */
export async function unlikeStory(ctx: RequestContext, storyId: string): Promise<StoryLikeResult> {
  const { likeCount, authorUserId, removed } = await withTenantTx(ctx, async (tx) => {
    const deleted = await tx.execute<{ id: string }>(sql`
      delete from feed_likes
       where user_id = ${ctx.userId}::uuid and story_id = ${storyId}::uuid
      returning id`);

    const rows = await tx.execute<StoryCounterRow>(sql`
      select s.like_count, s.author_user_id
        from stories s
       where s.id = ${storyId}::uuid and s.deleted_at is null`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    return {
      likeCount: row.like_count,
      authorUserId: row.author_user_id,
      removed: deleted.length > 0,
    };
  });

  if (removed) {
    emit(ctx, 'story.unliked', {
      tenantId: ctx.tenantId,
      storyId,
      storyAuthorUserId: authorUserId,
      actorUserId: ctx.userId,
    });
  }

  return { liked: false, likeCount };
}

/* ── Comments (STORY-05, D-82, D-83) ──────────────────────────────────────────────────────────── */

/**
 * One hydrated story-comment row. Snake_case for the same reason `StoryRow` is: it comes straight
 * off `tx.execute`, which returns the driver's own row objects.
 */
type StoryCommentRow = {
  id: string;
  created_at: string;
  body: string;
  author_user_id: string;
  /** UI-D-24 — true when the author's membership is gone or soft-deleted. */
  author_removed: boolean;
  /** All three are NULL exactly when `author_removed` is true, and never otherwise. */
  membership_id: string | null;
  display_name: string | null;
  avatar_asset_id: string | null;
};

/**
 * THE story-comment projection, shared by the list and by the create read-back so the two cannot
 * disagree about what a comment looks like.
 *
 * It reads `feed_comments` through RAW SQL rather than through `@tria/module-feed`'s schema export,
 * exactly as `storyProjection`'s `viewer_liked` reads `feed_likes`: a `module -> module` package
 * dependency is denied by `turbo boundaries` (MOD-02), and the table is Phase 4's published shape.
 *
 * THE AUTHOR JOIN IS A LEFT JOIN, AND THAT IS LOAD-BEARING (UI-D-24). An inner join would DROP the
 * row the moment the author's membership is soft-deleted — the comment, its text and its timestamp
 * would vanish from a conversation other members are reading, and `stories.comment_count` would
 * then describe a comment nobody can see. The membership lifecycle predicate rides the JOIN
 * condition, so a removed author yields a null `membership_id`, `display_name` AND
 * `avatar_asset_id` in one step: no code path can hand the client a removed member's name, and none
 * can reconstruct a profile link for them (T-04-45).
 *
 * There is no `like_count`, no `viewer_liked` and no `reply_count` here, and their absence is the
 * product rule rather than an omission — see `storyCommentSchema`.
 *
 * Ends without a `where`, so each caller appends its own predicate and ordering.
 */
function storyCommentProjection() {
  return sql`
    select c.id,
           to_char(c.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
           c.body,
           c.author_user_id,
           (ms.id is null) as author_removed,
           ms.id as membership_id,
           mp.display_name,
           mp.avatar_asset_id
      from feed_comments c
      left join memberships ms on ms.user_id = c.author_user_id and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id`;
}

/** Row → published contract. Timestamps cross the wire as ISO strings, never as `Date`. */
const toStoryComment = (row: StoryCommentRow, viewerUserId: string): StoryComment => ({
  id: row.id,
  createdAt: row.created_at,
  body: row.body,
  // UI-D-24: the flag and the three nulls move together, because the LEFT JOIN produces them
  // together. Nothing here invents a display name, so a removed member cannot be named by any
  // response — the client substitutes the catalog's fixed label.
  authorRemoved: row.author_removed,
  author: {
    membershipId: row.membership_id,
    displayName: row.display_name,
    avatarAssetId: row.avatar_asset_id,
  },
  canDelete: row.author_user_id === viewerUserId,
});

/**
 * The comparison and the order for D-83's forward-running list, resolved ONCE from the repo's one
 * cursor envelope (`@tria/core/server/paging`).
 *
 * Both halves are spliced with `sql.raw` because neither can be a bound parameter — an operator is
 * not a value — and both come from a CLOSED union `keysetComparison` is total over, so nothing
 * caller-controlled reaches this splice. Keeping them in one value is what stops a `>` drifting
 * away from its `order by … asc` half a statement later (Pitfall 8).
 */
const STORY_COMMENT_KEYSET = keysetComparison('asc');

/**
 * The two constraint names that mean "you tried to reply to a story comment" (STORY-05, T-05-40).
 *
 * `feed_comments_parent_shape_chk` raises `23514` when the row names the parent's target honestly
 * (`'story'`); `feed_comments_parent_fk` raises `23503` when it lies (`'post'`), because the triple
 * `(story comment, 0, 'post')` does not exist. The API always writes the literal `'post'`, so it
 * always takes the second path — the first is reachable only by hand and is asserted in pgTAP.
 *
 * Naming the constraints individually is the point: an unrelated integrity error must still surface
 * as a 500 rather than being mistranslated into a 400 the client would act on.
 *
 * STORY-05's OTHER refusal, `story_comment_not_likeable`, is deliberately NOT translated in this
 * file: there is no story-comment-like route here and there must not be one. Liking a comment is
 * `POST /v1/feed/comments/{commentId}/like`, so its `23503` / `23514` on
 * `feed_likes_comment_fk` / `feed_likes_comment_kind_chk` is translated by
 * `packages/modules/feed/server/service.ts`. Both codes are enumerated together in this module's
 * `STORY_COMMENT_ISSUES`, so the web tier still has ONE exhaustive switch for the pair.
 */
const STORY_COMMENT_REPLY_CONSTRAINTS = new Set([
  'feed_comments_parent_fk',
  'feed_comments_parent_shape_chk',
]);

/**
 * Postgres `23503`/`23514` on one of those two constraints, possibly wrapped by drizzle's
 * `DrizzleQueryError` — the cause chain is walked with a `seen` set so a self-referential `cause`
 * cannot loop (the `isReplyDepthViolation` shape, restated across the module boundary).
 */
function isStoryReplyViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (e.code === '23503' || e.code === '23514') {
      const name = typeof e.constraint_name === 'string' ? e.constraint_name : '';
      return STORY_COMMENT_REPLY_CONSTRAINTS.has(name);
    }
    current = e.cause;
  }
  return false;
}

/**
 * `GET /v1/stories/{storyId}/comments` (STORY-05, D-83) — the story's flat conversation, OLDEST
 * first.
 *
 * **The direction is the whole design.** A story's comments are one conversation, so they run
 * forward in time and a new comment lands at the BOTTOM while the sheet is open; a post's root
 * comments run backward because that list is a ranking of threads and a story has no threads
 * (D-62 vs D-83). Forward means its own ascending index — `feed_comments_tenant_story_root_asc_idx`
 * — and its own comparison operator on the one cursor envelope, because serving `asc` from the
 * existing `DESC` index is a backward scan the `<` comparison cannot page (Pitfall 8).
 *
 * `parent_id is null` is in the predicate for symmetry with the index, not because replies might be
 * hiding: a story comment CANNOT have children — `feed_comments_parent_fk` makes the row
 * unrepresentable — so this list is the whole conversation by construction.
 *
 * Two statements, both bounded: one that decides whether this lane may see the story at all (so a
 * foreign-tenant story answers the same bare 404 the detail read gives, rather than an empty list
 * that would confirm nothing), and ONE hydrated keyset page. Expiry is deliberately NOT a predicate
 * here — a pinned expired story is a readable surface (A-4).
 */
export async function listStoryComments(
  ctx: RequestContext,
  storyId: string,
  query: StoryCommentsQuery,
): Promise<StoryCommentPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, async (tx) => {
    const stories = await tx.execute<{ id: string }>(sql`
      select s.id from stories s
       where s.id = ${storyId}::uuid and s.tenant_id = ${ctx.tenantId}::uuid
         and s.deleted_at is null`);
    if (!stories[0]) throw new ApiError(404, 'NOT_FOUND');

    return tx.execute<StoryCommentRow>(sql`
      ${storyCommentProjection()}
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.story_id = ${storyId}::uuid
         and c.parent_id is null
         and c.deleted_at is null
         and (
           ${afterAt}::timestamptz is null
           or (c.created_at, c.id) ${sql.raw(STORY_COMMENT_KEYSET.operator)} (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by c.created_at ${sql.raw(STORY_COMMENT_KEYSET.order)}, c.id ${sql.raw(STORY_COMMENT_KEYSET.order)}
       limit ${limit + 1}`);
  });

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.created_at, id: last.id }) : null;

  // The SHAPE only — a comment body is member content and never reaches a log line (T-05-43).
  log.info(
    {
      event: 'stories.comments.list',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'story comments listed',
  );

  return { items: page.map((row) => toStoryComment(row, ctx.userId)), nextCursor };
}

/**
 * `POST /v1/stories/{storyId}/comments` (STORY-05) — and the place STORY-05's first half is
 * REFUSED rather than checked.
 *
 * **There is no `if (input.parentId) throw` in this function, and adding one would be the bug.**
 * A request carrying a `parentId` is inserted as `depth 1, parent_depth 0, parent_target_kind
 * 'post'` — the LITERALS, never the parent's own columns — and the three-column composite foreign
 * key decides. A story comment's triple is `(id, 0, 'story')`, so the insert finds nothing and
 * Postgres raises `23503`, which becomes `400 VALIDATION_FAILED { comment: 'story_comment_no_reply' }`.
 * An application check would be a read-then-write two concurrent requests could both pass, and it
 * would keep this suite green with the constraint missing — the exact failure this plan exists to
 * remove.
 *
 * The insert SELECTS the story rather than trusting the path parameter (T-05-45), so a story id
 * this lane cannot see produces zero rows and the same bare 404 an unknown id gives.
 */
export async function createStoryComment(
  ctx: RequestContext,
  storyId: string,
  input: CreateStoryComment,
): Promise<StoryComment> {
  const parentId = input.parentId ?? null;

  const created = await withTenantTx(ctx, async (tx) => {
    let inserted: { id: string }[];
    try {
      inserted =
        parentId === null
          ? await tx.execute<{ id: string }>(sql`
              insert into feed_comments (tenant_id, story_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
              select ${ctx.tenantId}::uuid, s.id, ${ctx.userId}::uuid, ${input.body}, 0, null, null, null
                from stories s
               where s.id = ${storyId}::uuid and s.tenant_id = ${ctx.tenantId}::uuid
                 and s.deleted_at is null
              returning id`)
          : // The literals, not `c.depth` / `c.target_kind`. The parent is necessarily a STORY
            // comment (the join says so), so this statement is written to be REFUSED — by the
            // foreign key, in the database, with no help from this file.
            await tx.execute<{ id: string }>(sql`
              insert into feed_comments (tenant_id, story_id, author_user_id, body, depth, parent_id, parent_depth, parent_target_kind)
              select ${ctx.tenantId}::uuid, s.id, ${ctx.userId}::uuid, ${input.body}, 1, c.id, 0, 'post'
                from stories s
                join feed_comments c on c.story_id = s.id and c.deleted_at is null
               where s.id = ${storyId}::uuid and s.tenant_id = ${ctx.tenantId}::uuid
                 and s.deleted_at is null
                 and c.id = ${parentId}::uuid
              returning id`);
    } catch (error) {
      if (isStoryReplyViolation(error)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { comment: 'story_comment_no_reply' });
      }
      throw error;
    }

    const id = inserted[0]?.id;
    // Zero rows: the story is unknown / another tenant's / removed, or the named parent is not a
    // live comment on THIS story. One bare 404, no `details` to read (D-23, T-05-45).
    if (!id) throw new ApiError(404, 'NOT_FOUND');

    // The created comment in exactly the shape the list returns, plus the recipient id the event
    // needs — read here so Phase 7 never re-reads the story it is being told about.
    const rows = await tx.execute<StoryCommentRow & { story_author_user_id: string }>(sql`
      select hydrated.*, s.author_user_id as story_author_user_id
        from (${storyCommentProjection()} where c.id = ${id}::uuid) hydrated
        join stories s on s.id = ${storyId}::uuid`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return row;
  });

  emit(ctx, 'story.commented', {
    tenantId: ctx.tenantId,
    storyId,
    commentId: created.id,
    storyAuthorUserId: created.story_author_user_id,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'stories.comment.created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId,
      commentId: created.id,
      bodyLength: input.body.length,
    },
    'story comment created',
  );

  return toStoryComment(created, ctx.userId);
}

/**
 * `DELETE /v1/stories/{storyId}/comments/{commentId}` (D-61's rule, restated for stories) — a
 * member removes their OWN comment.
 *
 * The authority is IN THE PREDICATE (`author_user_id = ctx.userId`), so someone else's comment, an
 * unknown id and an already-deleted one are ONE branch answering a bare 404: a member cannot even
 * probe whether a comment exists (T-04-16, T-04-21). The row STAYS — only `deleted_at` is set — so
 * Phase 8's MODER-01 widens this exact route with one more permission and reads the same row.
 *
 * `story_id` is in the predicate as well as the path, so a comment id belonging to another story
 * (or to a POST) answers the same 404 rather than being removed from a conversation the caller was
 * not looking at.
 *
 * The count moves EXACTLY ONCE, and not from here: `app.feed_comment_count()` fires on the
 * `deleted_at` TRANSITION, so a second delete matches nothing, adjusts nothing and emits nothing.
 */
export async function deleteStoryComment(
  ctx: RequestContext,
  storyId: string,
  commentId: string,
): Promise<void> {
  await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`
      update feed_comments
         set deleted_at = now()
       where id = ${commentId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
         and story_id = ${storyId}::uuid
         and author_user_id = ${ctx.userId}::uuid
         and deleted_at is null
      returning id`);
    if (!rows[0]) throw new ApiError(404, 'NOT_FOUND');
  });

  emit(ctx, 'story.comment_deleted', {
    tenantId: ctx.tenantId,
    storyId,
    commentId,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'stories.comment.deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId,
      commentId,
    },
    'story comment soft-deleted',
  );
}

/* ── Community pins (STORY-04, D-68) ──────────────────────────────────────────────────────────── */

/**
 * What the pair lookup inside a pin write resolves. BOTH ids are read back from the database rather
 * than taken from the path: a story or a community this lane cannot see yields no row at all, so a
 * cross-tenant id cannot reach the insert even though the row it names exists somewhere (T-05-49).
 */
type PinTargetRow = { story_id: string; community_id: string; community_status: string };

/**
 * The pair lookup both halves of the toggle share, so the two can never disagree about what
 * "this story, this community, this tenant" means.
 *
 * The join names `public.communities` through RAW SQL rather than through
 * `@tria/module-communities`'s schema export, exactly as `viewer_liked` names `feed_likes`: a
 * `module -> module` package dependency is denied by `turbo boundaries` (MOD-02), and the table is
 * 05-01's published shape. RLS decides visibility for both sides in this lane; the explicit
 * `tenant_id` predicates are the second of the three layers, carried on purpose.
 */
async function resolvePinTarget(
  tx: Tx,
  ctx: RequestContext,
  storyId: string,
  communityId: string,
): Promise<PinTargetRow> {
  const rows = await tx.execute<PinTargetRow>(sql`
    select s.id as story_id, c.id as community_id, c.status as community_status
      from stories s
      join communities c
        on c.id = ${communityId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid
       and c.deleted_at is null
     where s.id = ${storyId}::uuid
       and s.tenant_id = ${ctx.tenantId}::uuid
       and s.deleted_at is null
     limit 1`);
  const target = rows[0];
  // Unknown story, unknown community, another tenant's of either, removed — ONE indistinguishable
  // answer with no `details` at all (D-23, T-05-49). There is nothing here that compares tenant
  // ids, so no later edit can turn this into a 403 that confirms the row exists somewhere.
  if (!target) throw new ApiError(404, 'NOT_FOUND');
  return target;
}

/** How many communities a story is pinned to, read back from the ROWS inside the same transaction. */
async function readPinnedCount(tx: Tx, storyId: string): Promise<number> {
  const rows = await tx.execute<{ pinned_community_count: number }>(sql`
    select count(*)::int as pinned_community_count
      from story_community_pins
     where story_id = ${storyId}::uuid`);
  return rows[0]?.pinned_community_count ?? 0;
}

/**
 * The ONE archived refusal both pin write paths raise — `pinStory` and a publish that names a
 * community (05.1, D-99) — so the two can never answer the same rule with different words. An
 * archived container takes no new content (05-03's own `archived` code), and a pin is new content.
 */
function assertCommunityPinnable(status: string): void {
  if (status !== 'active') {
    throw new ApiError(400, 'VALIDATION_FAILED', { pin: 'archived' });
  }
}

/**
 * The ONE statement that writes a pin row, shared by `pinStory` and `publishStory` so a story born
 * attached and a story pinned later are the same row by construction (05.1's invariant).
 *
 * `story_community_pins_uq` is the idempotency arbiter (`on conflict … do nothing`), and `returning
 * id` is what tells a created row from an absorbed repeat — the caller emits `story.pinned` only
 * for the former. Both ids must already have been RESOLVED in this transaction by the caller.
 */
async function insertStoryPin(
  tx: Tx,
  ctx: RequestContext,
  storyId: string,
  communityId: string,
): Promise<boolean> {
  const inserted = await tx.execute<{ id: string }>(sql`
    insert into story_community_pins (tenant_id, story_id, community_id, pinned_by_user_id)
    values (${ctx.tenantId}::uuid,
            ${storyId}::uuid,
            ${communityId}::uuid,
            ${ctx.userId}::uuid)
    on conflict (story_id, community_id) do nothing
    returning id`);
  return inserted.length > 0;
}

/**
 * The destination lookup of a publish that names a community (05.1, D-99): ONE statement over
 * `public.communities` with exactly the predicate `resolvePinTarget` joins on — this tenant, not
 * soft-deleted — through RAW SQL, for the same MOD-02 reason (no `module -> module` package edge).
 *
 * Unknown, removed and another tenant's community are ONE bare 404 with no `details` (D-23,
 * T-05-49); only a community this lane CAN see reaches `assertCommunityPinnable`, so `pin:
 * 'archived'` can never become an existence oracle.
 */
async function resolvePublishCommunity(
  tx: Tx,
  ctx: RequestContext,
  communityId: string,
): Promise<{ status: string }> {
  const rows = await tx.execute<{ status: string }>(sql`
    select c.status
      from communities c
     where c.id = ${communityId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid
       and c.deleted_at is null
     limit 1`);
  const community = rows[0];
  if (!community) throw new ApiError(404, 'NOT_FOUND');
  return community;
}

/**
 * `PUT /v1/stories/{storyId}/pins/{communityId}` (STORY-04) — the editorial act, behind
 * `stories.story.manage`.
 *
 * It is `likePost`'s shape, because it is the same kind of write over a different pair:
 *
 *  - **both ids are RESOLVED inside the transaction** before anything is written (T-05-49);
 *  - **`story_community_pins_uq` is the idempotency arbiter, not application code.** `on conflict …
 *    do nothing` means a repeat pin inserts nothing and answers 200 with the current state, NEVER a
 *    409 — a conflict status would surface as an error toast on a gesture the admin has every right
 *    to repeat, and would make the sheet's optimistic switch revert on a state that is already true;
 *  - **the count is READ BACK from the rows**, never incremented here;
 *  - **the event counts a TRANSITION.** `returning id` is what distinguishes "a row was created"
 *    from "the unique pair absorbed the write", and only the first announces anything. Phase 7
 *    builds a notification row straight from this payload, and a duplicate announcement of a state
 *    that never changed is a lie it cannot detect (the `story.unliked` rule, applied to both halves).
 *
 * An ARCHIVED target is refused with 05-03's own `archived` code: an archived container takes no new
 * content, and pinning into one is new content. Unpinning FROM one is not — see `unpinStory`.
 *
 * **Expiry is not a predicate here.** Pinning an expired story is the entire point of STORY-04.
 */
export async function pinStory(
  ctx: RequestContext,
  storyId: string,
  communityId: string,
): Promise<StoryPinResult> {
  const { pinnedCommunityCount, created } = await withTenantTx(ctx, async (tx) => {
    const target = await resolvePinTarget(tx, ctx, storyId, communityId);
    assertCommunityPinnable(target.community_status);

    const created = await insertStoryPin(tx, ctx, target.story_id, target.community_id);

    return {
      pinnedCommunityCount: await readPinnedCount(tx, storyId),
      created,
    };
  });

  if (created) {
    emit(ctx, 'story.pinned', {
      tenantId: ctx.tenantId,
      storyId,
      communityId,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'stories.pinned',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId,
      communityId,
      created,
      pinnedCommunityCount,
    },
    'story pinned to a community',
  );

  return { pinned: true, pinnedCommunityCount };
}

/**
 * `DELETE /v1/stories/{storyId}/pins/{communityId}` — the other half, equally idempotent.
 *
 * **The delete is HARD, deliberately** — see item 5 of the schema's reviewer docblock. A pin carries
 * no authored content and no moderation evidence, the unique pair is the arbiter, and a
 * soft-deleted pin would need an extra predicate threaded through every join that reads it.
 *
 * **An ARCHIVED community can still be unpinned**, and that asymmetry is the point: archiving gates
 * NEW content. If it gated removal too, a story pinned before the archive would stay highlighted on
 * that page forever with no affordance to take it down.
 *
 * Unpinning something that was never pinned removes nothing, answers 200 with the current count and
 * emits NOTHING — an event counting transitions must not announce one that did not happen.
 */
export async function unpinStory(
  ctx: RequestContext,
  storyId: string,
  communityId: string,
): Promise<StoryPinResult> {
  const { pinnedCommunityCount, removed } = await withTenantTx(ctx, async (tx) => {
    const target = await resolvePinTarget(tx, ctx, storyId, communityId);

    const deleted = await tx.execute<{ id: string }>(sql`
      delete from story_community_pins
       where story_id = ${target.story_id}::uuid
         and community_id = ${target.community_id}::uuid
      returning id`);

    return {
      pinnedCommunityCount: await readPinnedCount(tx, storyId),
      removed: deleted.length > 0,
    };
  });

  if (removed) {
    emit(ctx, 'story.unpinned', {
      tenantId: ctx.tenantId,
      storyId,
      communityId,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'stories.unpinned',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId,
      communityId,
      removed,
      pinnedCommunityCount,
    },
    'story unpinned from a community',
  );

  return { pinned: false, pinnedCommunityCount };
}

/** The Destaques row's own two cursor columns, carried beside the shared story projection. */
type HighlightRow = StoryRow & { pin_id: string; pinned_at: string };

/**
 * `GET /v1/stories/pinned?communityId=` (STORY-04, D-68) — one community's Destaques.
 *
 * **READ THE `where` CLAUSE FOR WHAT IS NOT IN IT.** There is no `expires_at > now()` here, and that
 * ABSENCE is the entire mechanism of STORY-04: the pin row IS the expiry override, so a pinned story
 * is visible on its community page for EVERY value of `now()` until somebody unpins it.
 * `110-communities-stories.sql` asserts exactly that, under a clock the test controls, beside the
 * strip predicate refusing the same row in the same transaction — so the two surfaces are proved to
 * disagree deliberately rather than by accident.
 *
 * The one predicate that IS here on the story is `deleted_at is null` (Pitfall 9): deleting a story
 * must remove it from every surface at once, including other communities' highlights (T-05-52). The
 * pin rows stay as the record of where it had been.
 *
 * **Every member sees a community's highlights**, so the route carries no permission — only
 * `requireModule('stories')`. Ordering is `pinned_at desc, p.id desc`, the ordered pair
 * `story_community_pins_tenant_community_idx` is built on, and the cursor's `n` is the row's own
 * `pinned_at` read back from the statement rather than re-derived in JavaScript.
 *
 * The readiness filter is deliberately ABSENT too: a pinned story whose video is still transcoding
 * would otherwise vanish from a community page for a while and come back, which reads as a bug. The
 * circle renders its neutral box in the meantime, which is the same branch a failed fetch takes.
 */
export async function listCommunityHighlights(
  ctx: RequestContext,
  communityId: string,
  query: StoryQuery,
): Promise<StoryPage> {
  const limit = query.limit;
  const after = decodeCursor(query.cursor);
  const afterAt = after?.n ?? null;
  const afterId = after?.id ?? null;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<HighlightRow>(sql`
      ${storyProjection(
        ctx.userId,
        sql`, p.id as pin_id,
           to_char(p.pinned_at at time zone 'utc', ${ISO_MICROSECONDS}) as pinned_at`,
      )}
      join story_community_pins p
        on p.story_id = s.id
       and p.tenant_id = s.tenant_id
       where p.tenant_id = ${ctx.tenantId}::uuid
         and p.community_id = ${communityId}::uuid
         and s.deleted_at is null
         and (
           ${afterAt}::timestamptz is null
           or (p.pinned_at, p.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )
       order by p.pinned_at desc, p.id desc
       limit ${limit + 1}`),
  );

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.pinned_at, id: last.pin_id }) : null;

  log.info(
    {
      event: 'stories.highlights',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'community highlights listed',
  );

  return { items: page.map(toStory), nextCursor };
}

/**
 * `GET /v1/stories/{storyId}/pins` — the community ids a story is pinned to, which is the pin
 * sheet's initial state.
 *
 * Ids only: the sheet already holds the NAMES from the page's own read, and sending them again
 * would be a second source of the same words. The story is resolved first so a miss answers the
 * same bare 404 every other story-scoped route does, rather than an empty list that would tell a
 * caller "this story exists and has no pins".
 */
export async function listStoryPins(ctx: RequestContext, storyId: string): Promise<StoryPins> {
  const communityIds = await withTenantTx(ctx, async (tx) => {
    const stories = await tx.execute<{ id: string }>(sql`
      select id from stories
       where id = ${storyId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
         and deleted_at is null
       limit 1`);
    if (!stories[0]) throw new ApiError(404, 'NOT_FOUND');

    const rows = await tx.execute<{ community_id: string }>(sql`
      select community_id from story_community_pins
       where story_id = ${storyId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
       order by pinned_at desc, id desc`);
    return rows.map((row) => row.community_id);
  });

  return { communityIds };
}

/* ── Highlights (05.2) ────────────────────────────────────────────────────────────────────────── */

/**
 * The module flag the place rules depend on, read BEFORE the transaction opens.
 *
 * `moduleFlags` answers from a per-tenant cache and, on a miss, opens its OWN tenant transaction.
 * Reading it inside `withTenantTx` would hold two pooled connections for one request (the pool is
 * `max: 5`), which is a starvation hazard under load — so every highlight function reads it first,
 * exactly where `listCommunityFeed` does, and hands the answer to `resolveHighlightPlace`.
 */
type PlaceGate = { communitiesOn: boolean };

async function readPlaceGate(ctx: RequestContext): Promise<PlaceGate> {
  return { communitiesOn: await moduleFlags.isEnabled(ctx, 'communities') };
}

/** What a place-resolving caller intends: reading, taking content down, or adding/curating it. */
type PlaceIntent = 'read' | 'takedown' | 'curate';

/**
 * A highlight's PLACE as a SQL predicate on `alias.community_id` — one of exactly two literal
 * fragments. Never `is not distinct from`: an index cannot serve it, while both of these walk
 * `story_highlights_tenant_place_idx` directly.
 */
function placePredicate(alias: 'h', communityId: string | null): SQL {
  const column = sql.raw(`${alias}.community_id`);
  return communityId === null ? sql`${column} is null` : sql`${column} = ${communityId}::uuid`;
}

/**
 * THE ONE PLACE-RESOLUTION SEAM (R-D-K). Every highlight read and write resolves its place here, so
 * there is exactly one definition of "a place this caller may use":
 *
 *  - `null` is Início — the tenant's own place, always present while `stories` is on.
 *  - A community is resolved in-lane: this tenant, not soft-deleted. The `communities` module being
 *    OFF answers the same bare 404 the feed answers (a tenant without the module has no communities
 *    to name, D-74), and so does every miss — unknown, another tenant's, removed (D-23).
 *  - Write intents take the row `for share`, so an archive that commits concurrently waits for this
 *    transaction instead of racing it (closes 05.1's residual R-1 for this path).
 *  - `curate` — anything that ADDS content (create, add an item) — refuses a non-`active` community
 *    with `{ highlight: 'archived' }`. A `takedown` does not: archiving gates new content, and
 *    removal must stay possible (the unpin rule).
 *
 * Phase 10's creator-scoped publishing extends THIS function with its creator branch; no route or
 * other service function has to learn what a place is. The table is named through RAW SQL rather
 * than `@tria/module-communities`'s schema export (MOD-02, the `resolvePinTarget` posture).
 */
async function resolveHighlightPlace(
  tx: Tx,
  ctx: RequestContext,
  communityId: string | null,
  intent: PlaceIntent,
  gate: PlaceGate,
): Promise<void> {
  if (communityId === null) return;
  if (!gate.communitiesOn) throw new ApiError(404, 'NOT_FOUND');

  const lock = intent === 'read' ? sql`` : sql`for share`;
  const rows = await tx.execute<{ status: string }>(sql`
    select c.status
      from communities c
     where c.id = ${communityId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid
       and c.deleted_at is null
     ${lock}`);
  const community = rows[0];
  if (!community) throw new ApiError(404, 'NOT_FOUND');
  if (intent === 'curate' && community.status !== 'active') {
    throw new ApiError(400, 'VALIDATION_FAILED', { highlight: 'archived' });
  }
}

/** What `resolveHighlight` reads back: the row's place and the columns a curation write compares. */
type HighlightRef = {
  id: string;
  community_id: string | null;
  title: string;
  cover_story_id: string | null;
  cover_asset_id: string | null;
};

/**
 * Resolve ONE highlight in-lane, then its place through `resolveHighlightPlace` — the entry every
 * highlight write shares, so "which highlight, which place, may this caller act on it" has exactly
 * one definition.
 *
 * - The row is read under the explicit `tenant_id` predicate AND RLS; a miss (unknown, another
 *   tenant's) is the bare 404 (D-23).
 * - Write intents take it `for update`: two writes to the same highlight serialise, which is what
 *   keeps `is distinct from` honest and the `full` count exact.
 * - The place rules are NOT restated here (R-D-K): `curate` refuses an archived community,
 *   `takedown` does not, and the `communities` module being off is the bare 404 — all decided by
 *   the one seam.
 */
async function resolveHighlight(
  tx: Tx,
  ctx: RequestContext,
  highlightId: string,
  intent: PlaceIntent,
  gate: PlaceGate,
): Promise<HighlightRef> {
  const lock = intent === 'read' ? sql`` : sql`for update`;
  const rows = await tx.execute<HighlightRef>(sql`
    select h.id, h.community_id, h.title, h.cover_story_id, h.cover_asset_id
      from story_highlights h
     where h.id = ${highlightId}::uuid
       and h.tenant_id = ${ctx.tenantId}::uuid
     ${lock}`);
  const highlight = rows[0];
  if (!highlight) throw new ApiError(404, 'NOT_FOUND');
  await resolveHighlightPlace(tx, ctx, highlight.community_id, intent, gate);
  return highlight;
}

/**
 * A MEMBER-VISIBLE item (R-D-H), written ONCE: the story is not removed and its asset is `ready`.
 * The row read's `item_count` and the items read both use this fragment, so the two can never
 * disagree about what "empty" means (Pitfall 6) — a highlight a member sees in the row always has
 * something to play. Expects the aliases `s` (stories) and `a` (media_assets).
 */
const MEMBER_VISIBLE = sql`s.deleted_at is null and a.status = 'ready'`;

/** One hydrated row of `highlightProjection`, snake_case straight off `tx.execute`. */
type HighlightSummaryRow = {
  id: string;
  community_id: string | null;
  title: string;
  position: number;
  cover_asset_id: string | null;
  cover_variant_widths: number[] | null;
  cover_story_id: string | null;
  cover_chosen: boolean | null;
  item_count: number;
};

/**
 * THE highlight projection — ONE statement over `story_highlights h`, filtered by `where`, wrapped
 * so the caller can filter and order on the computed columns (`hp.item_count`, `hp.position`).
 *
 * `item_count` counts MEMBER-VISIBLE items (see `MEMBER_VISIBLE`).
 *
 * The COVER is resolved here, at read time, in rule order (R-D-D) — one lateral that takes the
 * first rule producing a row:
 *   1. the uploaded `cover_asset_id`, when it is still a `cover` / `image` / `ready` / not-deleted
 *      asset;
 *   2. the chosen `cover_story_id`, when that story is still a member-visible IMAGE item of THIS
 *      highlight;
 *   3. the most recently ADDED member-visible image item (`added_at desc, id desc`) — for a
 *      migrated highlight, the most recently pinned story (D-116);
 *   4. otherwise none, and the circle draws its brand-gradient fallback.
 * `cover_chosen` is true exactly when rule 1 or 2 produced the cover. Image items only (D-101,
 * developer's plan-time decision 2026-09-25): the media broker serves no video poster, so a
 * highlight whose items are all videos resolves no automatic cover. A later `poster` variant slots
 * into rules 2 and 3 as one more branch, with no schema change. Read-time resolution means a removed
 * cover story or a deleted cover asset self-heals with no trigger.
 */
function highlightProjection(where: SQL) {
  return sql`
    select hp.* from (
      select h.id,
             h.community_id,
             h.title,
             h.position,
             h.cover_story_id,
             cover.asset_id as cover_asset_id,
             cover.variant_widths as cover_variant_widths,
             cover.chosen as cover_chosen,
             (
               select count(*)::int
                 from story_highlight_items i
                 join stories s on s.id = i.story_id
                 join media_assets a on a.id = s.media_asset_id
                where i.highlight_id = h.id
                  and ${MEMBER_VISIBLE}
             ) as item_count
        from story_highlights h
        left join lateral (
          select c.asset_id, c.variant_widths, c.chosen
            from (
              select ca.id as asset_id, ca.variant_widths, true as chosen, 1 as rule
                from media_assets ca
               where ca.id = h.cover_asset_id
                 and ca.purpose = 'cover'
                 and ca.kind = 'image'
                 and ca.status = 'ready'
                 and ca.deleted_at is null
              union all
              select a.id, a.variant_widths, true, 2
                from story_highlight_items i
                join stories s on s.id = i.story_id
                join media_assets a on a.id = s.media_asset_id
               where i.highlight_id = h.id
                 and i.story_id = h.cover_story_id
                 and s.media_kind = 'image'
                 and ${MEMBER_VISIBLE}
              union all
              (
                select a.id, a.variant_widths, false, 3
                  from story_highlight_items i
                  join stories s on s.id = i.story_id
                  join media_assets a on a.id = s.media_asset_id
                 where i.highlight_id = h.id
                   and s.media_kind = 'image'
                   and ${MEMBER_VISIBLE}
                 order by i.added_at desc, i.id desc
                 limit 1
              )
            ) c
           order by c.rule
           limit 1
        ) cover on true
       where ${where}
    ) hp`;
}

/** Row → published contract. */
const toHighlight = (row: HighlightSummaryRow): HighlightSummary => ({
  id: row.id,
  communityId: row.community_id,
  title: row.title,
  position: row.position,
  coverAssetId: row.cover_asset_id,
  coverVariantWidths: row.cover_variant_widths ?? [],
  coverStoryId: row.cover_story_id,
  coverChosen: row.cover_chosen ?? false,
  itemCount: row.item_count,
});

/**
 * `POST /v1/stories/highlights` — a new highlight at the END of its place's row (R-D-C).
 *
 * One `withTenantTx`: the place is resolved for `curate` (archived → `{ highlight: 'archived' }`),
 * the place's existing rows are locked `for update` so two appends to a populated row serialise, a
 * place already holding `STORY_HIGHLIGHT_MAX_PER_PLACE` is refused `{ highlight: 'full' }`, and the
 * insert takes `coalesce(max(position) + 1, 0)`. Two creates racing into an EMPTY place have no row
 * to lock and may both take position 0; every read orders by `(position, id)`, a total order, so
 * the row is still stable — and the first reorder renumbers it densely.
 *
 * `tenant_id` and `created_by_user_id` come from `ctx`, never the body (the policy's `with check`
 * turns a forged stamp into 42501). `highlight.created` is emitted after the transaction, ids only.
 */
export async function createHighlight(
  ctx: RequestContext,
  input: CreateStoryHighlight,
): Promise<HighlightSummary> {
  const communityId = input.communityId ?? null;
  const gate = await readPlaceGate(ctx);

  const created = await withTenantTx(ctx, async (tx) => {
    await resolveHighlightPlace(tx, ctx, communityId, 'curate', gate);

    const place = await tx.execute<{ id: string }>(sql`
      select h.id
        from story_highlights h
       where h.tenant_id = ${ctx.tenantId}::uuid
         and ${placePredicate('h', communityId)}
       for update`);
    if (place.length >= STORY_HIGHLIGHT_MAX_PER_PLACE) {
      throw new ApiError(400, 'VALIDATION_FAILED', { highlight: 'full' });
    }

    const inserted = await tx.execute<{ id: string }>(sql`
      insert into story_highlights (tenant_id, community_id, title, position, created_by_user_id)
      select ${ctx.tenantId}::uuid,
             ${communityId}::uuid,
             ${input.title},
             coalesce(max(h.position) + 1, 0),
             ${ctx.userId}::uuid
        from story_highlights h
       where h.tenant_id = ${ctx.tenantId}::uuid
         and ${placePredicate('h', communityId)}
      returning id`);
    const id = inserted[0]?.id;
    if (!id) throw new ApiError(500, 'INTERNAL');

    const rows = await tx.execute<HighlightSummaryRow>(sql`
      ${highlightProjection(sql`h.id = ${id}::uuid`)}`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return row;
  });

  emit(ctx, 'highlight.created', {
    tenantId: ctx.tenantId,
    highlightId: created.id,
    communityId,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'stories.highlight_created',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      highlightId: created.id,
      communityId,
      position: created.position,
      // The LENGTH, never the words (T-05-29 / T-05.2-07).
      titleLength: input.title.length,
    },
    'story highlight created',
  );

  return toHighlight(created);
}

/**
 * THE ONE statement that writes a highlight item — shared by `addStoryToHighlight` and, from plan
 * 06, by a publish into a highlight, so a story born in a highlight and a story added later are the
 * same row by construction.
 *
 * It INSERT-SELECTS (T-05-33): both ids are read back from the tables under explicit tenant
 * predicates and RLS, so a foreign or removed id writes nothing even if a caller skipped resolving
 * it. `story_highlight_items_uq` is the idempotency arbiter (`on conflict … do nothing`), and
 * `returning id` tells a created row from an absorbed repeat — the caller announces only the former.
 */
export async function insertHighlightItem(
  tx: Tx,
  ctx: RequestContext,
  highlightId: string,
  storyId: string,
): Promise<boolean> {
  const inserted = await tx.execute<{ id: string }>(sql`
    insert into story_highlight_items (tenant_id, highlight_id, story_id, added_by_user_id)
    select ${ctx.tenantId}::uuid, h.id, s.id, ${ctx.userId}::uuid
      from story_highlights h, stories s
     where h.id = ${highlightId}::uuid
       and h.tenant_id = ${ctx.tenantId}::uuid
       and s.id = ${storyId}::uuid
       and s.tenant_id = ${ctx.tenantId}::uuid
       and s.deleted_at is null
    on conflict (highlight_id, story_id) do nothing
    returning id`);
  return inserted.length > 0;
}

/** How many highlights a story is in, read back from the ROWS inside the same transaction. */
async function readHighlightCount(tx: Tx, ctx: RequestContext, storyId: string): Promise<number> {
  const rows = await tx.execute<{ highlight_count: number }>(sql`
    select count(*)::int as highlight_count
      from story_highlight_items
     where tenant_id = ${ctx.tenantId}::uuid
       and story_id = ${storyId}::uuid`);
  return rows[0]?.highlight_count ?? 0;
}

/**
 * `PUT /v1/stories/highlights/{highlightId}/stories/{storyId}` — add a story to a highlight.
 *
 * The highlight is resolved in-lane `for update` (serialising adds to the same highlight, which is
 * what makes the `full` count honest), then its place for `curate`, then the story in-lane; every
 * miss is the bare 404. A highlight already holding `STORY_HIGHLIGHT_MAX_ITEMS` refuses a NEW story
 * with `{ highlight: 'full' }` — a repeat of a story already in it is still the idempotent 200.
 *
 * **No expiry predicate anywhere** (docblock item 6): adding an expired story is the point — the item
 * row is the override. The STORY row is never written: a highlight is an editorial pointer.
 * `story.highlighted` is emitted only when a row was really created (transitions, not requests).
 */
export async function addStoryToHighlight(
  ctx: RequestContext,
  highlightId: string,
  storyId: string,
): Promise<HighlightMembershipResult> {
  const gate = await readPlaceGate(ctx);

  const { highlightCount, created } = await withTenantTx(ctx, async (tx) => {
    await resolveHighlight(tx, ctx, highlightId, 'curate', gate);

    const stories = await tx.execute<{ id: string }>(sql`
      select s.id
        from stories s
       where s.id = ${storyId}::uuid
         and s.tenant_id = ${ctx.tenantId}::uuid
         and s.deleted_at is null`);
    if (!stories[0]) throw new ApiError(404, 'NOT_FOUND');

    const held = await tx.execute<{ n: number; present: boolean }>(sql`
      select count(*)::int as n, coalesce(bool_or(i.story_id = ${storyId}::uuid), false) as present
        from story_highlight_items i
       where i.highlight_id = ${highlightId}::uuid
         and i.tenant_id = ${ctx.tenantId}::uuid`);
    const counted = held[0];
    if (counted && !counted.present && counted.n >= STORY_HIGHLIGHT_MAX_ITEMS) {
      throw new ApiError(400, 'VALIDATION_FAILED', { highlight: 'full' });
    }

    const created = await insertHighlightItem(tx, ctx, highlightId, storyId);
    return { highlightCount: await readHighlightCount(tx, ctx, storyId), created };
  });

  if (created) {
    emit(ctx, 'story.highlighted', {
      tenantId: ctx.tenantId,
      storyId,
      highlightId,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'stories.highlighted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      highlightId,
      storyId,
      created,
      highlightCount,
    },
    'story added to a highlight',
  );

  return { highlighted: true, highlightCount };
}

/**
 * `GET /v1/stories/highlights?communityId=&scope=` — one place's row, in `(position, id)` order.
 *
 * ONE statement. A member sees only highlights with at least one MEMBER-VISIBLE item (D-102: an
 * empty highlight is kept but never shown to members); a `curator` read (the route grants it only
 * for `scope=all` with `stories.story.manage`) sees every highlight, empty ones with `itemCount: 0`.
 */
export async function listHighlights(
  ctx: RequestContext,
  options: { communityId: string | null; curator: boolean },
): Promise<HighlightList> {
  const { communityId, curator } = options;
  const gate = await readPlaceGate(ctx);

  const rows = await withTenantTx(ctx, async (tx) => {
    await resolveHighlightPlace(tx, ctx, communityId, 'read', gate);
    return tx.execute<HighlightSummaryRow>(sql`
      ${highlightProjection(
        sql`h.tenant_id = ${ctx.tenantId}::uuid and ${placePredicate('h', communityId)}`,
      )}
       where (${curator} or hp.item_count > 0)
       order by hp.position, hp.id`);
  });

  log.info(
    {
      event: 'stories.highlights_listed',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId,
      curator,
      returned: rows.length,
    },
    'story highlights listed',
  );

  return { items: rows.map(toHighlight) };
}

/**
 * `GET /v1/stories/highlights/{highlightId}` — the highlight and its stories.
 *
 * **READ THE `where` CLAUSE FOR WHAT IS NOT IN IT.** There is no expiry predicate: the item row IS
 * the override (docblock item 6), so an expired story plays from its highlight for every value of
 * `now()`, carrying its server-computed `isActive: false`. What IS there: `s.deleted_at is null`
 * (a removed story leaves every surface at once), and for a member `a.status = 'ready'` through the
 * shared `MEMBER_VISIBLE` fragment. A curator (`stories.story.manage`) sees every live item with its
 * `mediaStatus`, so the edit sheet can show a processing video.
 *
 * Stories come back OLDEST first by PUBLISH time (D-103), never by when they were added, `limit`ed
 * to `STORY_HIGHLIGHT_MAX_ITEMS`. A member asking for a highlight with zero member-visible items
 * gets the bare 404 an unknown id gets — an empty highlight is the curator's, not theirs (D-102).
 */
export async function getHighlight(
  ctx: RequestContext,
  highlightId: string,
  options: { curator: boolean },
): Promise<HighlightDetail> {
  const { curator } = options;
  const gate = await readPlaceGate(ctx);

  const detail = await withTenantTx(ctx, async (tx) => {
    const highlights = await tx.execute<HighlightSummaryRow>(sql`
      ${highlightProjection(
        sql`h.id = ${highlightId}::uuid and h.tenant_id = ${ctx.tenantId}::uuid`,
      )}`);
    const highlight = highlights[0];
    if (!highlight) throw new ApiError(404, 'NOT_FOUND');

    await resolveHighlightPlace(tx, ctx, highlight.community_id, 'read', gate);
    if (!curator && highlight.item_count === 0) throw new ApiError(404, 'NOT_FOUND');

    const visible = curator ? sql`s.deleted_at is null` : MEMBER_VISIBLE;
    const items = await tx.execute<StoryRow>(sql`
      ${storyProjection(ctx.userId)}
      join story_highlight_items i
        on i.story_id = s.id
       and i.tenant_id = s.tenant_id
       where i.highlight_id = ${highlightId}::uuid
         and i.tenant_id = ${ctx.tenantId}::uuid
         and ${visible}
       order by s.published_at, s.id
       limit ${STORY_HIGHLIGHT_MAX_ITEMS}`);

    return { highlight, items };
  });

  log.info(
    {
      event: 'stories.highlight_read',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      highlightId,
      curator,
      returned: detail.items.length,
    },
    'story highlight read',
  );

  return { highlight: toHighlight(detail.highlight), items: detail.items.map(toStory) };
}

/* ── Curation writes (05.2-03: HIGHLIGHT-01/02, D-101, R-D-E, R-D-F, R-D-L) ───────────────────── */

/**
 * Resolve a CHOSEN cover (D-101) inside the writing transaction and answer the two stored columns.
 * Every miss is the ONE bare 404 (D-23, the 05-09 shape) — a per-cause code over an enumerable uuid
 * space would be an existence oracle.
 *
 * - `{ assetId }`: an asset of THIS tenant (explicit predicate + RLS) with purpose `cover`, kind
 *   `image`, status `ready`, not removed — the community-cover tuple. A story asset, a processing
 *   one, a file, another tenant's: all the same 404 (T-05.2-12).
 * - `{ storyId }`: a live IMAGE item of THIS highlight — the story not removed, its asset `ready`
 *   (`MEMBER_VISIBLE`), `media_kind = 'image'`. A video item is the bare 404 (the developer's
 *   image-only decision, 2026-09-25), and so is a story that is not in this highlight (T-05.2-13).
 * - `null`: both columns cleared, back to the automatic rule. No lookup.
 *
 * Choosing one kind clears the other — `story_highlights_cover_chk` would refuse both at once.
 */
async function resolveChosenCover(
  tx: Tx,
  ctx: RequestContext,
  highlightId: string,
  cover: HighlightCover | null,
): Promise<{ coverStoryId: string | null; coverAssetId: string | null }> {
  if (cover === null) return { coverStoryId: null, coverAssetId: null };

  if ('assetId' in cover) {
    const assets = await tx.execute<{ id: string }>(sql`
      select a.id
        from media_assets a
       where a.id = ${cover.assetId}::uuid
         and a.tenant_id = ${ctx.tenantId}::uuid
         and a.purpose = 'cover'
         and a.kind = 'image'
         and a.status = 'ready'
         and a.deleted_at is null`);
    const asset = assets[0];
    if (!asset) throw new ApiError(404, 'NOT_FOUND');
    return { coverStoryId: null, coverAssetId: asset.id };
  }

  const items = await tx.execute<{ id: string }>(sql`
    select s.id
      from story_highlight_items i
      join stories s on s.id = i.story_id
      join media_assets a on a.id = s.media_asset_id
     where i.highlight_id = ${highlightId}::uuid
       and i.tenant_id = ${ctx.tenantId}::uuid
       and i.story_id = ${cover.storyId}::uuid
       and s.media_kind = 'image'
       and ${MEMBER_VISIBLE}`);
  const item = items[0];
  if (!item) throw new ApiError(404, 'NOT_FOUND');
  return { coverStoryId: item.id, coverAssetId: null };
}

/**
 * `PATCH /v1/stories/highlights/{highlightId}` — rename and/or re-cover (HIGHLIGHT-01, D-101).
 *
 * One `withTenantTx`: the highlight is resolved `for update` with the `curate` intent (an archived
 * community refuses with `{ highlight: 'archived' }` BEFORE any write), the chosen cover is resolved
 * in-lane, then ONE guarded `update … where (title, cover_story_id, cover_asset_id) is distinct from
 * (new values) returning id`. That predicate — not a JavaScript comparison — decides whether
 * anything changed, so an identical PATCH moves no `updated_at` and announces nothing:
 * `highlight.updated` fires only when `returning` produced a row (transitions, not requests).
 *
 * Replacing or clearing an uploaded cover never deletes or retires the old asset (R-D-E). The answer
 * is the highlight's summary re-read through `highlightProjection`, so the cover it shows is the
 * read-time rule's, exactly as every row read computes it.
 */
export async function updateHighlight(
  ctx: RequestContext,
  highlightId: string,
  input: UpdateHighlight,
): Promise<HighlightSummary> {
  // The service re-states the route's title rule: this function is also reachable from handlers
  // that assemble their own input, none of which pass through the route validator.
  const requestedTitle = input.title === undefined ? undefined : input.title.trim();
  if (
    requestedTitle !== undefined &&
    (requestedTitle.length === 0 || requestedTitle.length > STORY_HIGHLIGHT_MAX_TITLE)
  ) {
    throw new ApiError(400, 'VALIDATION_FAILED', { highlight: 'title_invalid' });
  }

  const gate = await readPlaceGate(ctx);

  const { row, changed } = await withTenantTx(ctx, async (tx) => {
    const current = await resolveHighlight(tx, ctx, highlightId, 'curate', gate);

    const title = requestedTitle ?? current.title;
    const cover =
      input.cover === undefined
        ? { coverStoryId: current.cover_story_id, coverAssetId: current.cover_asset_id }
        : await resolveChosenCover(tx, ctx, highlightId, input.cover);

    const updated = await tx.execute<{ id: string }>(sql`
      update story_highlights
         set title = ${title},
             cover_story_id = ${cover.coverStoryId}::uuid,
             cover_asset_id = ${cover.coverAssetId}::uuid,
             updated_at = now()
       where id = ${highlightId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
         and (title, cover_story_id, cover_asset_id)
             is distinct from (${title}::text, ${cover.coverStoryId}::uuid, ${cover.coverAssetId}::uuid)
      returning id`);

    const rows = await tx.execute<HighlightSummaryRow>(sql`
      ${highlightProjection(sql`h.id = ${highlightId}::uuid and h.tenant_id = ${ctx.tenantId}::uuid`)}`);
    const summary = rows[0];
    if (!summary) throw new ApiError(500, 'INTERNAL');
    return { row: summary, changed: updated.length > 0 };
  });

  if (changed) {
    emit(ctx, 'highlight.updated', {
      tenantId: ctx.tenantId,
      highlightId,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'stories.highlight_updated',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      highlightId,
      changed,
      // Flags and LENGTHS, never the words (T-05.2-17).
      titleLength: requestedTitle?.length ?? null,
      cover:
        input.cover === undefined
          ? 'unchanged'
          : input.cover === null
            ? 'cleared'
            : 'assetId' in input.cover
              ? 'asset'
              : 'story',
    },
    'story highlight updated',
  );

  return toHighlight(row);
}

/**
 * `DELETE /v1/stories/highlights/{highlightId}` — a HARD delete of the editorial pointer.
 *
 * The `takedown` intent: an ARCHIVED community still allows it (removal must stay possible, the
 * unpin rule). The items cascade with the highlight; the STORIES, their likes and their comments are
 * never touched (R-D-F) — a highlight is a pointer, not content.
 *
 * Idempotent-by-404, the `deleteStory` rule: a second delete is the bare 404, because "already
 * deleted" answering 204 would confirm that an id existed. `highlight.deleted` is emitted on a real
 * delete only, ids only.
 */
export async function deleteHighlight(ctx: RequestContext, highlightId: string): Promise<void> {
  const gate = await readPlaceGate(ctx);

  const removed = await withTenantTx(ctx, async (tx) => {
    await resolveHighlight(tx, ctx, highlightId, 'takedown', gate);
    const rows = await tx.execute<{ id: string; community_id: string | null }>(sql`
      delete from story_highlights
       where id = ${highlightId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
      returning id, community_id`);
    return rows[0];
  });

  if (!removed) throw new ApiError(404, 'NOT_FOUND');

  emit(ctx, 'highlight.deleted', {
    tenantId: ctx.tenantId,
    highlightId: removed.id,
    communityId: removed.community_id,
    actorUserId: ctx.userId,
  });

  log.info(
    {
      event: 'stories.highlight_deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      highlightId: removed.id,
      communityId: removed.community_id,
    },
    'story highlight deleted',
  );
}

/**
 * `DELETE /v1/stories/highlights/{highlightId}/stories/{storyId}` — take a story OUT of a highlight
 * (HIGHLIGHT-02).
 *
 * - The `takedown` intent: allowed on an ARCHIVED community (take-down must stay possible).
 * - The highlight and the story are both resolved in-lane; every miss is the bare 404.
 * - The item row is HARD-deleted (the pair arbiter, like a pin). Removing a pair that is not there
 *   is the idempotent 200 with the current count and NO event (transitions, not requests).
 * - When the removed story was the highlight's CHOSEN cover, `cover_story_id` is cleared in the SAME
 *   transaction, so `coverChosen` falls back to false and no stale pointer resurrects later.
 * - The STORY row is never written (R-D-F): a highlight is an editorial pointer, and removing the
 *   pointer never takes the story, its 24 h in Início, its likes or its comments. The highlight
 *   itself is KEPT even when this removed its last story (D-102).
 */
export async function removeStoryFromHighlight(
  ctx: RequestContext,
  highlightId: string,
  storyId: string,
): Promise<HighlightMembershipResult> {
  const gate = await readPlaceGate(ctx);

  const { highlightCount, removed } = await withTenantTx(ctx, async (tx) => {
    await resolveHighlight(tx, ctx, highlightId, 'takedown', gate);

    const stories = await tx.execute<{ id: string }>(sql`
      select s.id from stories s
       where s.id = ${storyId}::uuid
         and s.tenant_id = ${ctx.tenantId}::uuid
         and s.deleted_at is null`);
    if (!stories[0]) throw new ApiError(404, 'NOT_FOUND');

    const deleted = await tx.execute<{ id: string }>(sql`
      delete from story_highlight_items
       where highlight_id = ${highlightId}::uuid
         and story_id = ${storyId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
      returning id`);
    const removed = deleted.length > 0;

    if (removed) {
      await tx.execute(sql`
        update story_highlights set cover_story_id = null, updated_at = now()
         where id = ${highlightId}::uuid
           and tenant_id = ${ctx.tenantId}::uuid
           and cover_story_id = ${storyId}::uuid`);
    }

    return { highlightCount: await readHighlightCount(tx, ctx, storyId), removed };
  });

  if (removed) {
    emit(ctx, 'story.unhighlighted', {
      tenantId: ctx.tenantId,
      storyId,
      highlightId,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'stories.unhighlighted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      highlightId,
      storyId,
      removed,
      highlightCount,
    },
    'story removed from a highlight',
  );

  return { highlighted: false, highlightCount };
}
