import {
  PROFILE_FORM_CHOICE_TYPES,
  PROFILE_FORM_LIMITS,
  PROFILE_FORM_TYPES,
} from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';
import { users } from './users';

/** `in ('short_text','long_text',…)` built from the ONE list of types, so the CHECK can never drift (D-591). */
const typeList = sql.raw(PROFILE_FORM_TYPES.map((type) => `'${type}'`).join(','));
const choiceTypeList = sql.raw(PROFILE_FORM_CHOICE_TYPES.map((type) => `'${type}'`).join(','));

/**
 * A lane that carries one of the three real roles. A null or unknown role claim reads nothing from
 * these tables (fails closed; the `payment_products` lane test pins the same behaviour).
 */
const KNOWN_ROLE = sql`app.tenant_role() in ('admin_tenant','support_tenant','member')`;

/** This tenant's rows, and only for the `admin_tenant` claim: the write predicate (the store's `TENANT_ADMIN`). */
const TENANT_ADMIN = sql`tenant_id = app.tenant_id() and app.tenant_role() = 'admin_tenant'`;

/**
 * The tenant's profile form: one row per question (Phase 12, PFORM-02, PFORM-03, PFORM-05; D-585,
 * D-587, D-588, D-591, D-593). Kernel code, like `payments`: the gate that reads it runs on every
 * request, so the table lives here and the builder module only writes it.
 *
 * COMPLETENESS IS COMPUTED, NEVER STORED (D-585). `required` and `archived_at` are the only inputs of
 * `app.profile_form_missing` (hand SQL, `*_profile_form_functions.sql`): the questions a member still
 * owes are the active required ones with no answer row. There is no flag, no counter and no version
 * of the form on any row; `revision` is the optimistic lock between two admins, nothing more.
 *
 * ANSWERED DATA IS KEPT BY THE DATABASE (D-587, D-588). The composite foreign key of
 * `profile_form_answers` is ON DELETE RESTRICT, so a question with answers cannot be deleted by
 * anyone, including a bug; "removed" is `archived_at`. A BEFORE UPDATE trigger (hand SQL) refuses the
 * edits that would reinterpret or expose stored answers (type, answered options, privacy, limits).
 *
 * `type` is a CHECK built from `PROFILE_FORM_TYPES`, in that order: a new type is one new Zod variant
 * plus a small CHECK-widening migration, appended last (the `tenant_modules_key_chk` mould).
 * `options` is a `jsonb` array of `{ id, label }` with stable ids (answers reference ids, so a rename
 * never changes meaning); `limits` is `{ min?, max? }` for number and date.
 *
 * POLICIES: every tenant lane with a real role reads the active questions; archived ones are staff-only; only
 * `admin_tenant` writes. Members and `support_tenant` write nothing.
 */
export const profileFormQuestions = pgTable(
  'profile_form_questions',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    type: text().notNull(),
    title: text().notNull(),
    helpText: text('help_text'),
    required: boolean().notNull().default(false),
    /** D-593: when true (and the question is active) other members of the tenant read the answer. */
    showOnProfile: boolean('show_on_profile').notNull().default(false),
    /** D-592: the optional "Outro" of a choice question. */
    allowOther: boolean('allow_other').notNull().default(false),
    /** `[{ "id": "<uuid>", "label": "..." }]` in display order; empty for a non-choice type. */
    options: jsonb().$type<{ id: string; label: string }[]>().notNull().default([]),
    /** `{ "min"?, "max"? }` for number (numbers) and date (ISO days). */
    limits: jsonb().$type<{ min?: number | string; max?: number | string }>().notNull().default({}),
    position: integer().notNull(),
    /** Soft state (SCHEMA-CONVENTIONS (d)2): an archived question leaves the form, its answers stay (D-588). */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** Set on create and on reactivate; drives the "new optional" notice (D-586). */
    listedAt: timestamp('listed_at', { withTimezone: true }).notNull().defaultNow(),
    /** Optimistic lock between two admins. NOT a completeness counter (D-585). */
    revision: integer().notNull().default(1),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The target of the composite foreign key of the answers: an answer can only name a question of ITS OWN tenant.
    unique('profile_form_questions_tenant_id_uq').on(t.tenantId, t.id),
    check('profile_form_questions_type_chk', sql`${t.type} in (${typeList})`),
    check(
      'profile_form_questions_title_chk',
      sql`char_length(${t.title}) between 1 and ${sql.raw(String(PROFILE_FORM_LIMITS.title))}`,
    ),
    check(
      'profile_form_questions_help_chk',
      sql`${t.helpText} is null or char_length(${t.helpText}) <= ${sql.raw(String(PROFILE_FORM_LIMITS.helpText))}`,
    ),
    // An options array; at most 20; a choice type carries at least two and any other type carries none.
    check(
      'profile_form_questions_options_chk',
      sql`jsonb_typeof(${t.options}) = 'array'
        and jsonb_array_length(${t.options}) <= ${sql.raw(String(PROFILE_FORM_LIMITS.options))}
        and ((${t.type} in (${choiceTypeList})) = (jsonb_array_length(${t.options}) >= 2))`,
    ),
    // "Outro" exists only on the three choice types.
    check(
      'profile_form_questions_other_chk',
      sql`not ${t.allowOther} or ${t.type} in (${choiceTypeList})`,
    ),
    check('profile_form_questions_limits_chk', sql`jsonb_typeof(${t.limits}) = 'object'`),
    check('profile_form_questions_revision_chk', sql`${t.revision} >= 1`),
    // The lists: the active form in order, the archived list.
    index('profile_form_questions_tenant_archived_position_idx').on(
      t.tenantId,
      t.archivedAt,
      t.position,
    ),
    // The gate's first probe: the active required questions of a tenant, nothing else.
    index('profile_form_questions_required_idx')
      .on(t.tenantId)
      .where(sql`${t.required} and ${t.archivedAt} is null`),
    pgPolicy('profile_form_questions_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and ${KNOWN_ROLE} and (archived_at is null or app.tenant_role() in ('admin_tenant','support_tenant'))`,
    }),
    pgPolicy('profile_form_questions_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: TENANT_ADMIN,
    }),
    pgPolicy('profile_form_questions_update', {
      for: 'update',
      to: authenticatedRole,
      using: TENANT_ADMIN,
      withCheck: TENANT_ADMIN,
    }),
    pgPolicy('profile_form_questions_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: TENANT_ADMIN,
    }),
  ],
).enableRLS();
