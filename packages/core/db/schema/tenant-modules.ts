import { TOGGLEABLE_MODULES } from '@tria/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';

/** `in ('feed','communities',…)` built from the ONE list of keys, so the CHECK can never drift (D-16). */
const moduleKeyList = sql.raw(TOGGLEABLE_MODULES.map((key) => `'${key}'`).join(','));

/**
 * D-16 / SCHEMA-CONVENTIONS (f): module toggles are ROWS, never boolean columns on `tenants` —
 * enabling a module is an insert, not a migration. `settings` holds per-module knobs
 * (e.g. `stories.ttlHours`) so no module ever adds a column to `tenants`.
 *
 * A MISSING row and `enabled = false` mean the same thing (`requireModule` answers 404 in both
 * cases): only `enabled = true` enables. Members may READ their tenant's flags (the bootstrap call
 * runs in the tenant lane); every write goes through the admin lane, so there is no `for: 'all'`
 * policy here — a tenant admin flipping a flag is a Phase 2 platform/admin route.
 */
export const tenantModules = pgTable(
  'tenant_modules',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    moduleKey: text('module_key').notNull(),
    enabled: boolean().notNull().default(false),
    settings: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.moduleKey] }),
    check('tenant_modules_key_chk', sql`${t.moduleKey} in (${moduleKeyList})`),
    // Read-only for members: the flags decide what the shell renders, never what it may write.
    pgPolicy('tenant_modules_tenant_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id()`,
    }),
  ],
).enableRLS();
