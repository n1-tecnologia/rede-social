import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { emit } from '@rede-social/core/server/events/bus';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { recordModerationAction } from '@rede-social/core/server/moderation/log';
import { moduleFlags } from '@rede-social/core/server/modules/flags-cache';
import { decodeCursor, encodeCursor, keysetComparison } from '@rede-social/core/server/paging';
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
  type ReorderHighlights,
  STORY_HIGHLIGHT_MAX_ITEMS,
  STORY_HIGHLIGHT_MAX_PER_PLACE,
  STORY_HIGHLIGHT_MAX_TITLE,
  type StoryComment,
  type StoryCommentPage,
  type StoryCommentsQuery,
  type StoryHighlightIds,
  type StoryLikeResult,
  type StoryMediaKind,
  type StoryPage,
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
  /** 05.2: how many highlights the story is in, counted in the SAME statement (D-100). */
  highlight_count: number | null;
  /** 05.2 (HIGHLIGHT-06): whether THE CALLER has a `story_views` row for it — their own flag only. */
  viewer_seen: boolean;
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
 * `viewer_liked` reads `feed_likes` through RAW SQL rather than through `@rede-social/module-feed`'s
 * schema export: a `module -> module` package dependency is denied by `turbo boundaries`, and the
 * table is Phase 4's published shape (`feed_likes_story_uq` already scopes it per user and story).
 * The same posture 05-03 took for the feed's `left join public.communities`.
 *
 * `is_active` is computed HERE, under the statement's own `now()`, so the flag and the rows it
 * describes come from one clock (UI-D-14).
 *
 * `highlight_count` (05.2, D-100) is counted in the SAME statement for the same reason everything
 * else is: "Seus stories" renders it (one story may sit in several highlights), and fetching it per
 * row would be the N+1 `feed-query-budget.test.ts` has a ceiling for. It rides the strip's read too,
 * unread, because one projection serving every surface is what stops them disagreeing about what a
 * story is. `story_highlight_items_uq` (`highlight_id, story_id`) cannot serve a lookup by
 * story alone; the per-story subquery is bounded by the handful of highlights one story is in.
 *
 * `viewer_seen` (05.2, HIGHLIGHT-06) is the caller's OWN seen flag — the tenant circle's ring and its
 * resume point — and it rides the same statement, so the strip stays ONE statement
 * (`feed-query-budget.test.ts`). Two things about it a reviewer must not "tidy":
 *  - **the tenant predicate is a CONSTANT, `v.tenant_id = ${ctx.tenantId}`**, never the correlated
 *    form joining the view's tenant to the story's. With the constant, the planner walks
 *    `story_views_uq (tenant_id, user_id, story_id)` as an Index Only Scan; the correlated form
 *    measured as a Seq Scan on the views table (RESEARCH Pattern 5; pinned by the EXPLAIN assertion in
 *    `120-story-highlights.sql`);
 *  - **it reads `user_id = ctx.userId` and nothing wider** — the privacy rule of `storyViews`: no
 *    read in this phase tells anyone which member saw a story, or how many did.
 * That is why the projection takes the request context rather than a bare user id.
 */
function storyProjection(ctx: RequestContext) {
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
                and l.user_id = ${ctx.userId}::uuid
           ) as viewer_liked,
           (
             select count(*)::int from story_highlight_items hi
              where hi.story_id = s.id
           ) as highlight_count,
           exists (
             select 1 from story_views v
              where v.tenant_id = ${ctx.tenantId}::uuid
                and v.user_id = ${ctx.userId}::uuid
                and v.story_id = s.id
           ) as viewer_seen
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
  highlightCount: row.highlight_count ?? 0,
  viewerSeen: row.viewer_seen,
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
      ${storyProjection(ctx)}
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
      ${storyProjection(ctx)}
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
 * viewer opens a single-item sequence from the history, and a highlight keeps an expired story a
 * legitimate thing to fetch. The STRIP is what filters; the row read never does.
 */
