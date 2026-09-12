import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tenantIsolationPolicy } from '../rls';
import { tenants } from './tenants';
import { users } from './users';

/**
 * V2-safe chat stubs (Foundation deliverable; Phase 7 builds the module on top).
 *
 * The V1 rule "members talk only to the tenant's support team" is a PERMISSION, never a schema
 * shape (PITFALLS §9): the table says `kind in ('support','direct','group')` and authorship is a
 * generic `author_user_id`, so V2 member-to-member chat is a `kind` value plus a permission
 * change — not a migration that rewrites these tables.
 *
 * Phase 1 ships shape only: `tenant_id` + RLS + isolation policy on every table so the pgTAP
 * coverage test (01-08) passes from day one. No triggers, no Realtime wiring, no routes.
 */
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
    /** Denormalised for inbox sorting; written by Phase 7. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One support conversation per member per tenant (ROADMAP Phase 7 note).
    uniqueIndex('chat_conversations_one_support_per_member')
      .on(t.tenantId, t.createdByUserId)
      .where(sql`kind = 'support'`),
    index('chat_conversations_tenant_last_message_idx').on(t.tenantId, t.lastMessageAt.desc()),
    check('chat_conversations_kind_chk', sql`${t.kind} in ('support','direct','group')`),
    tenantIsolationPolicy('chat_conversations_tenant_isolation'),
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
    /** Unread = messages created after this instant (no per-message read table). */
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId] }),
    index('chat_participants_tenant_user_idx').on(t.tenantId, t.userId),
    check('chat_participants_role_chk', sql`${t.role} in ('member','support','admin')`),
    tenantIsolationPolicy('chat_participants_tenant_isolation'),
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
    /** Per-conversation monotonic sequence: stable ordering and gap detection for Realtime replay. */
    seq: bigint({ mode: 'number' }).notNull(),
    /** Generic authorship (PITFALLS §9): never `from_support boolean`. */
    authorUserId: uuid('author_user_id')
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Soft delete: moderation keeps the row and the sequence intact. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('chat_messages_conversation_seq_uq').on(t.conversationId, t.seq),
    index('chat_messages_tenant_conversation_seq_idx').on(
      t.tenantId,
      t.conversationId,
      t.seq.desc(),
    ),
    tenantIsolationPolicy('chat_messages_tenant_isolation'),
  ],
).enableRLS();
