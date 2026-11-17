import { tenants, users } from '@rede-social/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';

/**
 * The chat module's three tables (CHAT-01..05). Moved verbatim from the Phase 1 core stub
 * (`chat-stubs.ts`, DDL-free: `pnpm db:generate` wrote nothing for the move alone) and reshaped in
 * 07-08.
 *
 * Facts a reviewer must not "fix":
 *
 * 1. **The model stays generic (CHAT-01, PITFALLS §9).** `kind in ('support','direct','group')`,
 *    participants carry a `role`, authorship is a generic `author_user_id` and every message has a
 *    per-conversation `seq`. V1 writes only `support`. "Members talk only to the team" is a
 *    PERMISSION (`chat.support.contact` / `chat.support`), never a schema shape, so V2
 *    member-to-member chat is a `kind` value plus two `member` participant rows, not a migration.
 * 2. **Staff reach a support conversation by ROLE, never by a participant row (D-225).** There is no
 *    staff participant, nothing is assigned or claimed, and a new staff member sees every thread.
 *    The team's read state is ONE conversation column, `staff_last_read_seq`, so one staff read (or
 *    a staff reply) clears "awaiting" for everybody. The member's read state is their own
 *    participant row's `last_read_seq` (`last_read_at` is kept beside it and stamped on read).
 * 3. **`seq` is assigned by the database, never by a caller** (`chat_messages_seq_trg`, a BEFORE
 *    INSERT definer in `*_chat_functions.sql`): it increments `last_seq` on the conversation row,
 *    whose row lock serialises writers per conversation until commit. So seqs are gapless (a
 *    rollback undoes the counter), unique (`chat_messages_conversation_seq_uq` is the backstop, and
 *    pgTAP 040 pins it) and COMMIT ORDER EQUALS SEQ ORDER, which is what makes "messages after seq
 *    N" catch-up lose nothing (RESEARCH Pitfall 10). The same trigger maintains `last_message_at`,
 *    `last_message_side`, `last_staff_seq` and, on a staff message, `staff_last_read_seq`.
 * 4. **The counters live on the conversation** (`last_seq`, `last_staff_seq`,
 *    `staff_last_read_seq`, `last_message_side`) so both badges are one indexed row read: the
 *    member's dot is `last_staff_seq > last_read_seq`, the staff count is `last_message_side =
 *    'member' and last_seq > staff_last_read_seq` (D-237, D-238).
 * 5. **`author_side` is stored**, set by the API from the caller's permission, so a bubble and a
 *    preview need no role join and a later role change never re-sides history.
 * 6. **The body rule is enforced twice with ONE meaning (D-225, CHAT-02 encoding).** The API trims
 *    and counts CODE POINTS (`[...body].length`), and the body CHECK is
 *    `char_length(btrim(body, E' \t\n\r')) between 1 and 2000`, which also counts code points. An
 *    all-newline body is refused by both, and 2,000 code points of emoji are accepted by both.
 * 7. **Participant/staff-aware policies replace the tenant-wide isolation policy** (planning
 *    decision 2, the D-217 `event_secrets` precedent): support threads are the first data private
 *    between two members of the SAME tenant, so a dropped participant predicate in the API must
 *    still leak nothing. The staff role list is an INLINE literal (`admin_tenant`,
 *    `support_tenant`), the same one `app.realtime_topic_allowed` uses; an integration test pins it
 *    against the TypeScript `permissionsFor` (RESEARCH Pitfall 4). There is no recursion:
 *    participants never reference conversations, messages reference conversations.
 * 8. **D-221 is reversed by Phase 12.4 (D-800): a member has several cases over time, ONE active at
 *    a time.** The old one-thread-per-member index (`chat_conversations_one_support_per_member`) is
 *    GONE: the activation migration (plan 02, `*_chat_cases_activate.sql`) backfilled every legacy
 *    conversation into a numbered case and REPLACED that index, in one atomic file, with
 *    `chat_conversations_one_active_case_per_member` (unique on tenant and member while the state is
 *    open, in_progress or resolved; a `closed` case no longer counts). Nothing keeps the old index
 *    beside it. A support row always has a state (`chat_conversations_support_state_chk`, added after
 *    the backfill). A message on a `closed` case is refused for every writer (SQLSTATE CS004, the
 *    message trigger), so the member's next message opens the next case.
 * 9. **The case is the conversation row (D-836, Phase 12.4 plan 01).** Seven NULLABLE, expand-only
 *    columns (`case_number`, `state`, `owner_user_id`, `category`, `priority`, `resolved_at`,
 *    `closed_at`) turn a `support` conversation into a numbered, stateful case; `direct` and `group`
 *    rows keep all seven null (CASE-25). Nothing is dropped, renamed or made NOT NULL. Two tables carry
 *    what a column cannot: `chat_case_counters` (one row per tenant, RLS on, NO policy: no lane reads or
 *    writes it) and `chat_case_events` (the append-only history). A row is born open and numbered by two
 *    triggers in `*_chat_cases_functions.sql`: a BEFORE INSERT one fills the defaults and an AFTER INSERT
 *    one takes the number from the counter (AFTER, so a skipped `on conflict do nothing` burns nothing,
 *    D-837). The number is a 32-bit integer; the 2147483647 ceiling per tenant is not guarded (EP-005).
 *    The shape and coherence CHECKs are spelled so that a LEGACY support row (every case column null)
 *    passes them; the "a support row has a state" half is plan 02's (`chat_conversations_support_state_chk`), added after the backfill.
 */

