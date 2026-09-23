import { tenantIsolationPolicy } from '@tria/core/db/rls';
import { mediaAssets, tenants, users } from '@tria/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The feed's post table (FEED-02, FEED-08) and the module's first table.
 *
 * FOUR THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **There is no `title` column and no post-kind / classification column** (D-51). One post model, one
 *    `PostCard`, everywhere — feed, post page and (Phase 5) inside a community. A nullable `title`
 *    would be additive if the decision is ever revisited; a type chip is the expensive half (a
 *    per-tenant vocabulary and a brand-derived colour) and is rejected now rather than smuggled into
 *    the schema.
 *
 * 2. **`deleted_at` is deliberately absent from the RLS policy.** Phase 8 moderation must be able to
 *    SEE removed rows through the tenant lane, so the filter lives in the read queries
 *    (`where p.deleted_at is null`), not in `tenantIsolationPolicy`. Moving it into the policy would
 *    silently blind the moderation surface that has not been written yet.
 *
 * 3. **`community_id` participates in the list index on purpose**, even though V1 only ever asks for
 *    `community_id is null`: FEED-02's predicate becomes `community_id in (…)` in Phase 5, and the
 *    index that serves both is `(tenant_id, community_id, created_at desc, id desc)`. It carries NO
 *    foreign key yet — `communities` does not exist until Phase 5, which adds the reference.
 *
 * 4. **`like_count` and `comment_count` are TRIGGER-OWNED** (04-03 adds the triggers). No application
 *    code may update them; a service that does will drift from the rows it is supposed to summarise.
 *    They default to 0 and are declared now so the wire contract never changes.
 *
 * Authorship is the generic `author_user_id -> users.id` (SCHEMA-CONVENTIONS §(c).1, FEED-08): there
 * is no admin-flavoured author column and no admin-only foreign key anywhere. "Only the admin may
 * write" is a PERMISSION VALUE (`tenant_modules['feed'].settings.postingPolicy`), so V2 member posting is a
 * settings flip rather than a migration (V2-CONT-01).
 *
 * Owned by `packages/modules/feed` and picked up by `apps/api/drizzle.config.ts`'s
 * `packages/modules/*​/db/schema.ts` glob.
 */
export const feedPosts = pgTable(
  'feed_posts',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Generic authorship (FEED-08). Never a role-specific column name, never a role-flavoured boolean. */
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    /** Reserved for Phase 5's community feed. No FK yet — `communities` does not exist. */
    communityId: uuid('community_id'),
    /** Plain text with newlines preserved (D-54). URLs are auto-linked at RENDER time, never stored as HTML. */
    caption: text().notNull().default(''),
    /** 'none' | 'gallery' | 'video' — the discriminator 04-04 writes when `feed_post_media` lands. */
    mediaKind: text('media_kind').notNull().default('none'),
    /** Trigger-owned (04-03). Application code never writes these. */
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * At most ONE preview per post, BY CONSTRUCTION (MEDIA-04): a single nullable foreign key, not a
     * collection — so there is no multi-preview layout that could degrade (UI-SPEC E06
     * zero-one-many). `on delete set null` is what lets a preview row be dropped (a cache purge, a
     * re-unfurl) without taking the post with it; the post then renders the bare auto-linked URL.
     * Nulling this column is ALSO the admin's entire remove affordance — there is no override path.
     */
    linkPreviewId: uuid('link_preview_id').references(() => feedLinkPreviews.id, {
      onDelete: 'set null',
    }),
    /** Set on ANY persisted change, media included (FEED-03 / UI-D-15). Renders as "editado". */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // FEED-02's list query verbatim, tie-breaker included, so `(created_at, id)` is a TOTAL order the
    // index carries: a page boundary can neither duplicate nor skip a row.
    //
    // `.nullsFirst()` is NOT decoration (04-03, caught by `090-feed.sql`'s EXPLAIN assertion):
    // drizzle's `.desc()` alone emits `DESC NULLS LAST`, while SQL's `order by x desc` means
    // `desc NULLS FIRST`. The two do not match, so the planner cannot use the index to DELIVER the
    // ordering and falls back to a full sort of the tenant's posts on every page. Both columns are
    // NOT NULL, so this changes no result — only whether the index is usable at all.
    index('feed_posts_tenant_community_created_idx').on(
      t.tenantId,
      t.communityId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // V1's main feed is `community_id is null`, and a NULL TEST on a key column does NOT pin that
    // column the way an equality does — so the composite index above can serve Phase 5's
    // `community_id = <id>` page but can never deliver the ordering for this one. The predicate
    // therefore moves into the index, which drops `community_id` out of the key entirely. Both
    // indexes are justified: this one for the tenant feed, the one above for a community feed.
    index('feed_posts_tenant_created_idx')
      .on(t.tenantId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`community_id is null`),
    // "this member's posts" (a profile tab, Phase 8 moderation) without a sequential scan.
    index('feed_posts_tenant_author_idx').on(t.tenantId, t.authorUserId),
    check('feed_posts_media_kind_chk', sql`${t.mediaKind} in ('none','gallery','video')`),
    // The target of `feed_post_media_kind_fk` (04-04). `id` is already the primary key; this pair is
    // what lets a media row name "(this post) AND (that post's media_kind)" in ONE referential check,
    // which is how D-53's gallery-XOR-video rule becomes a constraint rather than a convention.
    unique('feed_posts_id_media_kind_uq').on(t.id, t.mediaKind),
    tenantIsolationPolicy('feed_posts_tenant_isolation'),
  ],
).enableRLS();

