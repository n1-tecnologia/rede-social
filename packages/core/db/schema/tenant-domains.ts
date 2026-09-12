import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  pgPolicy,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';

/** Case-insensitive text (extension created by the `app_helpers` migration). */
const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/**
 * D-20: every tenant is reached on its own custom domain. Hosts are stored lower-case; a tenant may own
 * several hosts (aliases) but exactly one primary. Writes happen only through the admin lane.
 */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    host: citext('host').notNull().unique('tenant_domains_host_key'),
    isPrimary: boolean('is_primary').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenant_domains_host_chk', sql`${t.host}::text ~ '^[a-z0-9.-]{1,253}$'`),
    // Convention (01-08): tenant_id is the first column of every index on a tenant table.
    index('tenant_domains_tenant_idx').on(t.tenantId),
    uniqueIndex('tenant_domains_one_primary_per_tenant').on(t.tenantId).where(sql`${t.isPrimary}`),
    // Members may read their own tenant's hosts; select-only.
    pgPolicy('tenant_domains_tenant_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id()`,
    }),
  ],
).enableRLS();