/** Staff lanes, spelled once: the tenant role claim of either staff role. */
const STAFF_ROLE = sql`app.tenant_role() in ('admin_tenant', 'support_tenant')`;

export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** V1 only creates 'support'; 'direct' and 'group' are V2 without a migration. */
    kind: text().notNull().default('support'),
    /** Group/subject line; null for support conversations. */
    subject: text(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    /** Denormalised for inbox sorting; written by the seq trigger (fact 3). */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** The highest seq ever assigned in this conversation (fact 3). */
    lastSeq: bigint('last_seq', { mode: 'number' }).notNull().default(0),
    /** The highest seq a staff member wrote: the member's dot compares against it (D-237). */
    lastStaffSeq: bigint('last_staff_seq', { mode: 'number' }).notNull().default(0),
    /** The TEAM's shared read position (D-225): one read or reply clears "awaiting" for all staff. */
    staffLastReadSeq: bigint('staff_last_read_seq', { mode: 'number' }).notNull().default(0),
    /** Who wrote the latest message; null only before the first message. */
    lastMessageSide: text('last_message_side'),
    /**
     * D-836, D-804: the case number, sequential per tenant from 1 and unique with the tenant. Taken by
     * `chat_conversations_number_trg` (AFTER INSERT) for a `support` row; null for `direct` and `group`.
     */
    caseNumber: integer('case_number'),
    /** D-836: `open`, `in_progress`, `resolved` or `closed`; null only for non-support rows (and legacy rows until plan 02). */
    state: text(),
    /** D-836, D-806: the staff member who holds the case; null while it is `open`. */
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    /** D-811: `check_in`, `events`, `payment`, `account` or `other`. */
    category: text(),
    /** D-811: `low`, `normal` or `high`; only the staff change it. */
    priority: text(),
    /** D-805: set while the case is `resolved`. */
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** D-805: set once the case is `closed`. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (t) => [
    // D-802: ONE ACTIVE case per member per tenant (active = not closed). It REPLACES the Phase 7 index
    // `chat_conversations_one_support_per_member` (D-221), which the activation migration drops in the
    // same atomic file. The member send's `on conflict` predicate is exactly this one (a test pins both).
    uniqueIndex('chat_conversations_one_active_case_per_member')
      .on(t.tenantId, t.createdByUserId)
      .where(sql`kind = 'support' and state in ('open','in_progress','resolved')`),
    // D-804: a case number is unique per tenant. NULLs (direct and group rows, legacy rows) never collide.
    uniqueIndex('chat_conversations_case_number_uniq').on(t.tenantId, t.caseNumber),
    index('chat_conversations_tenant_last_message_idx').on(t.tenantId, t.lastMessageAt.desc()),
    // CHAT-03: the staff inbox keyset, `last_message_at desc, id desc` over support threads only.
    // `nullsFirst` matches the default null ordering of a plain `desc` in the query (the 07-01 rule).
    index('chat_conversations_inbox_idx')
      .on(t.tenantId, t.lastMessageAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`kind = 'support'`),
    check('chat_conversations_kind_chk', sql`${t.kind} in ('support','direct','group')`),
    check(
      'chat_conversations_last_side_chk',
      sql`${t.lastMessageSide} is null or ${t.lastMessageSide} in ('member','staff')`,
    ),
    // D-836, D-811: the closed value lists of the case columns. Every CHECK of this block is VALID at
    // creation because every existing row (all seven columns null) satisfies it.
    check(
      'chat_conversations_state_chk',
      sql`${t.state} is null or ${t.state} in ('open','in_progress','resolved','closed')`,
    ),
    check(
      'chat_conversations_category_chk',
      sql`${t.category} is null or ${t.category} in ('check_in','events','payment','account','other')`,
    ),
    check(
      'chat_conversations_priority_chk',
      sql`${t.priority} is null or ${t.priority} in ('low','normal','high')`,
    ),
    // EP-001: the first number is 1, never 0.
    check(
      'chat_conversations_case_number_chk',
      sql`${t.caseNumber} is null or ${t.caseNumber} > 0`,
    ),
    // D-839: a typed SUPPORT subject is 1 to 80 CODE POINTS (`char_length` counts code points, like the
    // API); scoped to support rows so a V2 group subject is not capped.
    check(
      'chat_conversations_subject_chk',
      sql`${t.kind} <> 'support' or ${t.subject} is null or char_length(${t.subject}) between 1 and 80`,
    ),
    // The LEGACY-SAFE half of the shape rule (checker B1). A row that is not `support` carries none of
    // the case columns (CASE-25). The other half, "a support row has a state", is NOT stated here: it
    // is plan 02's, added NOT VALID after the backfill, because a NOT VALID constraint is still
    // evaluated on the new version of every updated row and would fail every message on a conversation
    // that predates the backfill (the message trigger UPDATEs the conversation counters).
    check(
      'chat_conversations_case_shape_chk',
      sql`${t.kind} = 'support' or (${t.state} is null and ${t.caseNumber} is null and ${t.ownerUserId} is null and ${t.category} is null and ${t.priority} is null and ${t.resolvedAt} is null and ${t.closedAt} is null)`,
    ),
    // D-838: the other half of the shape rule, a support row always has a state. Added by the activation
    // migration NOT VALID after the backfill and then validated (D-836).
    check(
      'chat_conversations_support_state_chk',
      sql`${t.kind} <> 'support' or ${t.state} is not null`,
    ),
    // D-805, D-806: what each non-null state implies. A null state (a legacy support row) passes.
    check(
      'chat_conversations_case_coherence_chk',
      sql`${t.state} is null or (${t.state} = 'open' and ${t.ownerUserId} is null and ${t.resolvedAt} is null and ${t.closedAt} is null) or (${t.state} = 'in_progress' and ${t.ownerUserId} is not null and ${t.resolvedAt} is null and ${t.closedAt} is null) or (${t.state} = 'resolved' and ${t.resolvedAt} is not null and ${t.closedAt} is null) or (${t.state} = 'closed' and ${t.closedAt} is not null and ${t.resolvedAt} is null)`,
    ),
    // CASE-17: the team inbox default tab (open and in-progress cases), so closed cases that pile up
    // forever are never scanned. Same key order and null ordering as `chat_conversations_inbox_idx`.
    index('chat_conversations_open_inbox_idx')
      .on(t.tenantId, t.lastMessageAt.desc().nullsFirst(), t.id.desc().nullsFirst())
      .where(sql`kind = 'support' and state in ('open','in_progress')`),
    // CASE-14: "Meus chamados", one member's cases newest number first.
    index('chat_conversations_member_cases_idx')
      .on(t.tenantId, t.createdByUserId, t.caseNumber.desc().nullsFirst())
      .where(sql`kind = 'support'`),
    // CASE-13: the auto-close sweep of plan 04 reads resolved cases across every tenant, so this index is
    // deliberately NOT tenant-first: the documented exception to the tenant-first rule, like
    // `notifications_created_idx`.
    index('chat_conversations_resolved_sweep_idx').on(t.resolvedAt).where(sql`state = 'resolved'`),
    // Fact 7: staff see every SUPPORT thread of their tenant; anyone else only what they created or
    // take part in. Per command (07 review A-CR-01 / A-WR-01 / B-WR-04): a lane may create only its
    // OWN conversation with untouched counters, only staff may UPDATE (and only the column the
    // `*_chat_rls_grants.sql` grant leaves writable, `staff_last_read_seq`), and nobody DELETEs.
    // The counters move only through the definer trigger.
    pgPolicy('chat_conversations_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and ((kind = 'support' and ${STAFF_ROLE}) or created_by_user_id = app.user_id() or exists (select 1 from public.chat_participants p where p.conversation_id = chat_conversations.id and p.tenant_id = app.tenant_id() and p.user_id = app.user_id()))`,
    }),
    pgPolicy('chat_conversations_insert', {
      for: 'insert',
      to: authenticatedRole,
      // D-836, T-12.4-01: a lane may create ONLY a born-open case of its own: no number, no owner, no
      // instants, a priority of null or normal and a state of null or open (the defaults trigger fills
      // them before this check runs). A row that is not `support` carries no case column at all.
      withCheck: sql`tenant_id = app.tenant_id() and created_by_user_id = app.user_id() and last_seq = 0 and last_staff_seq = 0 and staff_last_read_seq = 0 and last_message_side is null and last_message_at is null and case_number is null and owner_user_id is null and resolved_at is null and closed_at is null and ((kind = 'support' and (priority is null or priority = 'normal') and (state is null or state = 'open')) or (kind <> 'support' and state is null and category is null and priority is null))`,
    }),
    pgPolicy('chat_conversations_staff_update', {
      for: 'update',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and kind = 'support' and ${STAFF_ROLE}`,
      withCheck: sql`tenant_id = app.tenant_id() and kind = 'support' and ${STAFF_ROLE}`,
    }),
  ],
).enableRLS();

export const chatParticipants = pgTable(
  'chat_participants',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'support' = staff answering on behalf of the tenant; not a boolean "is_support". */
    role: text().notNull().default('member'),
    /** The instant of the participant's last read (context; the read POSITION is `last_read_seq`). */
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    /** The highest seq this participant has read (D-237's dot compares `last_staff_seq` to it). */
    lastReadSeq: bigint('last_read_seq', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('chat_participants_tenant_user_idx').on(t.tenantId, t.userId),
    check('chat_participants_role_chk', sql`${t.role} in ('member','support','admin')`),
    // Fact 7: your own participant rows, or any row of your tenant when you are staff. A lane may
    // enrol ONLY ITSELF and ONLY into a conversation it created (07 review A-CR-01: nothing else ties
    // a participant row to a conversation the lane may see, and the participant row is what grants the
    // messages and the `conv:` Realtime topic). Staff never hold participant rows (fact 2). A member
    // updates only its own row, and only `last_read_seq`/`last_read_at` (column grant in
    // `*_chat_rls_grants.sql`); nobody DELETEs.
    pgPolicy('chat_participants_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and (user_id = app.user_id() or ${STAFF_ROLE})`,
    }),
    pgPolicy('chat_participants_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`tenant_id = app.tenant_id() and user_id = app.user_id() and role = 'member' and exists (select 1 from public.chat_conversations c where c.id = chat_participants.conversation_id and c.tenant_id = app.tenant_id() and c.created_by_user_id = app.user_id())`,
    }),
    pgPolicy('chat_participants_update_own', {
      for: 'update',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
      withCheck: sql`tenant_id = app.tenant_id() and user_id = app.user_id()`,
    }),
  ],
).enableRLS();

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    /**
     * Per-conversation gapless sequence, assigned by `chat_messages_seq_trg` (fact 3). NOT NULL on
     * purpose: the BEFORE trigger fills it, and any value a writer supplies is overwritten.
     */
    seq: bigint({ mode: 'number' }).notNull(),
    /** Generic authorship (PITFALLS §9): never `from_support boolean`. */
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    /** Plain text, stored trimmed with its inner line breaks as sent (fact 6). */
    body: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete: moderation keeps the row and the sequence intact. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** `member` or `staff`, set by the API from the caller's permission (fact 5). */
    authorSide: text('author_side').notNull(),
  },
  (t) => [
    uniqueIndex('chat_messages_conversation_seq_uq').on(t.conversationId, t.seq),
    index('chat_messages_tenant_conversation_seq_idx').on(
      t.tenantId,
      t.conversationId,
      t.seq.desc(),
    ),
    check('chat_messages_author_side_chk', sql`${t.authorSide} in ('member','staff')`),
    check(
      'chat_messages_body_chk',
      sql`char_length(btrim(${t.body}, E' \\t\\n\\r')) between 1 and 2000`,
    ),
    // Fact 7: a message is visible exactly when its conversation is (the conversation policy
    // decides). Chat is APPEND-ONLY for a lane (07 review A-WR-01 / B-WR-04): it inserts as itself,
    // on the side its role allows (`staff` only on a support thread from a staff claim, `member` only
    // as a participant of the thread), and there is no UPDATE or DELETE policy at all.
    pgPolicy('chat_messages_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and exists (select 1 from public.chat_conversations c where c.id = chat_messages.conversation_id)`,
    }),
    pgPolicy('chat_messages_insert', {
      for: 'insert',
      to: authenticatedRole,
      withCheck: sql`tenant_id = app.tenant_id() and author_user_id = app.user_id() and ((author_side = 'staff' and ${STAFF_ROLE} and exists (select 1 from public.chat_conversations c where c.id = chat_messages.conversation_id and c.kind = 'support')) or (author_side = 'member' and exists (select 1 from public.chat_participants p where p.conversation_id = chat_messages.conversation_id and p.tenant_id = app.tenant_id() and p.user_id = app.user_id())))`,
    }),
  ],
).enableRLS();

