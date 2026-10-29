import { PROFILE_FORM_LIMITS } from '@rede-social/contracts/profile-form';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { memberships } from './memberships';
import { profileFormQuestions } from './profile-form-questions';
import { tenants } from './tenants';
import { users } from './users';

/** A lane that carries one of the three real roles; a null or unknown role claim reads nothing (fails closed). */
const KNOWN_ROLE = sql`app.tenant_role() in ('admin_tenant','support_tenant','member')`;

/** This member's own rows, in the member role (staff never write answers, D-584). */
const SELF_MEMBER = sql`tenant_id = app.tenant_id() and user_id = app.user_id() and app.tenant_role() = 'member'`;

/**
 * A member's answer to one question of the tenant's profile form (Phase 12, PFORM-08, PFORM-18,
 * PFORM-22; D-585, D-588, D-593, D-594). One row per (membership, question); an unanswered or cleared
 * optional question is the ABSENCE of a row, so "has an answer row" IS "has a valid answer" (validity
 * is enforced at write time and the locks forbid narrowing): that is what lets the gate be a pure
 * anti-join with no per-type logic in SQL.
 *
 * `value` is typed `jsonb`, validated per question type by `parseAnswer` in
 * `@rede-social/contracts/profile-form`; a new type needs no change here (D-591). Capped at 4096 bytes.
 *
 * RLS: NOT `member_profiles_tenant_select`. An answer is personal data, so there are three read
 * policies and nothing wider: the owner, the tenant's staff (`admin_tenant`, `support_tenant`) and,
 * for a question the admin flagged `show_on_profile` that is not archived, the rest of the tenant.
 * Writes are the owner's only and only in the role `member`; staff never write an answer. The insert
 * and update `with check` ties `user_id` and `tenant_id` to a live membership, and the composite
 * foreign key refuses a question of another tenant.
 *
 * KEPT AND CASCADED: the foreign key to the question is ON DELETE RESTRICT (an answered question
 * cannot be deleted, D-588); `membership_id` and `user_id` are ON DELETE CASCADE exactly as
 * `member_profiles`, so an LGPD deletion needs no extra path (D-594).
 */
export const profileFormAnswers = pgTable(
  'profile_form_answers',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    questionId: uuid('question_id').notNull(),
    membershipId: uuid('membership_id')
      .notNull()
      .references(() => memberships.id, { onDelete: 'cascade' }),
    /** Denormalised from the membership for the self policy, as `member_profiles.user_id` is. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    value: jsonb().$type<unknown>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Composite, so an answer can only point at a question of ITS OWN tenant; RESTRICT keeps answered questions.
    foreignKey({
      name: 'profile_form_answers_question_fk',
      columns: [t.tenantId, t.questionId],
      foreignColumns: [profileFormQuestions.tenantId, profileFormQuestions.id],
    }).onDelete('restrict'),
    // The gate's anti-join, the self reads and the upsert arbiter.
    uniqueIndex('profile_form_answers_member_question_uq').on(
      t.tenantId,
      t.membershipId,
      t.questionId,
    ),
    // Answer counts, the RESTRICT check and the "has answers" lock queries.
    index('profile_form_answers_tenant_question_idx').on(t.tenantId, t.questionId),
    check(
      'profile_form_answers_value_chk',
      sql`octet_length(${t.value}::text) <= ${sql.raw(String(PROFILE_FORM_LIMITS.valueBytes))}`,
    ),
    pgPolicy('profile_form_answers_self_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id() and ${KNOWN_ROLE}`,
    }),
    pgPolicy('profile_form_answers_staff_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and app.tenant_role() in ('admin_tenant','support_tenant')`,
    }),
    pgPolicy('profile_form_answers_public_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and ${KNOWN_ROLE} and exists (
        select 1 from public.profile_form_questions q
         where q.tenant_id = profile_form_answers.tenant_id
           and q.id = profile_form_answers.question_id
           and q.show_on_profile and q.archived_at is null)`,
    }),
    pgPolicy('profile_form_answers_self_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`${SELF_MEMBER} and exists (
        select 1 from public.memberships mm
         where mm.id = membership_id and mm.tenant_id = profile_form_answers.tenant_id
           and mm.user_id = profile_form_answers.user_id and mm.deleted_at is null)`,
    }),
    pgPolicy('profile_form_answers_self_update', {
      for: 'update',
      to: authenticatedRole,
      using: SELF_MEMBER,
      withCheck: sql`${SELF_MEMBER} and exists (
        select 1 from public.memberships mm
         where mm.id = membership_id and mm.tenant_id = profile_form_answers.tenant_id
           and mm.user_id = profile_form_answers.user_id and mm.deleted_at is null)`,
    }),
    pgPolicy('profile_form_answers_self_delete', {
      for: 'delete',
      to: authenticatedRole,
      using: SELF_MEMBER,
    }),
  ],
).enableRLS();
