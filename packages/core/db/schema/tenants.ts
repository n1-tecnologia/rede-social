// The jsonb shape is owned by the contract (D-25 fixed keys); `$type` only — no SQL change.
import type { TenantBranding } from '@tria/contracts';
import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

export const tenants = pgTable(
  'tenants',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    displayName: text('display_name').notNull(),
    branding: jsonb().$type<TenantBranding>().notNull().default({}),
    // D-03: community rules live on the tenant, versioned so consent records point at a text version.
    rulesText: text('rules_text').notNull().default(''),
    rulesVersion: integer('rules_version').notNull().default(1),
    plan: text().notNull().default('pilot'),
    status: text().notNull().default('active'),
    timezone: text().notNull().default('America/Sao_Paulo'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenants_slug_chk', sql`${t.slug} ~ '^[a-z0-9-]{3,40}$'`),
    check('tenants_status_chk', sql`${t.status} in ('active','suspended')`),
    // A member may read only their own tenant row; writes happen through the admin lane.
    pgPolicy('tenants_self_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`id = app.tenant_id()`,
    }),
  ],
).enableRLS();
