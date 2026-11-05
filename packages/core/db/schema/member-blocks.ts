import { sql } from 'drizzle-orm';
import { check, index, pgPolicy, pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authenticatedRole } from 'drizzle-orm/supabase';
import { tenants } from './tenants';
import { users } from './users';

/**
 * A member blocking another member (Phase 13, NATIVE-33; D-616, AD-1, AD-7): the blocker's own content
 * filter, the second half of the minimum the store policies require. It is NOT the moderation block
 * (`memberships.blocked_at`, an admin's act that removes a member's access); it only hides the blocked
 * member's content from the blocker. Phase 11 (CHAT-07) extends its effect to messaging, follow and the
 * profile message button.
 *
 * KEYED `(tenant_id, blocker_user_id, blocked_user_id)`: a block exists inside one tenant only, so the
 * same two user ids in another tenant are two strangers (the composite key carries the tenant), and
 * blocking twice is the same row. `blocker_user_id <> blocked_user_id`.
 *
 * WRITES ONLY THROUGH DEFINERS: `app.member_block_create` refuses (BL001) a target who is not a live
 * member of the SAME tenant, is the caller, or is not role `member` (staff cannot be blocked by a member,
 * AD-1), and `app.member_block_delete` removes the row. There is no insert, update or delete policy.
 *
 * ONE SELECT POLICY: `blocker_user_id = app.user_id()`. The blocked member and every third member read
 * nothing (T-13-21): no member can learn who blocked them. `app.is_blocked_by_viewer(author)` is the
 * `security invoker` predicate the read paths filter with, and it sees the caller's own rows only.
 *
 * Both user columns cascade with the identity, so a hard identity deletion needs no extra path; the
 * in-place anonymisation deletes the rows in both directions (`app.account_anonymise`).
 */
export const memberBlocks = pgTable(
  'member_blocks',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    blockerUserId: uuid('blocker_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedUserId: uuid('blocked_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'member_blocks_pkey',
      columns: [t.tenantId, t.blockerUserId, t.blockedUserId],
    }),
    // "Who blocked this user" for the anonymisation's both-directions delete (never a member-facing read).
    index('member_blocks_tenant_blocked_idx').on(t.tenantId, t.blockedUserId),
    check('member_blocks_not_self_chk', sql`${t.blockerUserId} <> ${t.blockedUserId}`),
    pgPolicy('member_blocks_select', {
      for: 'select',
      to: authenticatedRole,
      using: sql`tenant_id = app.tenant_id() and blocker_user_id = app.user_id()`,
    }),
  ],
).enableRLS();
