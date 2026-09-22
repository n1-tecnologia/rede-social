import { tenantIsolationPolicy } from '@tria/core/db/rls';
import { tenants, users } from '@tria/core/db/schema';
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
    /** Set on ANY persisted change, media included (FEED-03 / UI-D-15). Renders as "editado". */
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // FEED-02's list query verbatim, tie-breaker included, so `(created_at, id)` is a TOTAL order the
    // index carries: a page boundary can neither duplicate nor skip a row.
    index('feed_posts_tenant_community_created_idx').on(
      t.tenantId,
      t.communityId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    // "this member's posts" (a profile tab, Phase 8 moderation) without a sequential scan.
    index('feed_posts_tenant_author_idx').on(t.tenantId, t.authorUserId),
    check('feed_posts_media_kind_chk', sql`${t.mediaKind} in ('none','gallery','video')`),
    tenantIsolationPolicy('feed_posts_tenant_isolation'),
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
    index('feed_comments_tenant_post_root_idx')
      .on(t.tenantId, t.postId, t.createdAt.desc(), t.id.desc())
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