/**
 * A post's media, as an ORDERED COLLECTION (FEED-01, D-53) — never as columns on `feed_posts`.
 *
 * `feed_posts` deliberately carries NO singular per-asset column ("the post's image", "the post's
 * video", "the post's cover"). A single-image post is the ONE-ROW case of this table, not a special
 * column: two sources of truth for the same fact would make the carousel's ordering ambiguous and
 * would turn D-53's rule into a coordination problem between columns instead of a referential
 * check. A grep gate in 04-04's acceptance criteria pins that absence.
 *
 * **D-53 IS ENFORCED HERE, DECLARATIVELY AND RACE-FREE.** The mechanism is the same composite-foreign-key
 * technique `feed_comments_parent_fk` uses for the one reply level:
 *
 *   1. `feed_posts` carries exactly ONE `media_kind` (`'none' | 'gallery' | 'video'`) and a
 *      `unique (id, media_kind)` so that pair is nameable;
 *   2. every media row carries a REDUNDANT `post_media_kind` and a composite foreign key
 *      `(post_id, post_media_kind) -> feed_posts(id, media_kind)`, so a row can only claim a value
 *      its parent actually has;
 *   3. `feed_post_media_kind_chk` binds `kind = 'image'` to `post_media_kind = 'gallery'` and
 *      `kind = 'video'` to `post_media_kind = 'video'`.
 *
 * Because a post has exactly one `media_kind`, an image row and a video row CANNOT COEXIST: whichever
 * comes second names a `(post_id, post_media_kind)` pair that does not exist and fails with SQLSTATE
 * 23503 (or 23514 if it lies about its own `kind`). A `before insert` trigger that counted sibling
 * rows instead would be a read-then-write with no lock — two concurrent inserts could both observe
 * "no video yet" and both succeed, producing exactly the post no renderer can draw. Do not
 * "simplify" the redundant column away: it is the whole mechanism.
 *
 * A `kind = 'file'` row places NO constraint on the parent (the check accepts all three parent
 * values), so an announcement may be photos plus a PDF, a video plus a PDF, or text plus a PDF.
 *
 * The row stores an ASSET ID and a POSITION. It never stores a URL, a signed token or a byte:
 * images render through the stable `/v1/media/{assetId}/{variant}` redirect on every fetch (R-05,
 * TENANT-04) and the bytes live in the private `media` bucket the Phase 3 broker owns (MEDIA-01).
 */
