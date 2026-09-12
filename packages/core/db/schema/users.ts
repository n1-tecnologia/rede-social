import { sql } from 'drizzle-orm';
import { pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole, authUsers } from 'drizzle-orm/supabase';

/**
 * Global identity mirrored from `auth.users` by the `on_auth_user_created` trigger.
 * Deliberately has NO `tenant_id`/`role`: tenant scoping lives on `memberships` (ROLE-01/02).
 */
export const users = pgTable(
  'users',
  {
    id: uuid()
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    name: text().notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  () => [
    pgPolicy('users_self_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`id = app.user_id()`,
    }),
  ],
).enableRLS();
