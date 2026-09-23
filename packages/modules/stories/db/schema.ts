import { tenantIsolationPolicy } from '@tria/core/db/rls';
import { mediaAssets, tenants, users } from '@tria/core/db/schema';
import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * The stories module's one table (STORY-01, STORY-03) — the tenant's 24 h broadcast.
 *
 * FOUR THINGS A REVIEWER MUST NOT "FIX":
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
