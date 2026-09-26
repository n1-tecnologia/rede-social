import { tenantIsolationPolicy } from '@tria/core/db/rls';
import { mediaAssets, tenants, users } from '@tria/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * The stories module's two tables (STORY-01, STORY-03, STORY-04) — the tenant's 24 h broadcast and
 * the join that lets an editorial act outlive it.
 *
 * SIX THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **`expires_at` is a plain column with a VOLATILE DEFAULT, not a generated column.** The obvious
 *    "improvement" — `generated always as (published_at + interval '24 hours') stored` — is refused
 *    by Postgres outright: `timestamptz + interval` is STABLE rather than IMMUTABLE, and a
 *    generation expression must be immutable (`ERROR: generation expression is not immutable`,
 *    reproduced on this project's Postgres 17.6). A column DEFAULT may be volatile, and `now()` is
 *    the TRANSACTION timestamp, so `published_at` and `expires_at` are derived from the same instant
 *    without either being computed from the other. `stories_expiry_window_chk` then stops a
 *    hand-written row inverting the window, which is the invariant the generated column would have
 *    given for free.
 *
 * 2. **Every read ORDERS BY the column it RANGES ON.** The strip is
 *    `where expires_at > now() … order by expires_at desc, id desc`, never `order by published_at`.
 *    With a fixed 24 h window the two orderings mean exactly the same thing, so this costs nothing —
 *    but it is the difference between an INDEX-ONLY SCAN on `stories_tenant_expires_idx` and a
 *    `Sort -> Bitmap Heap Scan` (both plans measured on a 5,000-row fixture). The SAME index serves
 *    D-84's admin history, which simply drops the range predicate; `110-communities-stories.sql`
 *    pins both with an `EXPLAIN` assertion.
 *
 * 3. **`like_count` and `comment_count` are TRIGGER-OWNED** (05-07 installs the functions, mirroring
 *    `app.feed_like_count()`). NO application statement may increment or set them — a service that
 *    does will drift from the rows it is supposed to summarise, and there is deliberately no
 *    `greatest(0, …)` clamp anywhere so a pgTAP reconciliation assertion can SURFACE drift instead
 *    of hiding it. Until 05-07 lands both columns carry their insert-time default of `0`, which is
 *    the correct answer for a story nobody has touched.
 *
 * 4. **There is NO SCHEDULED JOB of any kind, and adding one would break STORY-03.** Expiry is a
 *    read predicate: no sweeper, no cron entry, no status transition, no cascade. A story leaves the
 *    strip because `now()` moved, and the ROW IS RETAINED FOREVER — which is what makes the admin's
 *    history screen (D-84) and highlights (05.2) possible with no extra state, and what stops a member's
 *    comment vanishing because a clock passed.
 *
 * 5. **REMOVING A STORY FROM A HIGHLIGHT IS A HARD DELETE, and this is deliberate.** It is the one
 *    place this module departs from the soft-delete convention, so say it here rather than let a
 *    reviewer "fix" it: a `story_highlight_items` row carries NO AUTHORED CONTENT and NO MODERATION
 *    EVIDENCE — it is a pair of ids, a curator and a timestamp recording an editorial act. Its unique
 *    (highlight, story) pair is the idempotency arbiter, so a repeat add is absorbed and a removal has
 *    at most one row to remove; a soft-deleted item would need an extra `deleted_at is null`
 *    predicate threaded through every join that reads it. Deleting a highlight deletes its row, and
 *    its items go with it through `on delete cascade`. `story.unhighlighted` / `highlight.deleted`
 *    are the record that it happened. The STORY row is never touched by either — a highlight is an
 *    editorial pointer, not a copy. (Phase 5's community pin carried the same rule; the pin model
 *    retired in 05.2, D-116.)
 *
 * 6. **THE ITEM ROW IS THE EXPIRY OVERRIDE.** A story in a highlight is playable from it for every
 *    value of `now()`: the highlight items read (`getHighlight`) carries NO expiry predicate — only
 *    `s.deleted_at is null` — and that ABSENCE is the mechanism, not an oversight;
 *    `120-story-highlights.sql` asserts it under a controlled clock beside the strip predicate
 *    refusing the same row. There is deliberately no column on `stories` recording that it is kept:
 *    one story may sit in several highlights (D-100), which a boolean cannot represent, and a
 *    denormalised count would be a second writer of a fact the join already holds. An item is a
 *    story's membership in a NAMED highlight that belongs to exactly one PLACE (Início, or one
 *    community).
 *
 * **Highlights replaced pins (05.2, D-116).** `story_highlights` / `story_highlight_items` generalise
 * Phase 5's per-community pin: migration file 1 (`*_story_highlights.sql`) copied every pin into a
 * `Destaques` highlight of its own community under a no-loss guard, and migration file 2
 * (`*_drop_story_community_pins.sql`) dropped the pin table once its routes and events were gone
 * (05.2-11). One representation of a curated story remains.
 *
 * Authorship is the generic `author_user_id -> users.id` (SCHEMA-CONVENTIONS §(c).1), so V2 member
 * stories are rows rather than a migration.
 *
 * `deleted_at` stays OUT of the RLS policy (the `feed_posts` rule, Pitfall 9): Phase 8's MODER-01
 * must see removed rows through the tenant lane, so `deleted_at is null` lives in every read query
 * instead. A read that forgets it shows deleted content and does NOT fail a test that only checks
 * tenant isolation.
 *
 * Owned by `packages/modules/stories` and picked up by `apps/api/drizzle.config.ts`'s
 * `packages/modules/*​/db/schema.ts` glob.
 */
