import { memberships, tenants, users } from '@rede-social/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The dashboard's two snapshot tables (08.7-01, D-462, D-464, INSIGHT-15). Both panels read a STORED
 * snapshot, never a computation on open: the worker builds one per tenant per tenant-local day
 * (`dashboard.snapshot-build` → `app.dashboard_build_snapshot(p_day)`), after local midnight, over
 * windows that end at the end of that day, so today never counts.
 *
 * **Written only by the definer.** Neither table has an insert, update or delete policy: every lane
 * write matches no policy (an insert raises 42501, an update or delete touches 0 rows). Only the
 * owner-run builder, behind its zero-user guard, writes them.
 *
 * **Ids and numbers only (PR-1).** No member name, caption, comment body or support message is ever
 * stored here: labels are joined live at read time, so a rename, a block or a deletion takes effect
 * at once and nothing of a member's identity lingers in the tenant's history.
 *
 * Every column the phase needs is created here, so the later area plans add FUNCTIONS (and bump the
 * builder's payload version), never columns (planning decision 1).
 */

/**
 * One row per tenant per local day (`snapshot_day` = D). `payload` is keyed by area (`overview`,
 * later `members`, `content`, `events`, `finance`, `support`); an area key that is missing or fails
 * its contract answers `preparing` (UI-D-469). `payload_version` is the builder's shape version: a
 * bump makes the next dispatch rebuild every tenant. Readable by the tenant's `admin_tenant` claim
 * only (D-462): `support_tenant` and members see no row, even if a route forgot `requireRole`.
 */
export const dashboardSnapshots = pgTable(
  'dashboard_snapshots',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    snapshotDay: date('snapshot_day').notNull(),
    payloadVersion: integer('payload_version').notNull(),
    builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
    windows: jsonb().notNull(),
    payload: jsonb().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.snapshotDay] }),
    pgPolicy('dashboard_snapshots_select_admin', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`,
    }),
  ],
).enableRLS();

/**
 * One row per member per tenant, the LATEST build only (overwritten nightly): the member's band and
 * its history, the insight numbers and the member's own "Sua atividade" numbers. Keyed by
 * `(tenant_id, membership_id)`, never by `user_id` alone: a shared identity (08.1) has one row per
 * tenant and its activity in one tenant never counts in the other (R-Pitfall 1). Readable by the
 * member's own claim and by the tenant's `admin_tenant` (D-462, D-463).
 */
export const dashboardMemberSnapshots = pgTable(
  'dashboard_member_snapshots',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    snapshotDay: date('snapshot_day').notNull(),
    builtAt: timestamp('built_at', { withTimezone: true }).notNull().defaultNow(),
    band: text().notNull(),
    bandD30: text('band_d30'),
    bandD60: text('band_d60'),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    activeDays30: integer('active_days_30').notNull().default(0),
    strong30: integer('strong_30').notNull().default(0),
    topCommunityId: uuid('top_community_id'),
    hasPush: boolean('has_push').notNull().default(false),
    communityBands: jsonb('community_bands').notNull().default(sql`'{}'::jsonb`),
    insights: jsonb().notNull().default(sql`'{}'::jsonb`),
    activity: jsonb(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.membershipId] }),
    // The member's own row (D-463): tenant first (pgTAP 040).
    index('dashboard_member_snapshots_tenant_user_idx').on(t.tenantId, t.userId),
    // A band's members, most recently active first (the owner's band lists).
    index('dashboard_member_snapshots_tenant_band_idx').on(t.tenantId, t.band, t.lastActiveAt),
    check(
      'dashboard_member_snapshots_band_chk',
      sql`${t.band} in ('new','superfan','engaged','occasional','at_risk','inactive') and (${t.bandD30} is null or ${t.bandD30} in ('new','superfan','engaged','occasional','at_risk','inactive')) and (${t.bandD60} is null or ${t.bandD60} in ('new','superfan','engaged','occasional','at_risk','inactive'))`,
    ),
    pgPolicy('dashboard_member_snapshots_select_own_or_admin', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and (user_id = app.user_id() or app.tenant_role() = 'admin_tenant')`,
    }),
  ],
).enableRLS();