export async function getStory(ctx: RequestContext, storyId: string): Promise<StorySummary> {
  const row = await withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<StoryRow>(sql`
      ${storyProjection(ctx)}
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
 * **One destination or none (05.2, D-113/D-114; 05.1's D-99 carried).** The body names at most one
 * of `highlightId` (an existing highlight) or `newHighlight` (one created by this request); 05.1's
 * community-pin destination was retired with the pin model (HIGHLIGHT-05, D-116). Whichever it is,
 * the destination lookup, the story, any new highlight and the item row are ONE `withTenantTx`, so
 * any refusal rolls the whole publish back and no client-side "create, then publish, then add"
 * sequence exists anywhere.
 *
 * - **Destination first**, as `createPost` does. With `highlightId`: the highlight (`for update`) →
 *   its community for `curate` (Início has none) → the room count → asset → story insert → item →
 *   projection. With `newHighlight`: its community for `curate` → the place lock and cap → asset →
 *   story insert → highlight insert (at the END of the place) → item → projection. A refused
 *   destination costs no asset validation
 *   and never follows a (rolled-back) insert. WITHOUT a destination the statements are exactly
 *   today's three (asset → insert → projection) and the module flag is not read at all.
 * - **The place rules are the highlight seam's own** (`resolveHighlight` / `resolveHighlightPlace`
 *   / `lockHighlightPlace` / `insertHighlight` / `insertHighlightItem`): an archived community is
 *   `{ highlight: 'archived' }`, a full highlight or place `{ highlight: 'full' }`, every miss the
 *   bare 404. A story born in a highlight and a story added later are therefore the SAME item row.
 *   The module flag is read BEFORE the transaction opens (the `PlaceGate` rule: one request never
 *   holds two pooled connections).
 * - **The ROUTE owns the permission.** A body naming any destination additionally needs
 *   `stories.story.manage` (curation is the manage half); that check runs in the handler before this
 *   function is called, so this file never compares roles or permissions.
 * - **Events, after commit, ids only:** `story.published` keeps its five keys; then
 *   `highlight.created` for an inline highlight and `story.highlighted` for the item.
 *   **Phase 7 caveat:** a story published into a highlight raises `story.published` AND
 *   `story.highlighted`; a member-notification consumer must dedupe by `storyId`, or members get two
 *   notifications for one story.
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

  const highlightId = input.highlightId;
  const newHighlight = input.newHighlight;
  // Read BEFORE the transaction, and only when a highlight is named: the plain publish stays three
  // statements with no flag read.
  const gate =
    highlightId !== undefined || newHighlight !== undefined ? await readPlaceGate(ctx) : null;

  const {
    row: created,
    createdHighlightId,
    itemHighlightId,
  } = await withTenantTx(ctx, async (tx) => {
    // BEFORE the asset: a refused destination is the first thing the caller is told (see above).
    if (highlightId !== undefined && gate !== null) {
      await resolveHighlight(tx, ctx, highlightId, 'curate', gate);
      await assertHighlightHasRoom(tx, ctx, highlightId, null);
    }
    if (newHighlight !== undefined && gate !== null) {
      await resolveHighlightPlace(tx, ctx, newHighlight.communityId, 'curate', gate);
      await lockHighlightPlace(tx, ctx, newHighlight.communityId);
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

    // The inline highlight is written AFTER the story, through the one highlight insert.
    const newId =
      newHighlight !== undefined
        ? await insertHighlight(tx, ctx, newHighlight.communityId, newHighlight.title)
        : null;
    const target = highlightId ?? newId;
    // The one item statement `addStoryToHighlight` also uses: born in ≡ added later.
    const itemWritten = target !== null ? await insertHighlightItem(tx, ctx, target, id) : false;

    const rows = await tx.execute<StoryRow>(sql`
      ${storyProjection(ctx)}
       where s.id = ${id}::uuid
       limit 1`);
    const row = rows[0];
    if (!row) throw new ApiError(500, 'INTERNAL');
    return {
      row,
      createdHighlightId: newId,
      itemHighlightId: itemWritten ? target : null,
    };
  });

  emit(ctx, 'story.published', {
    tenantId: ctx.tenantId,
    storyId: created.id,
    authorUserId: created.author_user_id,
    mediaKind: created.media_kind,
    expiresAt: created.expires_at,
  });

  if (createdHighlightId !== null && newHighlight !== undefined) {
    emit(ctx, 'highlight.created', {
      tenantId: ctx.tenantId,
      highlightId: createdHighlightId,
      communityId: newHighlight.communityId,
      actorUserId: ctx.userId,
    });
  }

  if (itemHighlightId !== null) {
    emit(ctx, 'story.highlighted', {
      tenantId: ctx.tenantId,
      storyId: created.id,
      highlightId: itemHighlightId,
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
      // An id or null and a flag — never a highlight TITLE (T-05.2-37).
      highlightId: highlightId ?? createdHighlightId,
      newHighlight: newHighlight !== undefined,
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
 *  - **EXPIRY IS NOT A PREDICATE HERE.** An expired story kept in a highlight stays likeable (A-4): expiry gates
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

/* ── Seen state (HIGHLIGHT-06, D-105) ─────────────────────────────────────────────────────────── */

/**
 * `POST /v1/stories/views` — record that THE CALLER was shown these stories (R-D-I: the segment was
 * the current one and its media reported ready; the web batches the ids). Every caller's views are
 * recorded, admins included, and a story shown inside a highlight is the same story id, so it marks
 * the tenant circle too. An EXPIRED story is recorded like any other: expiry gates the strip, never
 * an interaction (A-4).
 *
 * ONE statement, the `likeStory` shape:
 *  - **the insert SELECTS the stories in the caller's lane** (`s.tenant_id = ctx.tenantId`, not
 *    deleted) rather than trusting the ids, so a foreign, unknown or removed id produces no row to
 *    insert (T-05.2-46). `tenant_id` and `user_id` come from `ctx`, never from the body;
 *  - **`story_views_uq` is the idempotency arbiter** — a repeat, or two tabs flushing the same id at
 *    once, writes one row per (tenant, user, story);
 *  - **nothing is returned to the caller**: the route answers 204 whatever was written, so the
 *    endpoint cannot be used to learn whether an id exists (T-05.2-47).
 *
 * **No event** (R-D-L): a view is a high-volume read of state, not a transition a subscriber acts
 * on. The log line carries the requested and inserted COUNTS only — never a story id, because a log
 * of "user U saw story S" is exactly the member-watching record V8 forbids in this phase.
 */
export async function markStoriesSeen(ctx: RequestContext, storyIds: string[]): Promise<void> {
  // `in (…)` over individually-cast ids, the feed's `validateAssets` shape: drizzle's `sql` expands a
  // JS array into a comma-separated parameter list, so `any(${ids}::uuid[])` is not one array. The
  // ids are Zod-validated uuids (1..50) before this runs.
  const idList = sql.join(
    storyIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const inserted = await withTenantTx(ctx, (tx) =>
    tx.execute<{ id: string }>(sql`
      insert into story_views (tenant_id, user_id, story_id)
      select ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, s.id
        from stories s
       where s.id in (${idList})
         and s.tenant_id = ${ctx.tenantId}::uuid
         and s.deleted_at is null
      on conflict (tenant_id, user_id, story_id) do nothing
      returning id`),
  );

  log.info(
    {
      event: 'stories.views_recorded',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      requested: storyIds.length,
      inserted: inserted.length,
    },
    'story views recorded',
  );
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
 * It reads `feed_comments` through RAW SQL rather than through `@rede-social/module-feed`'s schema export,
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

/**
 * What one viewer may do with the removal control (08-03, D-336, UI-D-276, T-04-44) — derived HERE,
 * on the server, so the web never compares ids. The author's own row is `'own'`; someone else's row
 * is `'moderation'` exactly when the caller holds `moderation.manage` (read by the ROUTE before the
 * service opens its transaction); anything else is `null`. `deleteStoryComment` re-decides the same
 * question under a row lock, so this value is a convenience, never the authority.
 */
const storyRemovalFor = (
  row: StoryCommentRow,
  viewerUserId: string,
  canModerate: boolean,
): 'own' | 'moderation' | null =>
  row.author_user_id === viewerUserId ? 'own' : canModerate ? 'moderation' : null;

/** Row → published contract. Timestamps cross the wire as ISO strings, never as `Date`. */
const toStoryComment = (
  row: StoryCommentRow,
  viewerUserId: string,
  canModerate: boolean,
): StoryComment => ({
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
  canDelete: storyRemovalFor(row, viewerUserId, canModerate) !== null,
  removal: storyRemovalFor(row, viewerUserId, canModerate),
});

/**
 * The comparison and the order for D-83's forward-running list, resolved ONCE from the repo's one
 * cursor envelope (`@rede-social/core/server/paging`).
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
 * here — an expired story kept in a highlight is a readable surface (A-4).
 */
export async function listStoryComments(
  ctx: RequestContext,
  storyId: string,
  query: StoryCommentsQuery,
  opts: { canModerate: boolean },
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

  return {
    items: page.map((row) => toStoryComment(row, ctx.userId, opts.canModerate)),
    nextCursor,
  };
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

  // The caller wrote this row, so its removal is `'own'` whatever they hold: no permission read here.
  return toStoryComment(created, ctx.userId, false);
}

/**
 * `DELETE /v1/stories/{storyId}/comments/{commentId}` (D-61's rule, restated for stories) — the
 * author removes their OWN comment, and since 08-03 (D-336, MODER-01) a caller holding
 * `moderation.manage` removes ANYONE's.
 *
 * In ONE `withTenantTx`, mirroring 08-01's feed `deleteComment`:
 *  1. The live row is LOCKED (`for update`) with `tenant_id` and `story_id` in the predicate, so a
 *     comment id of another story, of a POST, or of another tenant answers like an unknown one, and
 *     two concurrent removals serialise on the lock (the second sees `deleted_at` set and misses).
 *  2. Missing, or neither the author nor `canModerate`, is the ONE bare 404 — a member or support
 *     user cannot even probe whether someone else's comment exists (T-04-16, T-08-14).
 *  3. The soft delete sets `deleted_at` and `deleted_by_user_id`. Story comments are FLAT
 *     (`feed_comments_parent_fk` makes a reply unrepresentable), so nothing cascades.
 *  4. When the actor is NOT the author, the kernel `recordModerationAction`, given THIS `tx`,
 *     appends the `subject_type = 'story_comment'` log row in the same transaction — a removal
 *     without its log row is impossible, and a failed log insert rolls the removal back (T-08-17).
 *     A moderator removing their OWN comment writes no row (R-Pitfall 2).
 *
 * `canModerate` is read by the ROUTE through `permissionsForRequest(ctx)` BEFORE this function opens
 * its transaction (the pool is `max: 5`; see `readPlaceGate`).
 *
 * The count moves EXACTLY ONCE, and not from here: `app.feed_comment_count()` fires on the
 * `deleted_at` TRANSITION. `story.comment_deleted` is emitted once, after commit, whoever removed
 * the row — so the story author's `stories.story_commented` row is retracted the same way, and the
 * comment's author is told nothing (D-335).
 */
export async function deleteStoryComment(
  ctx: RequestContext,
  storyId: string,
  commentId: string,
  opts: { canModerate: boolean },
): Promise<void> {
  const moderated = await withTenantTx(ctx, async (tx) => {
    const locked = await tx.execute<{ id: string; author_user_id: string; body: string }>(sql`
      select id, author_user_id, body
        from feed_comments
       where id = ${commentId}::uuid
         and tenant_id = ${ctx.tenantId}::uuid
         and story_id = ${storyId}::uuid
         and deleted_at is null
       for update`);
    const target = locked[0];
    const isAuthor = target?.author_user_id === ctx.userId;
    if (!target || (!isAuthor && !opts.canModerate)) throw new ApiError(404, 'NOT_FOUND');

    const removed = await tx.execute<{ id: string }>(sql`
      update feed_comments
         set deleted_at = now(),
             deleted_by_user_id = ${ctx.userId}::uuid
       where id = ${commentId}::uuid
         and deleted_at is null
      returning id`);
    if (!removed[0]) throw new ApiError(404, 'NOT_FOUND');

    if (!isAuthor) {
      await recordModerationAction(tx, ctx, {
        action: 'comment_removed',
        targetUserId: target.author_user_id,
        subjectType: 'story_comment',
        subjectId: commentId,
        excerptSource: target.body,
        reason: null,
      });
    }
    return !isAuthor;
  });

  emit(ctx, 'story.comment_deleted', {
    tenantId: ctx.tenantId,
    storyId,
    commentId,
    actorUserId: ctx.userId,
  });

  // Ids only — never the body (T-05-43, the MODER-03 privacy prohibition).
  log.info(
    {
      event: 'stories.comment.deleted',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      storyId,
      commentId,
      moderated,
    },
    'story comment soft-deleted',
  );
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
 *    removal must stay possible (the rule the retired pin model had).
 *
 * Phase 10's creator-scoped publishing extends THIS function with its creator branch; no route or
 * other service function has to learn what a place is. The table is named through RAW SQL rather
 * than `@rede-social/module-communities`'s schema export (MOD-02).
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
 *      highlight migrated from the retired pin model, the most recently pinned story (D-116);
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
 * Lock a place's highlight rows `for update` and refuse a place already holding
 * `STORY_HIGHLIGHT_MAX_PER_PLACE` with `{ highlight: 'full' }` — the append's guard, shared by
 * `createHighlight` and a publish that creates its highlight inline (D-114), so both appends
 * serialise on the same lock and count the same way.
 */
async function lockHighlightPlace(
  tx: Tx,
  ctx: RequestContext,
  communityId: string | null,
): Promise<void> {
  const place = await tx.execute<{ id: string }>(sql`
    select h.id
      from story_highlights h
     where h.tenant_id = ${ctx.tenantId}::uuid
       and ${placePredicate('h', communityId)}
     for update`);
  if (place.length >= STORY_HIGHLIGHT_MAX_PER_PLACE) {
    throw new ApiError(400, 'VALIDATION_FAILED', { highlight: 'full' });
  }
}

/**
 * THE ONE statement that creates a highlight, at the END of its place (`coalesce(max(position) + 1,
 * 0)`) — shared by `createHighlight` and the inline create inside `publishStory`, so a highlight
 * created from the manage screen and one created while publishing are the same row by construction.
 * The caller has already resolved the place for `curate` and taken `lockHighlightPlace`.
 */
async function insertHighlight(
  tx: Tx,
  ctx: RequestContext,
  communityId: string | null,
  title: string,
): Promise<string> {
  const inserted = await tx.execute<{ id: string }>(sql`
    insert into story_highlights (tenant_id, community_id, title, position, created_by_user_id)
    select ${ctx.tenantId}::uuid,
           ${communityId}::uuid,
           ${title},
           coalesce(max(h.position) + 1, 0),
           ${ctx.userId}::uuid
      from story_highlights h
     where h.tenant_id = ${ctx.tenantId}::uuid
       and ${placePredicate('h', communityId)}
    returning id`);
  const id = inserted[0]?.id;
  if (!id) throw new ApiError(500, 'INTERNAL');
  return id;
}

/**
 * Refuse a NEW story for a highlight already holding `STORY_HIGHLIGHT_MAX_ITEMS` LIVE stories with
 * `{ highlight: 'full' }`; a story already in it (`present`) is never refused — the repeat add is
 * the idempotent 200. Shared by `addStoryToHighlight` and a publish into an existing highlight
 * (`storyId` null: a story being born cannot be present). Read under `resolveHighlight`'s `for
 * update`, so the count is exact against a concurrent add.
 *
 * The cap counts LIVE stories only (WR-01): items of soft-deleted stories remain as the record of
 * where a story had been (05.2-29) and no longer consume a slot. `present` stays over ALL rows, so a
 * repeat add of any story already held is still the idempotent 200.
 */
async function assertHighlightHasRoom(
  tx: Tx,
  ctx: RequestContext,
  highlightId: string,
  storyId: string | null,
): Promise<void> {
  const held = await tx.execute<{ n: number; present: boolean }>(sql`
    select count(*) filter (where s.deleted_at is null)::int as n,
           coalesce(bool_or(i.story_id = ${storyId}::uuid), false) as present
      from story_highlight_items i
      join stories s on s.id = i.story_id
                    and s.tenant_id = ${ctx.tenantId}::uuid
     where i.highlight_id = ${highlightId}::uuid
       and i.tenant_id = ${ctx.tenantId}::uuid`);
  const counted = held[0];
  if (counted && !counted.present && counted.n >= STORY_HIGHLIGHT_MAX_ITEMS) {
    throw new ApiError(400, 'VALIDATION_FAILED', { highlight: 'full' });
  }
}

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
    await lockHighlightPlace(tx, ctx, communityId);
    const id = await insertHighlight(tx, ctx, communityId, input.title);

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
 * THE ONE statement that writes a highlight item — shared by `addStoryToHighlight` and by a
 * publish into a highlight (`publishStory`, 05.2-08), so a story born in a highlight and a story added later are the
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

    await assertHighlightHasRoom(tx, ctx, highlightId, storyId);

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
      ${storyProjection(ctx)}
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
 * The `takedown` intent: an ARCHIVED community still allows it (removal must stay possible, as it
 * was for the retired pin model). The items cascade with the highlight; the STORIES, their likes and their comments are
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
 * - The highlight and the story are both resolved in-lane; every miss is the bare 404. The story is
 *   resolved regardless of its state, so a take-down can remove an item whose story was deleted
 *   (WR-01) — only an unknown or another tenant's story id is the 404.
 * - The item row is HARD-deleted (the pair arbiter). Removing a pair that is not there
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
         and s.tenant_id = ${ctx.tenantId}::uuid`);
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

/* ── Reorder and the sheet's reads (05.2-03: R-D-C, D-110, HIGHLIGHT-04) ─────────────────────── */

/**
 * `PUT /v1/stories/highlights/order` — reorder ONE place's highlights (R-D-C).
 *
 * One `withTenantTx`, three steps:
 *  1. the place is resolved for `curate` (an archived community refuses with `archived`, the module
 *     off or a removed community is the bare 404) — the one seam, R-D-K;
 *  2. the place's rows are locked `for update`, and the LOCKED id set is compared with the request:
 *     same size, no duplicates, identical members. Anything else — missing, extra, duplicated,
 *     foreign — is `{ highlight: 'order_stale' }` and nothing is written (T-05.2-14). Locking first
 *     is what makes the comparison meaningful: a create or delete racing this reorder waits for it
 *     instead of changing the set between the check and the write;
 *  3. ONE renumber statement writes dense positions `0..n-1` from `unnest(…) with ordinality`,
 *     touching only rows whose position really changes (`position <> ord - 1`).
 *
 * `highlight.reordered` is emitted only when the renumber returned rows: a permutation equal to the
 * current order changes nothing and announces nothing. The answer is the place's CURATOR row (empty
 * highlights included) in the new order.
 */
export async function reorderHighlights(
  ctx: RequestContext,
  input: ReorderHighlights,
): Promise<HighlightList> {
  const communityId = input.communityId ?? null;
  const requested = input.highlightIds;
  const gate = await readPlaceGate(ctx);

  const { rows, moved } = await withTenantTx(ctx, async (tx) => {
    await resolveHighlightPlace(tx, ctx, communityId, 'curate', gate);

    const locked = await tx.execute<{ id: string }>(sql`
      select h.id
        from story_highlights h
       where h.tenant_id = ${ctx.tenantId}::uuid
         and ${placePredicate('h', communityId)}
       for update`);
    const current = new Set(locked.map((row) => row.id));
    const distinct = new Set(requested);
    if (
      requested.length !== current.size ||
      distinct.size !== requested.length ||
      requested.some((id) => !current.has(id))
    ) {
      throw new ApiError(400, 'VALIDATION_FAILED', { highlight: 'order_stale' });
    }

    // The ids travel as ONE Postgres array literal: drizzle's `sql` would expand a JS array into a
    // comma-separated parameter list. Every element is a Zod-validated uuid AND a member of the set
    // just locked, so nothing caller-shaped reaches the literal.
    const renumbered = await tx.execute<{ id: string }>(sql`
      update story_highlights h
         set position = o.ord - 1, updated_at = now()
        from unnest(${`{${requested.join(',')}}`}::uuid[]) with ordinality as o(id, ord)
       where h.id = o.id
         and h.tenant_id = ${ctx.tenantId}::uuid
         and h.position <> o.ord - 1
      returning h.id`);

    const list = await tx.execute<HighlightSummaryRow>(sql`
      ${highlightProjection(
        sql`h.tenant_id = ${ctx.tenantId}::uuid and ${placePredicate('h', communityId)}`,
      )}
       order by hp.position, hp.id`);
    return { rows: list, moved: renumbered.length };
  });

  if (moved > 0) {
    emit(ctx, 'highlight.reordered', {
      tenantId: ctx.tenantId,
      communityId,
      actorUserId: ctx.userId,
    });
  }

  log.info(
    {
      event: 'stories.highlights_reordered',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communityId,
      count: requested.length,
      moved,
    },
    'story highlights reordered',
  );

  return { items: rows.map(toHighlight) };
}

/**
 * `GET /v1/stories/highlights/catalog` (D-110) — every highlight the shared "add to highlight" sheet
 * may offer, in ONE statement over `highlightProjection`: Início's, then each ACTIVE community's,
 * ordered `community_id nulls first, position, id` (a total order).
 *
 * - A community highlight is listed only while its community is this tenant's, not removed and
 *   `active`: an archived community takes no new content, so offering it in the sheet would only
 *   lead to an `archived` refusal.
 * - With the `communities` module OFF no community highlight is listed at all (HIGHLIGHT-04) — the
 *   rows are untouched and come back with the module.
 * - It is the CURATOR's read (manage-only at the route): empty highlights are included.
 */
export async function listHighlightCatalog(ctx: RequestContext): Promise<HighlightList> {
  const gate = await readPlaceGate(ctx);
  const communityPlaces = gate.communitiesOn
    ? sql`exists (
          select 1 from communities hc
           where hc.id = h.community_id
             and hc.tenant_id = ${ctx.tenantId}::uuid
             and hc.status = 'active'
             and hc.deleted_at is null
        )`
    : sql`false`;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<HighlightSummaryRow>(sql`
      ${highlightProjection(
        sql`h.tenant_id = ${ctx.tenantId}::uuid and (h.community_id is null or ${communityPlaces})`,
      )}
       order by hp.community_id nulls first, hp.position, hp.id`),
  );

  log.info(
    {
      event: 'stories.highlight_catalog',
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      requestId: ctx.requestId,
      communitiesOn: gate.communitiesOn,
      returned: rows.length,
    },
    'story highlight catalog listed',
  );

  return { items: rows.map(toHighlight) };
}

