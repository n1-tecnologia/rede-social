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
 *    history screen (D-84) and 05-08's pins possible with no extra state, and what stops a member's
 *    comment vanishing because a clock passed.
 *
 * 5. **UNPIN IS A HARD DELETE, and this is deliberate.** It is the one place Phase 5 departs from
 *    the soft-delete convention, so say it here rather than let a reviewer "fix" it: a pin carries
 *    NO AUTHORED CONTENT and NO MODERATION EVIDENCE — it is a pair of ids and a timestamp recording
 *    an editorial act that has since been undone. The unique pair on `story_community_pins` is the
 *    idempotency arbiter, and a soft-deleted pin would need an extra `deleted_at is null` predicate
 *    threaded through every join that reads it, plus a decision about what re-pinning a
 *    soft-deleted pair means. `story.unpinned` is the record that it happened.
 *
 * 6. **THE PIN ROW IS THE EXPIRY OVERRIDE.** `listCommunityHighlights` carries NO expiry predicate
 *    at all — that ABSENCE is the mechanism, not an oversight, and it is asserted under a clock the
 *    test controls in `110-communities-stories.sql`. There is deliberately no column on `stories`
 *    recording that it is pinned: STORY-04 says "one or more communities", which a boolean cannot
 *    represent, and a denormalised count would be a second writer of a fact the join already holds.
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