/**
 * D-836, D-837: ONE row per tenant, holding the last case number handed out. RLS is on and there is NO
 * policy, so no lane reads or writes it; only the definer trigger `chat_conversations_number_trg` does.
 * The row appears at the tenant's first case (a tenant with no case has none). The move engine copies it
 * with the tenant by catalogue (it carries `tenant_id`), with user triggers silenced, so no number is
 * ever reassigned.
 */
export const chatCaseCounters = pgTable('chat_case_counters', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  lastNumber: integer('last_number').notNull().default(0),
}).enableRLS();

/**
 * D-810: the append-only history of a case. Written only by definers and triggers (no write policy,
 * `revoke update, delete, truncate` from `authenticated` in the constraints migration); read by staff
 * only. `message_id` has NO foreign key on purpose: the message trigger of plan 02 writes the event
 * BEFORE the message row exists. The conversation cascades (the shipped suites delete conversations
 * directly) and the two users are set null (a deleted account must not erase the history).
 */
export const chatCaseEvents = pgTable(
  'chat_case_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => chatConversations.id, { onDelete: 'cascade' }),
    /** `opened`, `taken`, `assigned`, `resolved`, `closed`, `reopened` or `edited`. */
    kind: text().notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    fromState: text('from_state'),
    toState: text('to_state'),
    /** For `edited`: the field that changed. */
    field: text(),
    fromValue: text('from_value'),
    toValue: text('to_value'),
    /** The message that caused the event, when one did; no foreign key (see the docblock). */
    messageId: uuid('message_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'chat_case_events_kind_chk',
      sql`${t.kind} in ('opened','taken','assigned','resolved','closed','reopened','edited')`,
    ),
    // EP-004: one case's events read in (created_at, id) order; the id breaks a tie of one instant.
    index('chat_case_events_conv_idx').on(t.tenantId, t.conversationId, t.createdAt, t.id),
    // CASE-23: the staff of the tenant read the history; nobody writes it from a lane (no write policy).
    pgPolicy('chat_case_events_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and ${STAFF_ROLE}`,
    }),
  ],
).enableRLS();

export type ChatConversation = typeof chatConversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