export const feedPostMedia = pgTable(
  'feed_post_media',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => feedPosts.id, { onDelete: 'cascade' }),
    /** Redundant on purpose — the second half of `feed_post_media_kind_fk`. See the docblock. */
    postMediaKind: text('post_media_kind').notNull(),
    /** The Phase 3 broker's asset. Never a URL, never a signed token (MEDIA-01, TENANT-04). */
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    /** 'image' | 'video' | 'file' — the same vocabulary as `media_assets.kind`. */
    kind: text().notNull(),
    /** The array index the composer sent. THE gallery order; a reorder is a reorder of this. */
    position: integer().notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The callback form, not a column-level `.references()`: a composite foreign key has no
    // column-level spelling (the same reason `feed_comments_parent_fk` is written this way).
    foreignKey({
      columns: [t.postId, t.postMediaKind],
      foreignColumns: [feedPosts.id, feedPosts.mediaKind],
      name: 'feed_post_media_kind_fk',
    }).onDelete('cascade'),
    // Half two of the XOR. Paired with the foreign key above and the parent's single `media_kind`,
    // an image row and a video row on one post are mutually exclusive AT THE INDEX.
    check(
      'feed_post_media_kind_chk',
      sql`(kind = 'image' and post_media_kind = 'gallery')
       or (kind = 'video' and post_media_kind = 'video')
       or (kind = 'file' and post_media_kind in ('none','gallery','video'))`,
    ),
    // At most ONE video per post — PARTIAL, so the image and file rows (which may be many) are not
    // caught by it. A second video insert fails 23505 here, not in application code.
    uniqueIndex('feed_post_media_video_uq').on(t.postId).where(sql`kind = 'video'`),
    // Stable, gap-free ordering per kind: two rows cannot claim slide 3, so the carousel's order is
    // a fact of the data rather than of whatever order the rows happened to come back in.
    uniqueIndex('feed_post_media_position_uq').on(t.postId, t.kind, t.position),
    // `tenant_id` first (01-08 convention); `position` last so the projection's ordered read is
    // delivered by the index rather than sorted.
    index('feed_post_media_tenant_post_idx').on(t.tenantId, t.postId, t.position),
    tenantIsolationPolicy('feed_post_media_tenant_isolation'),
  ],
).enableRLS();

/**
 * The comment thread (FEED-05, FEED-06, D-59..D-62) — and the one place in this phase where a
 * REQUIREMENT is enforced by the database rather than by the API.
 *
 * **The one reply level is DECLARATIVE.** `depth`, the redundant `parent_depth`, the
 * `unique (id, depth)` and the composite self-referencing foreign key
 * `(parent_id, parent_depth) -> (id, depth)` together make a reply-to-a-reply impossible: the only
 * `(id, depth)` pair a reply may name is one whose `depth` is 0, so a reply (depth 1) can never be
 * a parent. A `before insert` trigger that read the parent row instead would be a read-then-write
 * with no lock — two concurrent inserts could both observe `parent.parent_id is null` and both
 * succeed, producing exactly the three-level thread the constraint exists to forbid. The foreign
 * key is enforced by an index and cannot race, needs no `security definer` function and no
 * `search_path` hardening.
 *
 * The refusals a caller will actually see (verified against this project's Postgres):
 *   - reply to a reply                  -> SQLSTATE 23503 on `feed_comments_parent_fk`
 *   - lying about `parent_depth`/`depth`-> SQLSTATE 23514 on `feed_comments_parent_shape_chk`
 * `packages/modules/feed/server/service.ts` maps BOTH to `400 VALIDATION_FAILED
 * { comment: 'reply_depth_exceeded' }`. There is deliberately NO application-level depth check: one
 * would pass a test suite while the constraint was missing.
 *
 * THREE MORE THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **The self-reference uses the `foreignKey({ columns, foreignColumns })` CALLBACK form**, not a
 *    column-level `.references(() => feedComments.id)`. The column-level form on a self-referencing
 *    column is what trips TypeScript's circularity check and forces a widened column-type
 *    annotation to break it.
 * 2. **`story_id` is reserved for Phase 5** and carries no foreign key yet (`stories` does not
 *    exist). `feed_comments_target_chk` already pins "exactly one target", so Phase 5 adds the
 *    reference and nothing else.
 * 3. **`deleted_at` stays OUT of the RLS policy** (the `feed_posts` rule, restated): Phase 8's
 *    MODER-01 must see removed rows through the tenant lane, so `deleted_at is null` lives in every
 *    read query instead.
 *
 * `like_count` is TRIGGER-OWNED, exactly like the post counters (see `*_feed_counters.sql`).
 */