export const stories = pgTable(
  'stories',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Generic authorship (SCHEMA-CONVENTIONS §(c).1, FEED-08). V1 writes the admin; V2 writes anyone. */
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    /** NOT NULL: a story with no media has nothing to show. That is a feed post, not a story. */
    mediaAssetId: uuid('media_asset_id')
      .notNull()
      .references(() => mediaAssets.id),
    /** `'image' | 'video'` — a vocabulary column with a CHECK, never a pile of booleans (§(d).1). */
    mediaKind: text('media_kind').notNull(),
    /** `''` rather than NULL: "no caption" is ONE value, so no renderer branches on two (D-54 text). */
    caption: text().notNull().default(''),
    publishedAt: timestamp('published_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * STORY-03's window, as a DATABASE fact. See point 1 above for why this is a default and not a
     * generated column, and `STORY_EXPIRY_HOURS` in this module's contracts for the same number on
     * the TypeScript side — the two move together or not at all.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
    /** Trigger-owned (05-07). Application code never writes these two. */
    likeCount: integer('like_count').notNull().default(0),
    commentCount: integer('comment_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // The strip's query verbatim, tie-breaker included, so `(expires_at, id)` is a TOTAL order the
    // index carries: a page boundary can neither duplicate nor skip a row, even while somebody else
    // is publishing.
    //
    // `.nullsFirst()` is NOT decoration (04-03's lesson, caught by `090-feed.sql`'s EXPLAIN
    // assertion): drizzle's `.desc()` alone emits `DESC NULLS LAST`, while SQL's `order by x desc`
    // means `desc NULLS FIRST`. The two do not match, so the planner cannot use the index to DELIVER
    // the ordering and falls back to a full sort. Both key columns are NOT NULL, so this changes no
    // result — only whether the index is usable at all.
    //
    // The predicate is only `deleted_at is null` and must stay that way: `expires_at > now()` is
    // VOLATILE and cannot appear in a partial index at all, and putting it there would also break
    // the admin history, which reads the same structure with the range dropped.
    index('stories_tenant_expires_idx')
      .on(t.tenantId, t.expiresAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`deleted_at is null`),
    check('stories_media_kind_chk', sql`${t.mediaKind} in ('image','video')`),
    // The invariant the generated column would have given for free — a hand-written row (a seed, a
    // migration, a psql session) cannot invert the window or publish a story already expired.
    check('stories_expiry_window_chk', sql`${t.expiresAt} > ${t.publishedAt}`),
    tenantIsolationPolicy('stories_tenant_isolation'),
  ],
).enableRLS();

/**
 * STORY-04's join: which stories a community keeps as its Destaques, one row per (story, community)
 * pair. **The pin ROW IS the expiry override** — see item 6 of the docblock above.
 *
 * The pair is a set of INDEPENDENT FACTS, which is why this is a join table and not a column: the
 * requirement says "one or more communities", and no boolean or timestamp on `stories` could
 * represent that without duplicating the join anyway.
 *
 * **`community_id` carries no drizzle `.references()`, and that is not an omission.** The
 * communities table lives in `@tria/module-communities/db`, and reaching it from here would be the
 * `module -> module` package edge `turbo boundaries` denies (MOD-02). The foreign key is REAL and is
 * declared as hand-written SQL inside this table's migration, exactly as `feed_comments_story_fk`
 * and `feed_likes_story_fk` were in `*_stories.sql`. The constraint is what `020-tenant-isolation.sql`
 * and `110-communities-stories.sql` assert; the missing TypeScript reference costs nothing but the
 * convenience of a typed join, which this module never performs.
 */
export const storyCommunityPins = pgTable(
  'story_community_pins',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    /** -> `public.communities.id` on delete cascade, declared in SQL. See the docblock above. */
    communityId: uuid('community_id').notNull(),
    /** Who performed the editorial act. Phase 8 reads it; no member-facing surface does. */
    pinnedByUserId: uuid('pinned_by_user_id')
      .notNull()
      .references(() => users.id),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // THE IDEMPOTENCY ARBITER. `on conflict … do nothing` against this pair is what makes a repeat
    // pin a no-op rather than a 409, and it is also why unpin can be a plain delete: there is at
    // most one row to remove, so "remove the pin" needs no disambiguation.
    uniqueIndex('story_community_pins_uq').on(t.storyId, t.communityId),
    // The Destaques read's ordering, verbatim, tie-breaker included — `(pinned_at, id)` is a TOTAL
    // order the index carries, so a page boundary can neither duplicate nor skip a row.
    //
    // `.nullsFirst()` is NOT decoration (04-03's lesson): drizzle's `.desc()` alone emits
    // `DESC NULLS LAST`, while SQL's `order by x desc` means `desc NULLS FIRST`, and the mismatch
    // stops the planner using the index to DELIVER the ordering. Both key columns are NOT NULL, so
    // this changes no result — only whether the index is usable at all.
    index('story_community_pins_tenant_community_idx').on(
      t.tenantId,
      t.communityId,
      t.pinnedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    tenantIsolationPolicy('story_community_pins_tenant_isolation'),
  ],
).enableRLS();

/**
 * A NAMED HIGHLIGHT (HIGHLIGHT-01/02, D-100..D-103) — a curated, titled circle that belongs to exactly
 * one PLACE and outlives the 24 h window of every story in it.
 *
 * **The place is `community_id`, and NULL means Início** (R-D-A). There is no `place_kind` column:
 * two places exist, and V2's creator-scoped publishing (Phase 10) extends the service's one
 * `resolveHighlightPlace` seam, not this shape.
 *
 * **`community_id` carries no drizzle `.references()`, and that is not an omission** — the pins'
 * reason restated: `public.communities` lives in `@tria/module-communities/db`, and reaching it from
 * here is the `module -> module` package edge `turbo boundaries` denies (MOD-02). The foreign key is
 * REAL: `story_highlights_community_fk` (`on delete cascade`) is hand-written SQL in the table's own
 * migration, and `120-story-highlights.sql` asserts it with a 23503 and a positive control.
 *
 * - `title` is required, trimmed and 1..15 characters (`STORY_HIGHLIGHT_MAX_TITLE`); duplicates are
 *   allowed inside a place (ids disambiguate). `story_highlights_title_chk` is the backstop.
 * - `position` orders a place's row. There is deliberately NO unique index on it: every read orders
 *   by `(position, id)`, a total order, and a create appends at `max + 1` under a lock on the place's
 *   rows. A unique index would only add transient collisions to a renumber.
 * - The cover is resolved at READ time (R-D-D): `cover_asset_id` (an uploaded image) or
 *   `cover_story_id` (a chosen story), never both (`story_highlights_cover_chk`), else the most
 *   recently added live image item. `on delete set null` on the story reference means a deleted
 *   cover story falls back rather than breaking the row.
 */
export const storyHighlights = pgTable(
  'story_highlights',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** NULL = Início. -> `public.communities.id` on delete cascade, declared in SQL (MOD-02). */
    communityId: uuid('community_id'),
    title: text().notNull(),
    position: integer().notNull(),
    coverStoryId: uuid('cover_story_id').references(() => stories.id, { onDelete: 'set null' }),
    coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Tenant first (040's rule), then the place, then the row's own total order — the one index
    // both the row read and the create's place lock walk.
    index('story_highlights_tenant_place_idx').on(t.tenantId, t.communityId, t.position, t.id),
    check(
      'story_highlights_title_chk',
      sql`char_length(${t.title}) between 1 and 15 and ${t.title} = btrim(${t.title})`,
    ),
    check(
      'story_highlights_cover_chk',
      sql`num_nonnulls(${t.coverStoryId}, ${t.coverAssetId}) <= 1`,
    ),
    check('story_highlights_position_chk', sql`${t.position} >= 0`),
    tenantIsolationPolicy('story_highlights_tenant_isolation'),
  ],
).enableRLS();

/**
 * A story's membership in a highlight — the many-to-many join D-100 asks for (one story may sit in
 * several highlights). Items 5 and 6 of the module docblock apply to this row verbatim: a removal is
 * a HARD delete, and the ROW is the expiry override (the items read carries no expiry predicate).
 *
 * There is deliberately NO ordering column here (D-103): a highlight plays its stories by PUBLISH
 * time, oldest first (`order by s.published_at, s.id`), never by when they were added. `added_at` is
 * kept because it is the automatic cover rule's input (the most recently ADDED image item) and the
 * migrated pin's `pinned_at`.
 */
export const storyHighlightItems = pgTable(
  'story_highlight_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    highlightId: uuid('highlight_id')
      .notNull()
      .references(() => storyHighlights.id, { onDelete: 'cascade' }),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    addedByUserId: uuid('added_by_user_id')
      .notNull()
      .references(() => users.id),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // THE IDEMPOTENCY ARBITER, and the by-highlight read's index: `on conflict … do nothing` against
    // this pair is what makes a repeat add a no-op rather than a 409.
    uniqueIndex('story_highlight_items_uq').on(t.highlightId, t.storyId),
    // Tenant first; serves "how many highlights is this story in" and the sheet's initial state.
    index('story_highlight_items_tenant_story_idx').on(t.tenantId, t.storyId),
    tenantIsolationPolicy('story_highlight_items_tenant_isolation'),
  ],
).enableRLS();

