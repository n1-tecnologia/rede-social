import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';

/**
 * The moderation log (MODER-03, D-337): the tenant's audit record of every moderator action — a
 * comment removed (08-01, 08-03), a membership blocked or unblocked (08-04) and a role changed
 * (08-05). Moderation is a KERNEL capability with no flag (SCHEMA-CONVENTIONS §(f).2), so the table
 * lives here and every owning module writes it through ONE function,
 * `packages/core/server/moderation/log.ts`'s `recordModerationAction(tx, ctx, entry)`, inside the
 * module's own transaction. A removal and its log row therefore commit together or not at all; the
 * log is never written from a bus subscriber (`flush` runs after commit and swallows errors).
 *
 * APPEND-ONLY BY CONSTRUCTION (T-08-02, reversibility costly). Four locks, each proven by pgTAP
 * `supabase/tests/154-moderation-log.sql`:
 *  1. exactly TWO policies, `select` and `insert` — no update, no delete, no `for all`;
 *  2. the 08-01 `*_moderation_log_immutable.sql` migration REVOKES update, delete and truncate from
 *     every grantee Supabase's default privileges handed them to;
 *  3. the same migration's `app.moderation_log_immutable()` raises 42501 from a ROW trigger (update,
 *     delete) and a STATEMENT trigger (truncate) — the guard that also stops the admin lane
 *     (`service_role` bypasses RLS) and the table owner;
 *  4. there is no update path in application code at all.
 *
 * The SELECT policy is TENANT ISOLATION ONLY. Who may read the log is a PERMISSION
 * (`moderation.manage`), enforced in the API tier on every route that reads it (FEED-08: a future
 * grant to `support_tenant` must not need a migration). The INSERT policy pins the tenant AND the
 * actor to the lane's claims, so a tenant-lane writer cannot forge another tenant's row or another
 * person's action (T-08-03).
 *
 * IDENTITY: the actor and the target are MEMBERSHIPS (the identity noun, D-304), resolved by the
 * writer in the same transaction and NOT NULL, so no un-anchored row can exist. The user ids beside
 * them exist for the insert policy's claim pin.
 *
 * NO FOREIGN KEY on any user or membership column, on purpose. `users` cascades into `memberships`
 * when an auth user is deleted: a cascading FK here would hit the immutability trigger and BLOCK the
 * account deletion, and a non-cascading one would block it too. The audit outlives the people in it;
 * the read joins live and says "Membro removido" for a departed one. `tenant_id` references
 * `tenants` with NO cascade, for the same reason.
 */
export const moderationLog = pgTable(
  'moderation_log',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The database clock inside the writing transaction, never a client one. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** 'comment_removed' | 'member_blocked' | 'member_unblocked' | 'role_changed' — see the CHECK. */
    action: text().notNull(),
    /** No FK (see above). Pinned to `app.user_id()` by the insert policy in the tenant lane. */
    actorUserId: uuid('actor_user_id').notNull(),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    targetUserId: uuid('target_user_id').notNull(),
    targetMembershipId: uuid('target_membership_id').notNull(),
    /** 'post_comment' | 'story_comment' on a `comment_removed` row; null on every other action. */
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    /** The optional internal reason of a block or unblock (D-331): never shown to the person. */
    reason: text(),
    /** A comment removal's text, captured in the removal transaction (D-337): the evidence. */
    excerpt: text(),
    /** `role_changed` only: `{ from, to }`. */
    details: jsonb().$type<{ from: string; to: string }>(),
  },
  (t) => [
    // The Moderação screen's two keyset reads: everything, and one action ("Comentários", …).
    index('moderation_log_tenant_created_idx').on(t.tenantId, t.createdAt.desc(), t.id.desc()),
    index('moderation_log_tenant_action_created_idx').on(
      t.tenantId,
      t.action,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check(
      'moderation_log_action_chk',
      sql`${t.action} in ('comment_removed','member_blocked','member_unblocked','role_changed')`,
    ),
    // A comment removal names its comment; nothing else names one. Each equality is guarded so the
    // CHECK can never be satisfied by a NULL (the `feed_comments_parent_shape_chk` lesson).
    check(
      'moderation_log_subject_chk',
      sql`((${t.action} = 'comment_removed') = (${t.subjectType} is not null and ${t.subjectId} is not null))
        and (${t.subjectType} is null or ${t.subjectType} in ('post_comment','story_comment'))`,
    ),
    check(
      'moderation_log_reason_len_chk',
      sql`${t.reason} is null or char_length(${t.reason}) between 1 and 500`,
    ),
    check(
      'moderation_log_excerpt_len_chk',
      sql`${t.excerpt} is null or char_length(${t.excerpt}) <= 280`,
    ),
    check(
      'moderation_log_details_chk',
      sql`(${t.action} = 'role_changed') = (${t.details} is not null)`,
    ),
    pgPolicy('moderation_log_tenant_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id()`,
    }),
    pgPolicy('moderation_log_tenant_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`tenant_id = app.tenant_id() and actor_user_id = app.user_id()`,
    }),
  ],
).enableRLS();
