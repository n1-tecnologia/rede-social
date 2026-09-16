import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { citext } from './citext';
import { tenants } from './tenants';
import { users } from './users';

/**
 * D-30 / ROLE-03: the first-admin invite the platform panel creates with a tenant. `pending` until
 * the tenant has a verified primary host (the invite e-mail needs a branded origin to link to),
 * `sent` once GoTrue's `inviteUserByEmail` went out (`user_id` then points at the mirrored identity
 * and a `memberships` row exists with status `invited`), `accepted` when the admin set a password
 * and gave consent on `/aceitar-convite`, `expired` when the link lapsed and a resend is needed.
 *
 * RLS is enabled with **no policy at all**, deliberately — the same shape as `platform_admins`
 * (01-03). Invites are created, sent and read by the platform lane (`withAdminTx` behind
 * `requireSuperAdmin()`) and the accept flow flips them from the admin lane too; a tenant lane
 * (`authenticated`) has no business seeing who was invited to administer a tenant, and with the
 * schema-wide SELECT grant from 20260912031029 a policy is the only thing that could expose the
 * table (T-02-08). Adding a policy for `authenticated` here, or widening `memberships` policies for
 * the invite flow, is always a bug (SCHEMA-CONVENTIONS (i)); `supabase/tests/010` and `040` pin the
 * zero-policy count and `020` proves a lane reads nothing.
 *
 * `email` is citext and unique per tenant, so `Admin@Cliente.com.br` cannot be invited twice under
 * a different casing (edge ROLE-03/encoding).
 */
export const tenantInvites = pgTable(
  'tenant_invites',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    role: text().notNull().default('admin_tenant'),
    status: text().notNull().default('pending'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenant_invites_role_chk', sql`${t.role} in ('admin_tenant')`),
    check('tenant_invites_status_chk', sql`${t.status} in ('pending','sent','accepted','expired')`),
    // Convention (01-08): tenant_id is the first column of every index on a tenant table.
    index('tenant_invites_tenant_idx').on(t.tenantId),
    uniqueIndex('tenant_invites_tenant_email_key').on(t.tenantId, t.email),
  ],
).enableRLS();
