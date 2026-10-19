import { tenants, users } from '@rede-social/core/db/schema';
import { SOCIAL_ENABLED } from '@rede-social/core/db/social-gate';
import { sql } from 'drizzle-orm';
import { check, index, pgPolicy, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The follow graph (09-02, FOLLOW-01..04, SOCIAL-10; D-467, D-468, D-484): one row per
 * `(tenant, follower, followee)`. Following is one-directional, instant and needs no approval.
 *
 * FOUR THINGS A REVIEWER MUST NOT "FIX":
 *
 * 1. **There is NO `tenantIsolationPolicy` on this table, on purpose (D-468).** A tenant-wide select
 *    would let every member read every follow, and "counts are public, lists are private" would be
 *    true only in the API. The select policy shows a lane only the rows it is a PARTY to (follower
 *    or followee). The counts of OTHER members come from the tenant-pinned definer
 *    `app.social_counts(membership)`, which returns two integers and never a row or a name.
 * 2. **The insert policy re-checks the world in the same statement**: `member` role, `social`
 *    enabled (a SQL read of `tenant_modules` through the kernel seam, never the 30-second flags
 *    cache), follower = the lane's user, and a LIVE member followee of this tenant. The service
 *    refuses first (400 or the bare 404); this is the structural backstop for a request that passed
 *    the guard just before the target was blocked or `social` was turned off (EP-35).
 * 3. **No update policy, and UPDATE and TRUNCATE are revoked from `authenticated`** (in
 *    `*_social_functions.sql`): a follow is inserted or deleted, never edited, and TRUNCATE is not
 *    seen by RLS at all (the `store_orders` precedent).
 * 4. **The two `created_at desc, id desc` indexes are the two list orders** (`Seguidores` newest
 *    first, `Seguindo` newest first), each with `tenant_id` first (pgTAP 040). The unique index is the
 *    `on conflict` arbiter of the idempotent PUT and also serves "who do I follow".
 *
 * A blocked or removed party does not delete anything: the rows stay and every read filters
 * liveness, so unblocking restores the follow rows, followers included (D-484).
 *
 * Owned by `packages/modules/social` and picked up by `apps/api/drizzle.config.ts`'s module glob.
 */
export const socialFollows = pgTable(
  'social_follows',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    followerUserId: uuid('follower_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeUserId: uuid('followee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotency arbiter (`on conflict (tenant_id, follower_user_id, followee_user_id) do nothing`).
    uniqueIndex('social_follows_tenant_pair_uq').on(t.tenantId, t.followerUserId, t.followeeUserId),
    // "Seguidores": a followee's followers, newest first. Also the follower count.
    index('social_follows_tenant_followee_created_idx').on(
      t.tenantId,
      t.followeeUserId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // "Seguindo": a follower's followees, newest first. Also the following count.
    index('social_follows_tenant_follower_created_idx').on(
      t.tenantId,
      t.followerUserId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    check('social_follows_no_self_chk', sql`${t.followerUserId} <> ${t.followeeUserId}`),
    pgPolicy('social_follows_select_own', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and (follower_user_id = app.user_id() or followee_user_id = app.user_id())`,
    }),
    pgPolicy('social_follows_insert_member', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`tenant_id = app.tenant_id()
        and follower_user_id = app.user_id()
        and app.tenant_role() = 'member'
        and ${SOCIAL_ENABLED}
        and exists (
          select 1 from public.memberships m
           where m.tenant_id = social_follows.tenant_id
             and m.user_id = social_follows.followee_user_id
             and m.role = 'member' and m.status = 'active'
             and m.blocked_at is null and m.deleted_at is null)`,
    }),
    pgPolicy('social_follows_delete_own', {
      for: 'delete',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and follower_user_id = app.user_id()`,
    }),
    // No update policy: a follow is inserted or deleted (header, fact 3).
  ],
).enableRLS();
