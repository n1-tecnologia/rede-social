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

/** A lane that carries one of the three real roles (the steps table's predicate, restated). */
const KNOWN_ROLE = sql`app.tenant_role() in ('admin_tenant','support_tenant','member')`;

/** This tenant's rows, and only for the `admin_tenant` claim: the write predicate. */
const TENANT_ADMIN = sql`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`;

/**
 * The branches of a tenant's profile form (Phase 12.2, PFORM-43, PFORM-45, PFORM-55; D-640, D-641, D-644):
 * one row per branch, a group of questions shown together when the answer to ONE opener question matches
 * `open_values`. A question joins a branch through `profile_form_questions.branch_id`. The branch replaces
 * the per-question condition of Phase 12.1 (`condition_question_id` / `condition_values`, which stay as an
 * unused legacy pair for one release; a later cleanup release drops them).
 *
 * - **`opener_question_id`** names the question whose answer opens the branch; `open_values` holds the tokens
 *   (option ids, or 'true'/'false' for yes/no) any of which opens it, 1..`PROFILE_FORM_LIMITS.options` long.
 * - **`name`** is an optional admin label, 1..`PROFILE_FORM_LIMITS.branchName` characters when present.
 * - **`archived_at`** is the soft state (SCHEMA-CONVENTIONS (d)2): an archived branch leaves the form, its
 *   members and their answers stay.
 * - **`unique (tenant_id, id)`** is the target of the composite key `(tenant_id, branch_id)` of the questions: a
 *   question can only name a branch of ITS OWN tenant, whatever the service does (T-12.2-01, D-644).
 * - **`revision`** is the optimistic lock between two admins and feeds the form's etag.
 *
 * NO FOREIGN KEY IS DECLARED HERE ON THE PAIR (D-641). The branch names its opener (a question) and the
 * question names its branch, so the two tables reference each other and both keys must be DEFERRABLE
 * INITIALLY IMMEDIATE (the tenant move copies the pair as one group under `set constraints all deferred`, and
 * a non-deferrable key makes the move planner refuse the table). drizzle-kit cannot express DEFERRABLE, so
 * both composite keys, `(tenant_id, opener_question_id) -> profile_form_questions (tenant_id, id)` and
 * `(tenant_id, branch_id) -> profile_form_branches (tenant_id, id)`, are hand SQL in the companion
 * `*_profile_form_branches_functions.sql`, exactly as `events` and `event_secrets` did; the snapshot stays
 * honest and `drizzle-kit generate` keeps reporting no drift. The `tenant_id` key to `tenants` is ordinary.
 *
 * POLICIES (the steps table's shape): every tenant lane with a real role reads the branches (the member's
 * form needs the opener and the values to decide what to show); only `admin_tenant` writes.
 */
export const profileFormBranches = pgTable(
  'profile_form_branches',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The question whose answer opens this branch (key declared in hand SQL, DEFERRABLE; see the header). */
    openerQuestionId: uuid('opener_question_id').notNull(),
    /** The tokens of the opener's answer, any of which opens the branch. */
    openValues: text('open_values').array().notNull(),
    /** Optional admin label. */
    name: text(),
    /** Optimistic lock between two admins; part of the form etag. */
    revision: integer().notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The target of the composite key of the questions: a question can only name a branch of ITS OWN tenant.
    unique('profile_form_branches_tenant_id_uq').on(t.tenantId, t.id),
    check(
      'profile_form_branches_values_chk',
      sql`cardinality(${t.openValues}) between 1 and ${sql.raw(String(PROFILE_FORM_LIMITS.options))}`,
    ),
    check(
      'profile_form_branches_name_chk',
      sql`${t.name} is null or char_length(${t.name}) between 1 and ${sql.raw(String(PROFILE_FORM_LIMITS.branchName))}`,
    ),
    check('profile_form_branches_revision_chk', sql`${t.revision} >= 1`),
    // The canonical read order of a tenant's branches.
    index('profile_form_branches_tenant_order_idx').on(t.tenantId, t.createdAt, t.id),
    // The branches an opener owns (the dependents list, the opener-change guard).
    index('profile_form_branches_opener_idx').on(t.tenantId, t.openerQuestionId),
    pgPolicy('profile_form_branches_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and ${KNOWN_ROLE}`,
    }),
    pgPolicy('profile_form_branches_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: TENANT_ADMIN,
    }),
    pgPolicy('profile_form_branches_update', {
      for: 'update',
      to: authenticatedRole,
      using: TENANT_ADMIN,
      withCheck: TENANT_ADMIN,
    }),
    pgPolicy('profile_form_branches_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: TENANT_ADMIN,
    }),
  ],
).enableRLS();