/**
 * A member's SEEN state (HIGHLIGHT-06, D-105) — one row per (tenant, user, story), written when the
 * viewer showed that story as its current segment with its media ready (R-D-I). It is what greys the
 * tenant circle's ring and what the circle resumes from, identically on every device the member
 * signs in on. There is deliberately NO device-local copy (D-79's rejection of `localStorage` stands).
 *
 * **PRIVACY — the rule a reviewer must not relax.** This table is behavioural data about members.
 * In 05.2 the API reads ONLY THE CALLER'S OWN rows (`user_id = ctx.userId`, inside the story
 * projection's `viewer_seen` column). No endpoint, event, payload or log line reveals which member
 * saw which story, and no view COUNT exists anywhere. The admin's "quem viu" list is V2 and will be
 * built on this same table, behind its own decision — not by widening a read here.
 *
 * - **A row per view, not a job.** A view is a fact written once by `POST /v1/stories/views`
 *   (`insert … select` from `stories` in the caller's lane, `on conflict do nothing`), batched by the
 *   client. There is no event for a view (R-D-L): views are high-volume reads of state, not
 *   transitions a subscriber acts on, and nothing downstream needs them.
 * - **`story_views_uq (tenant_id, user_id, story_id)` — the order is measured, not cosmetic.** It is
 *   the idempotency arbiter (a repeat or concurrent batch writes one row per pair), it is tenant-first
 *   (040's rule), and it is exactly what the ring's `exists` subplan scans: with a CONSTANT tenant
 *   predicate the planner walks it as an Index Only Scan on `(tenant_id, user_id)` + `story_id`. The
 *   story-first order `(tenant_id, story_id, user_id)` degraded to a hashed Seq Scan on a 50,000-row
 *   fixture; `120-story-highlights.sql` pins the plan with an EXPLAIN assertion.
 * - `story_id` cascades: a story that is hard-deleted takes its views with it. A soft-deleted story
 *   keeps them (nothing reads them), exactly like its likes.
 * - `user_id` does not cascade, like every other authored row here (`users` rows are not deleted).
 */
export const storyViews = pgTable(
  'story_views',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Tenant-first AND the idempotency arbiter AND what the ring's exists-subplan scans (measured).
    uniqueIndex('story_views_uq').on(t.tenantId, t.userId, t.storyId),
    tenantIsolationPolicy('story_views_tenant_isolation'),
  ],
).enableRLS();
