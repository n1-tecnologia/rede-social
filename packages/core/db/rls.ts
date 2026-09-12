import { sql } from 'drizzle-orm';
import { pgPolicy } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/** Standard isolation policy for tables that carry `tenant_id`: rows visible/writable only inside the tenant lane. */
export const tenantIsolationPolicy = (name: string) =>
  pgPolicy(name, {
    for: 'all',
    to: authenticatedRole,
    using: sql`tenant_id = app.tenant_id()`,
    withCheck: sql`tenant_id = app.tenant_id()`,
  });
