import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';

/** A lane that carries one of the three real roles (the questions table's predicate, restated). */
const KNOWN_ROLE = sql`app.tenant_role() in ('admin_tenant','support_tenant','member')`;

/** This tenant's rows, and only for the `admin_tenant` claim: the write predicate. */
const TENANT_ADMIN = sql`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`;

/**
 * The steps of a tenant's profile form (Phase 12.1, PFORM-27; D-627, D-633): one row per step, every
 * question belongs to exactly one of them (`profile_form_questions.step_id`, composite foreign key
 * below). Kernel code, like the questions table, because the visibility rule reads it on every request.
 *
 * - **Steps are rows, not a column on the question** (D-627): a step has a title and a place of its own,
 *   and a step with no question yet is a legitimate state while an admin builds the form.
 * - **No unique on `position`**: a reorder swaps two positions in one statement, and a non-deferrable
 *   unique would fail mid-statement. The canonical read is `order by position, created_at, id`, served by
 *   `profile_form_steps_tenant_position_idx`. The row count per tenant (at most `PROFILE_FORM_LIMITS.steps`)
 *   cannot be a CHECK; the service enforces it under the admin lock, and the position CHECK reads the same limit.
 * - **`unique (tenant_id, id)`** is the target of the composite foreign key of the questions: a question
 *   can only name a step of ITS OWN tenant, whatever the service does (T-12.1-01).
 * - `revision` is bumped on rename and reorder and feeds the form's etag; it is not a completeness counter.
 *
 * POLICIES: every tenant lane with a real role reads the steps (a step has no archive); only
 * `admin_tenant` writes. Members and `support_tenant` write nothing.
 */
export const profileFormSteps = pgTable(
  'profile_form_steps',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    title: text().notNull(),
    position: integer().notNull(),
    /** Optimistic lock between two admins; part of the form etag. */
    revision: integer().notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('profile_form_steps_tenant_id_uq').on(t.tenantId, t.id),
    check(
      'profile_form_steps_title_chk',
      sql`char_length(${t.title}) between 1 and ${sql.raw(String(PROFILE_FORM_LIMITS.stepTitle))}`,
    ),
    check(
      'profile_form_steps_position_chk',
      sql`${t.position} between 1 and ${sql.raw(String(PROFILE_FORM_LIMITS.steps))}`,
    ),
    check('profile_form_steps_revision_chk', sql`${t.revision} >= 1`),
    index('profile_form_steps_tenant_position_idx').on(t.tenantId, t.position),
    pgPolicy('profile_form_steps_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and ${KNOWN_ROLE}`,
    }),
    pgPolicy('profile_form_steps_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: TENANT_ADMIN,
    }),
    pgPolicy('profile_form_steps_update', {
      for: 'update',
      to: authenticatedRole,
      using: TENANT_ADMIN,
      withCheck: TENANT_ADMIN,
    }),
    pgPolicy('profile_form_steps_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: TENANT_ADMIN,
    }),
  ],
).enableRLS();
