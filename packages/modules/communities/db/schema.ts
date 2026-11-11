import { tenantIsolationPolicy } from '@rede-social/core/db/rls';
import { mediaAssets, tenants, users } from '@rede-social/core/db/schema';
import { SOCIAL_ENABLED } from '@rede-social/core/db/social-gate';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The `position` every MEMBER community carries (10-03, D-706, assumption A1; RESEARCH Pitfall 3): a fixed
 * sentinel far above anything the admin's reorder writes (`1..n` with `n <= COMMUNITY_MAX_ORDER = 200`), so
 * the Comunidades list and the Reels lanes, which order by `position asc, last_activity_at desc, id desc`,
 * put member communities after the organization's with no change to the statement, its index or its keyset
 * cursor. `communities_member_position_chk` makes it a fact of the database: a member row with any other
 * position is refused, and an organization row keeps any non-negative position.
 */
export const COMMUNITY_MEMBER_POSITION = 1000000;

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
    /**
     * The admin's order on the Comunidades list (2026-10-03), ascending, ties by the last activity.
     * Every row starts at 0, so the list reads exactly as before until an admin reorders it; the
     * reorder writes 1..n, so a community created afterwards (0) is listed first.
     */
    position: integer().notNull().default(0),
    /**
     * Whose community this is (10-03, D-706, D-707): `'organization'` (the default, which backfills every
     * row that existed before Phase 10) or `'member'` (created by a member, who owns it). STAMPED at creation
     * from the creator's role and never derived at read time, so a later promotion or demotion of the creator
     * never moves a community between kinds. Never in a request body: the service writes it from the session
     * and `communities_kind_insert_gate` re-states it in SQL.
     */
    kind: text().notNull().default('organization'),
    /** Trigger-owned (05-03). Application code never writes these two. */
    postCount: integer('post_count').notNull().default(0),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // D-76's list query verbatim until 2026-10-03, tie-breaker included, so `(last_activity_at, id)`
    // is a TOTAL order the index carries: a page boundary can neither duplicate nor skip a row, even
    // while somebody else is publishing. Since the admin's order (`position`) the list and the Reels
    // lanes ride `communities_tenant_position_idx` below; this index stays until a migration drops it.
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
    // The list's order since 2026-10-03: the admin's position first, then the activity order above
    // as the tie-breaker, so `(position, last_activity_at, id)` is again a TOTAL order.
    index('communities_tenant_position_idx')
      .on(t.tenantId, t.position, t.lastActivityAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`status = 'active' and deleted_at is null`),
    // Two communities may share a display NAME (a repeat create is not a conflict); they may never
    // share a slug inside one tenant, which is what makes the URL segment stable. `createCommunity`
    // reads a unique violation here as "try the next suffix", never as a 409.
    uniqueIndex('communities_tenant_slug_uq').on(t.tenantId, t.slug),
    check('communities_status_chk', sql`${t.status} in ('active','archived')`),
    check('communities_kind_chk', sql`${t.kind} in ('organization','member')`),
    // D-706 / A1 / EP-04: the sentinel is the EXACT integer, so a member row with 0, 999999 or 1000001 is
    // refused (23514) while an organization row keeps any position the admin's order gives it.
    check(
      'communities_member_position_chk',
      sql`${t.kind} = 'organization' or ${t.position} = 1000000`,
    ),
    // "this member's communities" and the per-member creation limit (plan 05) without a sequential scan;
    // partial, because organization communities have no member creator to look up.
    index('communities_tenant_creator_idx')
      .on(t.tenantId, t.createdByUserId)
      .where(sql`kind = 'member' and deleted_at is null`),
    tenantIsolationPolicy('communities_tenant_isolation'),
    // ── 10-03 (MCOMM-01, MPUB-04, D-706, D-707, D-708; T-10-04, T-10-05, T-10-07): the creator rule. FOUR
    // RESTRICTIVE policies, so each ANDs with `communities_tenant_isolation` whatever the creation order and
    // can only NARROW it (a permissive one would OR with it and widen access; pgTAP 230 asserts
    // `permissive = 'RESTRICTIVE'` for each name). A null `app.tenant_role()` or `app.user_id()` makes every
    // predicate null, which denies: they fail closed (the 09-14 posture).
    //
    // INSERT: a `member` lane may insert ONLY a `'member'` community, in its OWN name, at the sentinel
    // position, while `social` is on (a SQL read of `app.social_enabled()`, never the 30-second flags cache:
    // turning `social` off stops new member communities at once). Every other lane may insert ONLY an
    // `'organization'` community, so a member-created community can never be the organization's voice and an
    // admin cannot mint one in a member's name.
    pgPolicy('communities_kind_insert_gate', {
      as: 'restrictive',
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`(app.tenant_role() = 'member' and kind = 'member' and created_by_user_id = app.user_id() and position = 1000000 and ${SOCIAL_ENABLED}) or (app.tenant_role() <> 'member' and kind = 'organization')`,
    }),
    // UPDATE: a `member` lane updates only the rows it created and may not change `kind` or the creator
    // (WITH CHECK). Every other lane is untouched. DELIBERATELY NO `social_enabled()` TERM (assumption A11):
    // `app.community_post_stats()` (the post counter) is NOT a definer, it updates `communities` as the
    // INVOKER, and an UPDATE whose USING does not match is FILTERED silently, so a tighter policy would let
    // `post_count` drift without an error and one carrying `social_enabled()` would block the counter while
    // `social` is off. The service and the composed permission stop a member EDIT while `social` is off; the
    // 30-second flags-cache window is the accepted residual for an edit (inserts are gated in SQL above).
    // The predicates are written ROLE-FIRST (`tenant_role() = 'member' and ... or tenant_role() <> 'member'`)
    // rather than as `tenant_role() <> 'member' or created_by_user_id = app.user_id()`: with a NULL role the
    // second form is `null or <creator test>`, which is TRUE for the creator and would let a lane with no role
    // claim update. The role-first form is null for a null role and denies (EP-46, fail closed).
    pgPolicy('communities_member_update_gate', {
      as: 'restrictive',
      for: 'update',
      to: authenticatedRole,
      using: sql`(app.tenant_role() = 'member' and created_by_user_id = app.user_id()) or app.tenant_role() <> 'member'`,
      withCheck: sql`(app.tenant_role() = 'member' and kind = 'member' and created_by_user_id = app.user_id()) or app.tenant_role() <> 'member'`,
    }),
    // DELETE: a member never hard-deletes a community; the service soft-deletes (`deleted_at`).
    pgPolicy('communities_member_delete_gate', {
      as: 'restrictive',
      for: 'delete',
      to: authenticatedRole,
      using: sql`app.tenant_role() <> 'member'`,
    }),
    // SELECT (D-708): a member community whose creator has no live membership (blocked, removed or not
    // active) leaves EVERY read, the moderator's included, and comes back when the creator does. The ids come
    // from the definer `app.member_community_hidden_ids()` (`*_member_communities_functions.sql`), read once
    // per statement as an InitPlan (`coalesce((select ...), '{}'::uuid[])`, never `<> all (subquery)`). No
    // row is touched. An organization community passes whatever its creator's state.
    pgPolicy('communities_member_hidden_gate', {
      as: 'restrictive',
      for: 'select',
      to: authenticatedRole,
      using: sql`kind = 'organization' or id <> all (coalesce((select app.member_community_hidden_ids()), '{}'::uuid[]))`,
    }),
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
