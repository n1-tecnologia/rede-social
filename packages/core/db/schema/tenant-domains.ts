import type { DnsRecord } from '@rede-social/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { citext } from './citext';
import { tenants } from './tenants';

/**
 * D-20: every tenant is reached on its own custom domain. Hosts are stored lower-case; a tenant may own
 * several hosts (aliases) but exactly one primary. Writes happen only through the admin lane.
 *
 * D-34/D-36 verification lifecycle: `verification_status` drives the panel (pending → verified |
 * expired | failed) and `verified_at` stays the resolution predicate the host resolver reads —
 * a host answers only once `verified_at` is set. `dns_records` holds the instructions to show,
 * `last_checked_at`/`last_error` the last provider answer, `verify_deadline_at` (attach + 7 days)
 * when the `domain-verify` job stops re-enqueueing itself and marks the host `expired`.
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
    verificationStatus: text('verification_status').notNull().default('pending'),
    dnsRecords: jsonb('dns_records').$type<DnsRecord[]>().notNull().default([]),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    verifyDeadlineAt: timestamp('verify_deadline_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('tenant_domains_host_chk', sql`${t.host}::text ~ '^[a-z0-9.-]{1,253}$'`),
    check(
      'tenant_domains_verification_status_chk',
      sql`${t.verificationStatus} in ('pending','verified','expired','failed')`,
    ),
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
