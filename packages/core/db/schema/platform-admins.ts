import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { users } from './users';

/**
 * ROLE-01: `super_admin` is TRIA's platform role, NOT a tenant role — it never appears in
 * `memberships.role` (whose CHECK allows only `admin_tenant | support_tenant | member`).
 *
 * RLS is enabled with **no policy at all**, deliberately: `authenticated` (the tenant lane) can
 * therefore never see a row, so platform staff are invisible to every tenant (threat T-03-02).
 * The only reader is the admin lane (`withAdminTx`, `service_role`) behind `requireSuperAdmin()`
 * (plan 01-06). Adding a policy for `authenticated` to this table is always a bug.
 */
export const platformAdmins = pgTable('platform_admins', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
