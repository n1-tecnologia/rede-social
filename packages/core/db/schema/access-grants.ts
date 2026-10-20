import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

/**
 * Phase 09.1 (D-485, D-487): "may this e-mail enter this tenant?" as a PER-TENANT, PER-E-MAIL
 * record. It is deliberately NOT `store_entitlements` (which is per membership and per product, the
 * second access level of D-485): this is the first level, the door.
 *
 * A row has a `source`: `manual` (an admin released or blocked the e-mail by hand) or `gateway`
 * (a payment-gateway event opened or closed it, one row per subscription or order reference, so
 * several access products per tenant are just several rows, D-494). What an e-mail may do is the
 * precedence of those rows, and that rule exists in exactly ONE place: the SQL function
 * `app.access_effective` (migration `*_access_gate_functions.sql`). No TypeScript re-implements it.
 *
 * ONE e-mail may hold a manual `active` row (a release) AND a manual `blocked` row at once: the
 * partial unique index is on `(tenant_id, email, status)`, so "Desbloquear" is a DELETE of the
 * blocked row that leaves the release exactly as it was (planning decision 2, assumption A-P13).
 *
 * RLS is enabled with **no policy at all**, deliberately, and `anon` / `authenticated` hold no table
 * privilege (the migration revokes them): the readers are SECURITY DEFINER functions (owner
 * postgres) and the admin lane (`withAdminTx`, `service_role`). Adding a policy for `authenticated`
 * to this table is always a bug, the same rule as `email_allowlist` and `platform_admins`.
 *
 * The e-mail is plain `text` with `email = lower(btrim(email))` enforced by a CHECK, NOT `citext`:
 * citext's `=` does not resolve inside a `search_path = ''` definer and silently falls back to a
 * case-sensitive comparison. Every reader normalises its input with `lower(btrim())` in SQL.
 *
 * `provider` is a FORMAT, never an enum (D-486): a second gateway needs no migration.
 * `created_by_user_id` has NO foreign key, on purpose: a deleted account must not block history.
 * `mapping_id` is a nullable uuid whose foreign key to `payment_products` is hand SQL in plan 05
 * (that table does not exist yet).
 */
export const accessGrants = pgTable(
  'access_grants',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    email: text().notNull(),
    /** 'manual' | 'gateway'. */
    source: text().notNull(),
    /** manual: 'active' | 'blocked'; gateway: 'active' | 'inactive'. See the CHECK. */
    status: text().notNull(),
    /** The gateway's key, lower snake format (D-486). Null on a manual row. */
    provider: text(),
    /** The gateway's order or subscription reference. Null on a manual row. */
    externalRef: text('external_ref'),
    mappingId: uuid('mapping_id'),
    validUntil: timestamp('valid_until', { withTimezone: true }),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }),
    /** A refund or chargeback is terminal: a later `approved` cannot reopen it (Pitfall 3). */
    terminal: boolean().notNull().default(false),
    /** The admin who wrote a manual row. No FK (see above). */
    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'access_grants_email_lower_chk',
      sql`${t.email} = lower(btrim(${t.email})) and ${t.email} <> ''`,
    ),
    check('access_grants_source_chk', sql`${t.source} in ('manual','gateway')`),
    check(
      'access_grants_status_chk',
      sql`(${t.source} = 'manual' and ${t.status} in ('active','blocked')) or (${t.source} = 'gateway' and ${t.status} in ('active','inactive'))`,
    ),
    check(
      'access_grants_gateway_ref_chk',
      sql`(${t.source} = 'gateway') = (${t.provider} is not null and ${t.externalRef} is not null)`,
    ),
    check(
      'access_grants_provider_chk',
      sql`${t.provider} is null or ${t.provider} ~ '^[a-z][a-z0-9_]{1,30}$'`,
    ),
    // A manual release and a manual block may coexist for one e-mail, never two of the same kind.
    uniqueIndex('access_grants_manual_uq')
      .on(t.tenantId, t.email, t.status)
      .where(sql`${t.source} = 'manual'`),
    uniqueIndex('access_grants_gateway_uq')
      .on(t.tenantId, t.provider, t.externalRef)
      .where(sql`${t.source} = 'gateway'`),
    index('access_grants_tenant_email_idx').on(t.tenantId, t.email),
    // The coarse auth hooks of plan 03 ask "any tenant"; the tenant-first index above satisfies the
    // schema-conventions rule for the table itself.
    index('access_grants_email_active_idx').on(t.email).where(sql`${t.status} = 'active'`),
    // The Acessos list, newest first.
    index('access_grants_tenant_updated_idx').on(
      t.tenantId,
      t.updatedAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
  ],
).enableRLS();