export const feedComments = pgTable(
  'feed_comments',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Exactly one of `post_id` / `story_id` is set — see `feed_comments_target_chk`. */
    postId: uuid('post_id').references(() => feedPosts.id, { onDelete: 'cascade' }),
    /** Reserved for Phase 5's story comments. No FK yet — `stories` does not exist. */
    storyId: uuid('story_id'),
    /** Generic authorship, the `feed_posts` rule restated (FEED-08 / SCHEMA-CONVENTIONS §(c).1). */
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    /** Plain text with newlines preserved (D-54). URLs are auto-linked at RENDER time, never stored as HTML. */
    body: text().notNull(),
    /** 0 = root, 1 = reply. There is no legal third value — `feed_comments_parent_shape_chk` says so. */
    depth: smallint().notNull().default(0),
    parentId: uuid('parent_id'),
    /**
     * Redundant on purpose: it is the second half of the composite foreign key, which is what makes
     * "a reply may only point at a ROOT" a structural fact rather than an application convention.
     */
    parentDepth: smallint('parent_depth'),
    /** Trigger-owned (`app.feed_like_count()`). Application code never writes this. */
    likeCount: integer('like_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** D-61: a member soft-deletes their OWN comment. The row stays for Phase 8 moderation. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // The target of the composite self-FK below. `id` is already the primary key; this pair is what
    // lets a child row name "(this id) AND (that id's depth)" in a single referential check.
    unique('feed_comments_id_depth_uq').on(t.id, t.depth),
    foreignKey({
      columns: [t.parentId, t.parentDepth],
      foreignColumns: [t.id, t.depth],
      name: 'feed_comments_parent_fk',
    }).onDelete('cascade'),
    // The two — and only two — legal shapes. Anything else is a 23514 before it reaches a row.
    check(
      'feed_comments_parent_shape_chk',
      sql`(parent_id is null and parent_depth is null and depth = 0)
       or (parent_id is not null and parent_depth = 0 and depth = 1)`,
    ),
    // SCHEMA-CONVENTIONS §(e).3: exactly one target, so Phase 5 reuses the table with no rewrite.
    check('feed_comments_target_chk', sql`num_nonnulls(post_id, story_id) = 1`),
    // D-62's root list verbatim — `order by created_at desc, id desc` over the live roots of one
    // post. `id` is in the index because it is in the order: ties are impossible, so a page
    // boundary can neither duplicate nor skip.
    // `.nullsFirst()` for the same reason the post index carries it: `order by created_at desc`
    // is `desc NULLS FIRST`, and an index built `DESC NULLS LAST` cannot deliver that ordering.
    index('feed_comments_tenant_post_root_idx')
      .on(t.tenantId, t.postId, t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`parent_id is null`),
    // D-62's reply list verbatim — `order by created_at, id` under one root. The OPPOSITE direction
    // from the roots, which is why it is a second index and not a reuse of the first.
    index('feed_comments_tenant_parent_idx').on(t.tenantId, t.parentId, t.createdAt, t.id),
    tenantIsolationPolicy('feed_comments_tenant_isolation'),
  ],
).enableRLS();

/**
 * Likes (FEED-04, FEED-06) — ONE table for the behaviour, with TYPED targets.
 *
 * **This deliberately follows SCHEMA-CONVENTIONS §(e).3, not §(e).1.** §(e).1 sketches a POLYMORPHIC
 * pair — an untyped kind column beside an untyped id column. Such a pair cannot carry a foreign key,
 * so deleting a post would leave orphan like rows and the counter triggers would have nothing to
 * cascade from. §(e).3's nullable-FK form — nullable target columns, a CHECK that exactly one is
 * set, and one PARTIAL unique index per target — keeps referential integrity AND is what the ROADMAP
 * Phase 4 note specifies. The same sentence is repeated in `*_feed_counters.sql` so a future
 * reviewer does not "fix" this back into a polymorphic pair. What §(e).1 actually forbids — a
 * separate like table per content type — is still forbidden here: one behaviour, ONE table.
 *
 * **The partial unique indexes are the IDEMPOTENCY ARBITER, not application code.** A like is
 * `insert … on conflict … do nothing`: a double-tap (or a retried request, or five concurrent
 * requests) inserts zero extra rows, fires no trigger and changes no counter, because the index
 * decides — there is no read-then-write window to lose. A repeat like therefore answers 200 with
 * the CURRENT state and must NEVER answer 409; a 409 would surface as an error toast on every
 * double-tap gesture.
 *
 * `kind` exists so V2's emoji reactions (V2-CONT-06) are new VALUES in this column rather than a
 * new table. `story_id` is the Phase 5 slot, FK included then.
 */
