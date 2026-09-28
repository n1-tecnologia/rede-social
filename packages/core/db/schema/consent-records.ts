import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
  integer,
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

/**
 * LGPD evidence of the two consents taken at sign-up (D-03, AUTH-04):
 * `tenant_rules` (the tenant's own `rules_text` at `rules_version`) and `platform_terms` (the platform's Terms of
 * Use + Privacy Policy at `PLATFORM_TERMS_VERSION` — one consent, one version).
 *
 * APPEND-ONLY BY CONSTRUCTION (threat T-04-02): exactly ONE policy, for `select`, and only for the
 * owner inside their own tenant. There is deliberately no insert/update/delete policy — writes happen
 * in the admin lane at sign-up, so no tenant session can forge, edit or erase a recorded consent.
 * `accepted_at` defaults to the database's `now()` inside that transaction: never a client clock.
 */
export const consentRecords = pgTable(
  'consent_records',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'tenant_rules' | 'platform_terms' — see the CHECK below. */
    kind: text().notNull(),
    /** `tenants.rules_version` for `tenant_rules`; `PLATFORM_TERMS_VERSION` for `platform_terms`. */
    textVersion: integer('text_version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
    /** From the trusted `X-Client-IP` header the web server action sets (T-04-03). */
    ip: inet(),
    userAgent: text('user_agent'),
  },
  (t) => [
    // One row per person per text version: re-acceptance of a NEW version adds a row, never replaces.
    uniqueIndex('consent_records_tenant_user_kind_version_uq').on(
      t.tenantId,
      t.userId,
      t.kind,
      t.textVersion,
    ),
    index('consent_records_tenant_user_idx').on(t.tenantId, t.userId),
    check('consent_records_kind_chk', sql`${t.kind} in ('tenant_rules','platform_terms')`),
    pgPolicy('consent_records_self_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
  ],
).enableRLS();