/**
 * `GET /v1/stories/{storyId}/highlights` (D-110) — the ids of the highlights one story is in, the
 * shared sheet's initial state. Ids only: the sheet already holds the titles from the catalogue.
 *
 * The story is resolved first so a miss is the same bare 404 every story-scoped route gives, rather
 * than an empty list that would say "this story exists and is in no highlight". With the
 * `communities` module off, community highlights are left out, exactly as the catalogue leaves them.
 */
export async function listStoryHighlightIds(
  ctx: RequestContext,
  storyId: string,
): Promise<StoryHighlightIds> {
  const gate = await readPlaceGate(ctx);
  const places = gate.communitiesOn ? sql`true` : sql`h.community_id is null`;

  const highlightIds = await withTenantTx(ctx, async (tx) => {
    const stories = await tx.execute<{ id: string }>(sql`
      select s.id from stories s
       where s.id = ${storyId}::uuid
         and s.tenant_id = ${ctx.tenantId}::uuid
         and s.deleted_at is null`);
    if (!stories[0]) throw new ApiError(404, 'NOT_FOUND');

    const rows = await tx.execute<{ highlight_id: string }>(sql`
      select i.highlight_id
        from story_highlight_items i
        join story_highlights h on h.id = i.highlight_id
       where i.story_id = ${storyId}::uuid
         and i.tenant_id = ${ctx.tenantId}::uuid
         and ${places}
       order by h.community_id nulls first, h.position, h.id`);
    return rows.map((row) => row.highlight_id);
  });

  return { highlightIds };
}
