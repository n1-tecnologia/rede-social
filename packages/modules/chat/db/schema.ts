import { tenants, users } from '@rede-social/core/db/schema';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
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
 * 8. **D-221: there is no status column.** Each member has one ongoing thread forever
 *    (`chat_conversations_one_support_per_member`); nothing models open/resolved.
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
  },
  (t) => [
    // One support conversation per member per tenant (ROADMAP Phase 7 note, D-221).
    uniqueIndex('chat_conversations_one_support_per_member')
      .on(t.tenantId, t.createdByUserId)
      .where(sql`kind = 'support'`),
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
      withCheck: sql`tenant_id = app.tenant_id() and created_by_user_id = app.user_id() and last_seq = 0 and last_staff_seq = 0 and staff_last_read_seq = 0 and last_message_side is null and last_message_at is null`,
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

export type ChatConversation = typeof chatConversations.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