export const feedLikes = pgTable(
  'feed_likes',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id').references(() => feedPosts.id, { onDelete: 'cascade' }),
    commentId: uuid('comment_id').references(() => feedComments.id, { onDelete: 'cascade' }),
    /** Reserved for Phase 5. No FK yet — `stories` does not exist. */
    storyId: uuid('story_id'),
    /** V2-CONT-06: emoji reactions are new values here, never a new table. */
    kind: text().notNull().default('like'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('feed_likes_target_chk', sql`num_nonnulls(post_id, comment_id, story_id) = 1`),
    // One per target, PARTIAL: a NULL target column would otherwise make every row distinct under a
    // plain unique index (NULLs never conflict), so the constraint would enforce nothing.
    uniqueIndex('feed_likes_post_uq').on(t.userId, t.postId).where(sql`post_id is not null`),
    uniqueIndex('feed_likes_comment_uq')
      .on(t.userId, t.commentId)
      .where(sql`comment_id is not null`),
    uniqueIndex('feed_likes_story_uq').on(t.userId, t.storyId).where(sql`story_id is not null`),
    index('feed_likes_tenant_post_idx').on(t.tenantId, t.postId),
    tenantIsolationPolicy('feed_likes_tenant_isolation'),
  ],
).enableRLS();

/**
 * The per-tenant link-preview cache (MEDIA-04, T-04-34).
 *
 * **`unique (tenant_id, url_hash)` IS THE PRIVACY BOUNDARY, not a performance detail.** A global
 * cache keyed on the URL alone would be cheaper and would leak: any tenant could probe whether a
 * given link had already been resolved and learn what another organisation had shared. The key is
 * scoped to the tenant, so the same article posted in two communities is two rows and two fetches —
 * that is the price of the isolation the product's core value rests on. `pgTAP` asserts BOTH
 * directions: a second insert of the same hash in ONE tenant collides (23505), and the same hash in
 * two tenants inserts twice.
 *
 * The same uniqueness is also the "no second outbound fetch" mechanism: `createPost` does
 * `insert … on conflict (tenant_id, url_hash) do nothing`, and only a NEWLY created row enqueues an
 * unfurl job. A cache hit reuses the resolved row and issues no request at all.
 *
 * `image_asset_id` is a SLOT, deliberately left null in V1 — see `server/unfurl/job.ts`. Copying a
 * remote thumbnail into Storage is the work that would fill it; until then the card renders
 * body-only rather than hot-linking a remote host into a tenant's branded page.
 *
 * `status` is the whole rendering contract (UI-D-11): the card draws ONLY on `'resolved'`. A
 * `'pending'` or `'failed'` row renders as the bare auto-linked URL already in the caption, because
 * a skeleton that may never resolve is indistinguishable from a broken one.
 */
export const feedLinkPreviews = pgTable(
  'feed_link_previews',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** sha256 of the NORMALISED url (`server/unfurl/guard.ts`), so two spellings share one row. */
    urlHash: text('url_hash').notNull(),
    url: text().notNull(),
    /** 'pending' | 'resolved' | 'failed' — see `feed_link_previews_status_chk`. */
    status: text().notNull().default('pending'),
    title: text(),
    description: text(),
    siteName: text('site_name'),
    /** 'youtube' | 'vimeo' when the target resolved through oEmbed; null for an ordinary OG page. */
    provider: text(),
    providerVideoId: text('provider_video_id'),
    /** The V1 null slot — see the docblock. */
    imageAssetId: uuid('image_asset_id').references(() => mediaAssets.id),
    /** A MACHINE code ('blocked' | 'timeout' | 'unreachable' | 'no_metadata'), never a message. */
    failureReason: text('failure_reason'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('feed_link_previews_tenant_url_uq').on(t.tenantId, t.urlHash),
    check('feed_link_previews_status_chk', sql`${t.status} in ('pending','resolved','failed')`),
    tenantIsolationPolicy('feed_link_previews_tenant_isolation'),
  ],
).enableRLS();
