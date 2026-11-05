import {
  REPORT_EXCERPT_MAX,
  REPORT_NOTE_MAX,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_SUBJECT_TYPES,
} from '@rede-social/contracts/moderation';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
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

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(','));

/**
 * A member's report of a post or a comment (Phase 13, NATIVE-31; D-616, AD-5, AD-6, AD-7). The minimum
 * the store policies require (Apple 1.2, Google UGC); Phase 11 keeps the rest of moderation and appends
 * values to the CHECK lists below (`story_comment`, `community`, `direct_message`).
 *
 * MODERATION IS A KERNEL CAPABILITY (SCHEMA-CONVENTIONS (f).2), so this is a kernel table, not a module
 * table, and it is not gated by `social`.
 *
 * WRITES ONLY THROUGH DEFINERS. There is NO insert, update or delete policy: a report is filed by
 * `app.content_report_create` (a live member; it snapshots the author and the first 280 code points of
 * the text) and resolved by `app.content_report_resolve` (`admin_tenant` only). A report never removes
 * content by itself: the removal and its moderation-log row stay in the existing kernel paths, called by
 * the same transaction as the resolve (plan 14), so a removal without its log row stays impossible.
 *
 * ONE SELECT POLICY: the reporter's own rows, plus every row of the tenant for `admin_tenant`. Nobody
 * else reads a report, so the reported author, the other members and the support team never learn who
 * reported what (T-13-21); the member-facing reads of the API return nothing about reports at all.
 *
 * `reporter_user_id` cascades with the identity; `author_user_id` and `resolved_by_user_id` carry NO
 * foreign key, on purpose, for the `moderation_log` reason: the evidence outlives the people in it.
 * `author_user_id` is the author AT REPORT TIME (what the "block the author" resolution acts on).
 *
 * `(tenant_id, reporter_user_id, subject_type, subject_id)` is unique (AD-6): one report per reporter and
 * item, the type being part of the key so a post and a comment never collide.
 */
export const contentReports = pgTable(
  'content_reports',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reporterUserId: uuid('reporter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'feed_post' | 'post_comment' (the CHECK is built from `REPORT_SUBJECT_TYPES`). */
    subjectType: text('subject_type').notNull(),
    /** The post or comment id. No foreign key: it spans two tables and the report outlives a removal. */
    subjectId: uuid('subject_id').notNull(),
    /** The author when the report was filed. No foreign key (see above). */
    authorUserId: uuid('author_user_id').notNull(),
    /** 'offensive' | 'harassment' | 'spam' | 'sexual_violent' | 'other' (AD-5). */
    reason: text().notNull(),
    /** The reporter's optional words: null or at most `REPORT_NOTE_MAX` characters. Nulled at anonymisation. */
    note: text(),
    /** The first `REPORT_EXCERPT_MAX` code points of the caption or body, taken at report time. */
    excerpt: text().notNull().default(''),
    /** 'open' | 'dismissed' | 'content_removed' | 'author_blocked'; `open` is the only state a report is filed in. */
    status: text().notNull().default('open'),
    /** The admin who resolved it. No foreign key (see above). */
    resolvedByUserId: uuid('resolved_by_user_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // AD-6: one report per reporter and item; the arbiter of the duplicate (23505).
    unique('content_reports_reporter_subject_uq').on(
      t.tenantId,
      t.reporterUserId,
      t.subjectType,
      t.subjectId,
    ),
    // The admin queue's keyset: a tenant's reports by status, newest first.
    index('content_reports_tenant_status_created_idx').on(
      t.tenantId,
      t.status,
      t.createdAt.desc(),
      t.id.desc(),
    ),
    check(
      'content_reports_subject_type_chk',
      sql`${t.subjectType} in (${list(REPORT_SUBJECT_TYPES)})`,
    ),
    check('content_reports_reason_chk', sql`${t.reason} in (${list(REPORT_REASONS)})`),
    check('content_reports_status_chk', sql`${t.status} in (${list(REPORT_STATUSES)})`),
    check(
      'content_reports_note_len_chk',
      sql`${t.note} is null or char_length(${t.note}) <= ${sql.raw(String(REPORT_NOTE_MAX))}`,
    ),
    check(
      'content_reports_excerpt_len_chk',
      sql`char_length(${t.excerpt}) <= ${sql.raw(String(REPORT_EXCERPT_MAX))}`,
    ),
    // `open` if and only if never resolved; both sides are non-null booleans, so no NULL can satisfy it.
    check('content_reports_resolved_chk', sql`(${t.status} = 'open') = (${t.resolvedAt} is null)`),
    pgPolicy('content_reports_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and (reporter_user_id = app.user_id() or app.tenant_role() = 'admin_tenant')`,
    }),
  ],
).enableRLS();
