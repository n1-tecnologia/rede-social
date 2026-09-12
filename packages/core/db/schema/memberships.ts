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
  },
  (t) => [
    uniqueIndex('memberships_tenant_user_uq').on(t.tenantId, t.userId),
    // V1 rule: one tenant per user. Dropping this index is the V2 multi-tenancy migration (ROLE-02).
    uniqueIndex('memberships_one_tenant_per_user_v1').on(t.userId),
    index('memberships_tenant_role_idx').on(t.tenantId, t.role),
    check('memberships_role_chk', sql`${t.role} in ('admin_tenant','support_tenant','member')`),
    check('memberships_status_chk', sql`${t.status} in ('active','blocked','invited')`),
    pgPolicy('memberships_tenant_isolation', {
      for: 'all',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id()`,
      withCheck: sql`tenant_id = app.tenant_id()`,
    }),
  ],
).enableRLS();
