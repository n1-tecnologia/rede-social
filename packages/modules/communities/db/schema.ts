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
 * The communities module's two tables (COMM-01, COMM-02, COMM-03) — the tenant's content containers
 * and the born-unused membership join V2 will need.
 *
 * FOUR THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **`last_activity_at` is NOT NULL and is seeded at creation time.** `order by last_activity_at
 *    desc` is `desc NULLS FIRST` in SQL, so a nullable column would float every post-less community
 *    to the TOP of the list — the exact opposite of "most recent activity" (D-76). Seeding it with
 *    `now()` means a brand-new community sorts by when it was created, which is the right answer,
 *    and it keeps the repo's `.desc().nullsFirst()` index idiom usable unchanged. It is also why the
 *    list is keyset-pageable at all: "most recent post activity" as an AGGREGATE
 *    (`max(feed_posts.created_at)`) has no index to ride and would force a group-then-sort of every
 *    community on every page.
 *
 * 2. **`post_count` and `last_activity_at` are TRIGGER-OWNED** (05-03 installs the function on
 *    `feed_posts`, mirroring `app.feed_like_count()`'s posture). NO application statement may
 *    increment or set them — a service that does will drift from the rows it is supposed to
 *    summarise, and there is deliberately no `greatest(0, …)` clamp anywhere so the pgTAP
 *    reconciliation assertion can SURFACE drift instead of hiding it. Until 05-03 lands, both
 *    columns simply carry their insert-time defaults, which is a correct answer for a community with
 *    no posts.
 *
 * 3. **`community_members` is born UNUSED, on purpose.** COMM-02's answer — "every member of the
 *    tenant sees every community" — is a POLICY value, not a column shape: `GET /v1/communities`
 *    never joins this table, so every member receives the identical item set regardless of role. The
 *    table exists now so V2-CONT-02 ("some communities are restricted") is a policy change rather
 *    than a migration, and it therefore gets everything a real table gets — `tenant_id`, the unique
 *    triple, a role CHECK, `.enableRLS()` and `tenantIsolationPolicy(...)`. That is not ceremony:
 *    `010-rls-coverage.sql` is catalogue-driven and fails on a policy-less table the moment it
 *    exists, and "V2 is a policy change" is only true if the policy is already there.
 *
 * 4. **`cover_asset_id` is NULLABLE** (D-69) so an admin can create a community before the art
 *    exists; a cover-less community renders the `--brand-gradient` block, never a broken-image
 *    glyph (UI-D-35). Making it NOT NULL later would need a backfill, so the nullability is the
 *    cheap direction to be wrong in.
 *
 * Authorship is the generic `created_by_user_id -> users.id` (SCHEMA-CONVENTIONS §(c).1). It is
 * STORED and NEVER SURFACED (D-67): the organisation owns the container and every post inside it
 * already shows a face, so `communitySummarySchema` has no owner field to put it in.
 *
 * Owned by `packages/modules/communities` and picked up by `apps/api/drizzle.config.ts`'s
 * `packages/modules/*​/db/schema.ts` glob.
 */
export const communities = pgTable(
  'communities',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Generic authorship (SCHEMA-CONVENTIONS §(c).1). Stored for auditing, never projected (D-67). */
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    /** The per-tenant stable URL segment; unique under `communities_tenant_slug_uq`. */
    slug: text().notNull(),
    /** `''` rather than NULL: "no description" is ONE value, so no renderer branches on two. */
    description: text().notNull().default(''),
    /** NULLABLE — D-69. Null takes the `--brand-gradient` fallback (UI-D-35). */
    coverAssetId: uuid('cover_asset_id').references(() => mediaAssets.id),
    /** `'active' | 'archived'` — a status column with a CHECK, never a pile of booleans (§(d).1). */
    status: text().notNull().default('active'),
    /** Trigger-owned (05-03). Application code never writes these two. */
    postCount: integer('post_count').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // D-76's list query verbatim, tie-breaker included, so `(last_activity_at, id)` is a TOTAL order
    // the index carries: a page boundary can neither duplicate nor skip a row, even while somebody
    // else is publishing.
    //
    // `.nullsFirst()` is NOT decoration (04-03's lesson, caught by `090-feed.sql`'s EXPLAIN
    // assertion): drizzle's `.desc()` alone emits `DESC NULLS LAST`, while SQL's `order by x desc`
    // means `desc NULLS FIRST`. The two do not match, so the planner cannot use the index to DELIVER
    // the ordering and falls back to a full sort of the tenant's communities on every page. Both key
    // columns are NOT NULL, so this changes no result — only whether the index is usable at all.
    //
    // The predicate matches the list's own `where` exactly: V1 reads only active, live rows, and a
    // partial index keeps the archived tail out of the structure the tab pages through.
    index('communities_tenant_activity_idx')
      .on(t.tenantId, t.lastActivityAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`status = 'active' and deleted_at is null`),
    // Two communities may share a display NAME (a repeat create is not a conflict); they may never
    // share a slug inside one tenant, which is what makes the URL segment stable. `createCommunity`
    // reads a unique violation here as "try the next suffix", never as a 409.
    uniqueIndex('communities_tenant_slug_uq').on(t.tenantId, t.slug),
    check('communities_status_chk', sql`${t.status} in ('active','archived')`),
    tenantIsolationPolicy('communities_tenant_isolation'),
  ],
).enableRLS();

/**
 * COMM-02's V2 seam, born unused — see fact 3 in the docblock above.
 *
 * The unique triple is `(tenant_id, community_id, user_id)` rather than `(community_id, user_id)`:
 * `community_id` already implies a tenant, but carrying `tenant_id` in the key is what lets the
 * isolation policy and every future index start tenant-first (the §(j) convention the
 * `040-schema-conventions.sql` gate enumerates).
 */
export const communityMembers = pgTable(
  'community_members',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    /** `'member' | 'moderator'` — a status/role column with a CHECK, never a boolean (§(d).1). */
    role: text().notNull().default('member'),
    status: text().notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('community_members_tenant_community_user_uq').on(
      t.tenantId,
      t.communityId,
      t.userId,
    ),
    check('community_members_role_chk', sql`${t.role} in ('member','moderator')`),
    tenantIsolationPolicy('community_members_tenant_isolation'),
  ],
).enableRLS();
