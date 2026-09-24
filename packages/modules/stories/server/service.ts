import { withTenantTx } from '@tria/core/db/tenant-tx';
import type { RequestContext } from '@tria/core/server/auth/context';
import { emit } from '@tria/core/server/events/bus';
import { ApiError } from '@tria/core/server/http/api-error';
import { moduleLogger } from '@tria/core/server/logging';
import { decodeCursor, encodeCursor, keysetComparison } from '@tria/core/server/paging';
import { sql } from 'drizzle-orm';
import type {
  CreateStoryComment,
  PublishStory,
  StoryComment,
  StoryCommentPage,
  StoryCommentsQuery,
  StoryHighlightsQuery,
  StoryLikeResult,
  StoryMediaKind,
  StoryPage,
  StoryPinResult,
  StoryPins,
  StoryQuery,
  StorySummary,
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
 */
function storyProjection(viewerUserId: string) {
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
           ) as viewer_liked
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

  const created = await withTenantTx(ctx, async (tx) => {
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

    const rows = await tx.execute<StoryRow>(sql`
      ${storyProjection(ctx.userId)}
       where s.id = ${id}::uuid
       limit 1`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return row;
  });

  emit(ctx, 'story.published', {
    tenantId: ctx.tenantId,
    storyId: created.id,
    authorUserId: created.author_user_id,
    mediaKind: created.media_kind,
    expiresAt: created.expires_at,
  });

  log.info(
    {
      event: 'stories.published',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId: created.id,
      mediaKind: created.media_kind,
      mediaStatus: created.media_status,
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

/* ── Community pins (STORY-04, D-68) — RED SKELETONS ──────────────────────────────────────────── */

/**
 * Signature-only-and-wrong, on purpose: the RED phase needs the symbols to EXIST (an absent export
 * crashes the loader, which is `INVALID_RED`) while none of the behaviour does. Every value below is
 * frozen and deliberately mismatched against `tests/story-pins.test.ts`.
 */
export async function pinStory(
  _ctx: RequestContext,
  _storyId: string,
  _communityId: string,
): Promise<StoryPinResult> {
  return { pinned: false, pinnedCommunityCount: 0 };
}

export async function unpinStory(
  _ctx: RequestContext,
  _storyId: string,
  _communityId: string,
): Promise<StoryPinResult> {
  return { pinned: true, pinnedCommunityCount: 0 };
}

export async function listCommunityHighlights(
  _ctx: RequestContext,
  _query: StoryHighlightsQuery,
): Promise<StoryPage> {
  return { items: [], nextCursor: null };
}

export async function listStoryPins(_ctx: RequestContext, _storyId: string): Promise<StoryPins> {
  return { communityIds: [] };
}
