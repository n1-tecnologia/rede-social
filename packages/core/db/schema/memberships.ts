import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';
import { users } from './users';

/** Identity != membership: this row is the tenant-scoping noun every authorization reads. */
export const memberships = pgTable(
  'memberships',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text().notNull().default('member'),
    status: text().notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    blockedAt: timestamp('blocked_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // Phase 13 (NATIVE-19..21, D-609, D-610): "Excluir minha conta". A member's own request REUSES the soft
    // state above (`deleted_at = now()`, so every live-member filter already shipped deactivates the member)
    // and stores the marker that tells it from a moderation soft-delete. All four are nullable, no default.
    // `deletion_cancelled_until` parks the old deadline after a cancel so the notice is read once.
    deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
    deletionDueAt: timestamp('deletion_due_at', { withTimezone: true }),
    anonymisedAt: timestamp('anonymised_at', { withTimezone: true }),
    deletionCancelledUntil: timestamp('deletion_cancelled_until', { withTimezone: true }),
  },
  (t) => [
    // `(tenant_id, user_id)` is the only uniqueness: one membership per tenant per identity, any number of tenants (V2-PLAT-07, 08.1).
    uniqueIndex('memberships_tenant_user_uq').on(t.tenantId, t.userId),
    index('memberships_tenant_role_idx').on(t.tenantId, t.role),
    // 09.1-03: the coarse token hook's ungated-membership clause looks a user up by id alone, which the
    // unique `(tenant_id, user_id)` index above cannot serve (user_id is its second column).
    index('memberships_user_idx').on(t.userId),
    check('memberships_role_chk', sql`${t.role} in ('admin_tenant','support_tenant','member')`),
    check('memberships_status_chk', sql`${t.status} in ('active','blocked','invited')`),
    // Phase 13 (D-610): the request and its deadline travel together, the deadline is after the request,
    // and an anonymised row always carries the request that led to it.
    check(
      'memberships_deletion_chk',
      sql`(${t.deletionRequestedAt} is null) = (${t.deletionDueAt} is null) and (${t.deletionDueAt} is null or ${t.deletionDueAt} > ${t.deletionRequestedAt}) and (${t.anonymisedAt} is null or ${t.deletionRequestedAt} is not null)`,
    ),
    // SELECT-ONLY from the tenant lane, like every other core table (phase-1 review WR-07). This row
    // carries `role` and `status` — the authorization source of truth — so a `FOR ALL` policy would
    // let any request in the lane promote itself (or any member of its tenant) to `admin_tenant`
    // with one UPDATE the day a route forgets to exclude those columns. Membership writes
    // (sign-up, block, role change) happen in the admin lane behind explicit guards. If a tenant-lane
    // write is ever needed, add a NARROW `update` policy whose WITH CHECK pins `role`/`status`, never
    // widen this one. `supabase/tests/020` and `040` assert the shape.
    pgPolicy('memberships_tenant_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id()`,
    }),
  ],
).enableRLS();
