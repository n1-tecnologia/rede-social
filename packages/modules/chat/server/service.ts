import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { emit } from '@rede-social/core/server/events/bus';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { permissionsForRequest } from '@rede-social/core/server/rbac/permissions';
import { sql } from 'drizzle-orm';
import {
  CHAT_PAGE_SIZE,
  CHAT_PERMISSIONS,
  type ChatSide,
  type MessagePage,
  type MessageQuery,
  type MessageRow,
  type SendResult,
  type SupportThread,
} from '../contracts/index';
import { firstNameOf } from './first-name';

const log = moduleLogger('module-chat');

/**
 * The chat service (CHAT-01..05). A PURE TENANT-LANE area: every read and write is
 * `withTenantTx(ctx, …)`, the tenant and the user are never parameters a caller supplies, and the
 * participant/staff-aware policies (`packages/modules/chat/db/schema.ts` fact 7) make another
 * member's thread INVISIBLE rather than refused. The explicit predicates below restate what the
 * policies enforce, so an API bug and a policy bug would both have to happen for a thread to leak.
 *
 * `seq` is never written here: the BEFORE INSERT trigger assigns it under the conversation row lock
 * (`*_chat_functions.sql`), and the AFTER INSERT trigger publishes the ids-only signals inside the
 * same transaction. This file only decides WHO may write WHAT and projects what readers may see.
 *
 * Logs carry the SHAPE of a call (ids, seq, side, counts), never a body or a name (T-07-53).
 */

/**
 * ISO-8601 in UTC with MICROSECOND precision, produced by Postgres (the `listNotifications` rule), so
 * a JS `Date` round trip never truncates an instant a later cursor compares against.
 */
const ISO_MICROSECONDS = sql.raw(`'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`);

/** A seq no conversation will ever reach: the "latest page" is the page before it. */
const LATEST = Number.MAX_SAFE_INTEGER;

/** Whether the caller answers support in this tenant right now (D-223: a permission, not a role). */
export async function isStaff(ctx: RequestContext): Promise<boolean> {
  return (await permissionsForRequest(ctx)).includes(CHAT_PERMISSIONS.answer);
}

/** One message row off `tx.execute`, snake_case. */
type MessageDbRow = {
  id: string;
  seq: number;
  author_side: ChatSide;
  body: string;
  created_at: string;
  author_is_viewer: boolean;
  staff_display_name: string | null;
};

/**
 * THE message projection. A staff row's author is projected as the FIRST NAME of the agent's live
 * membership profile in this tenant and nothing else (D-222); the join only runs for staff rows. A
 * member row carries no author: the reader already knows whose thread it is. Soft-deleted messages
 * (moderation) are skipped; their seq stays taken, which the seq cursor tolerates.
 */
const messageSource = (ctx: RequestContext) => sql`
    select m.id,
           m.seq::int as seq,
           m.author_side,
           m.body,
           to_char(m.created_at at time zone 'utc', ${ISO_MICROSECONDS}) as created_at,
           (m.author_user_id = ${ctx.userId}::uuid) as author_is_viewer,
           mp.display_name as staff_display_name
      from chat_messages m
      left join memberships ms
             on m.author_side = 'staff'
            and ms.tenant_id = m.tenant_id
            and ms.user_id = m.author_user_id
            and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id`;

const toMessage = (row: MessageDbRow): MessageRow => ({
  id: row.id,
  seq: Number(row.seq),
  side: row.author_side,
  body: row.body,
  createdAt: row.created_at,
  author: row.author_side === 'staff' ? { firstName: firstNameOf(row.staff_display_name) } : null,
  authorIsViewer: row.author_is_viewer,
});

/**
 * The conversation id when the caller may read it, or null. Restates the conversation policy:
 * staff on a SUPPORT conversation, its creator, or a participant. `staff` is a bound boolean
 * computed from the caller's permissions, never a role literal in TypeScript.
 */
async function visibleConversation(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
  staff: boolean,
): Promise<boolean> {
  const rows = await tx.execute<{ id: string }>(sql`
    select c.id
      from chat_conversations c
     where c.id = ${conversationId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid
       and ((c.kind = 'support' and ${staff}::boolean)
            or c.created_by_user_id = ${ctx.userId}::uuid
            or exists (
                 select 1
                   from chat_participants p
                  where p.conversation_id = c.id
                    and p.tenant_id = c.tenant_id
                    and p.user_id = ${ctx.userId}::uuid
               ))`);
  return rows.length > 0;
}

/**
 * The page of `limit` messages in one direction, over-fetching by one so `hasMore` is exact. Two
 * COMPLETE literal statements, chosen in TypeScript, never a bound direction:
 *  - `after`: `seq > N` ascending (the catch-up, D-240);
 *  - `before`: `seq < N` descending, then reversed, so every page reads oldest first.
 */
async function pageOf(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
  direction: { after: number } | { before: number },
  limit: number,
): Promise<{ items: MessageRow[]; hasMore: boolean }> {
  if ('after' in direction) {
    const rows = await tx.execute<MessageDbRow>(sql`
      ${messageSource(ctx)}
       where m.tenant_id = ${ctx.tenantId}::uuid
         and m.conversation_id = ${conversationId}::uuid
         and m.deleted_at is null
         and m.seq > ${direction.after}::bigint
       order by m.seq asc
       limit ${limit + 1}`);
    return { items: rows.slice(0, limit).map(toMessage), hasMore: rows.length > limit };
  }
  const rows = await tx.execute<MessageDbRow>(sql`
    ${messageSource(ctx)}
     where m.tenant_id = ${ctx.tenantId}::uuid
       and m.conversation_id = ${conversationId}::uuid
       and m.deleted_at is null
       and m.seq < ${direction.before}::bigint
     order by m.seq desc
     limit ${limit + 1}`);
  return { items: rows.slice(0, limit).reverse().map(toMessage), hasMore: rows.length > limit };
}

/** A body the database refused by its CHECK is the same `body_required` the API would have said. */
function bodyCheckViolated(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (candidate.code === '23514' && candidate.constraint_name === 'chat_messages_body_chk') {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** The stored message, projected as its author sees it. */
async function insertedMessage(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
  messageId: string,
): Promise<MessageRow> {
  const rows = await tx.execute<MessageDbRow>(sql`
    ${messageSource(ctx)}
     where m.tenant_id = ${ctx.tenantId}::uuid
       and m.conversation_id = ${conversationId}::uuid
       and m.id = ${messageId}::uuid`);
  const row = rows[0];
  if (!row) throw new ApiError(500, 'INTERNAL');
  return toMessage(row);
}

/**
 * Inserts one message as the caller. No `seq` is sent: the column is NOT NULL, and Postgres checks
 * that AFTER the BEFORE trigger assigned it; the AFTER trigger then publishes the signals.
 */
async function insertMessage(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
  side: ChatSide,
  body: string,
): Promise<MessageRow> {
  const inserted = await tx.execute<{ id: string }>(sql`
    insert into chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
    values (${ctx.tenantId}::uuid, ${conversationId}::uuid, ${ctx.userId}::uuid, ${side}, ${body})
    returning id`);
  const id = inserted[0]?.id;
  if (!id) throw new ApiError(500, 'INTERNAL');
  return insertedMessage(tx, ctx, conversationId, id);
}

/**
 * `POST /v1/chat/support/messages` (CHAT-02, D-220): the member writes to the team.
 *
 * The conversation is created LAZILY, here, on the first message: in ONE transaction the member's
 * support conversation is inserted with `on conflict … do nothing` on the partial unique index
 * `chat_conversations_one_support_per_member`, read back, the member's participant row is ensured,
 * and the message is inserted. Twenty concurrent first messages therefore create exactly one
 * conversation: every loser of the insert race waits on the winner's index entry, does nothing, and
 * reads the committed row. `body` arrives trimmed and bounded (`chatBodySchema`).
 *
 * The `chat.message_sent` event is queued AFTER the transaction returned, so a rolled-back send
 * notifies nobody.
 */
export async function sendSupportMessage(ctx: RequestContext, body: string): Promise<SendResult> {
  let result: SendResult;
  try {
    result = await withTenantTx(ctx, async (tx) => {
      await tx.execute(sql`
        insert into chat_conversations (tenant_id, kind, created_by_user_id)
        values (${ctx.tenantId}::uuid, 'support', ${ctx.userId}::uuid)
        on conflict (tenant_id, created_by_user_id) where kind = 'support' do nothing`);
      const conversations = await tx.execute<{ id: string }>(sql`
        select c.id
          from chat_conversations c
         where c.tenant_id = ${ctx.tenantId}::uuid
           and c.kind = 'support'
           and c.created_by_user_id = ${ctx.userId}::uuid`);
      const conversationId = conversations[0]?.id;
      if (!conversationId) throw new ApiError(500, 'INTERNAL');
      await tx.execute(sql`
        insert into chat_participants (conversation_id, tenant_id, user_id, role)
        values (${conversationId}::uuid, ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, 'member')
        on conflict (conversation_id, user_id) do nothing`);
      const message = await insertMessage(tx, ctx, conversationId, 'member', body);
      return { conversationId, message };
    });
  } catch (error) {
    if (bodyCheckViolated(error)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'body_required' });
    }
    throw error;
  }

  emit(ctx, 'chat.message_sent', {
    tenantId: ctx.tenantId,
    conversationId: result.conversationId,
    messageId: result.message.id,
    seq: result.message.seq,
    authorUserId: ctx.userId,
    authorSide: 'member',
  });
  log.info(
    {
      event: 'chat.message_sent',
      tenantId: ctx.tenantId,
      conversationId: result.conversationId,
      seq: result.message.seq,
      side: 'member',
    },
    'chat message sent',
  );
  return result;
}

/**
 * `GET /v1/chat/support` (D-220): the member's own thread, READ-ONLY. Before the first message there
 * is no conversation, and the answer is `{ conversation: null, messages: [], hasOlder: false }`; this
 * GET never writes (the 06-06 prefetch rule), so opening the screen never fills the staff inbox with
 * an empty thread. Otherwise it answers the member's read position and the latest page.
 */
export async function getSupportThread(ctx: RequestContext): Promise<SupportThread> {
  return withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<{
      id: string;
      last_seq: number;
      last_staff_seq: number;
      last_read_seq: number | null;
    }>(sql`
      select c.id,
             c.last_seq::int as last_seq,
             c.last_staff_seq::int as last_staff_seq,
             p.last_read_seq::int as last_read_seq
        from chat_conversations c
        left join chat_participants p
               on p.conversation_id = c.id
              and p.tenant_id = c.tenant_id
              and p.user_id = ${ctx.userId}::uuid
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'support'
         and c.created_by_user_id = ${ctx.userId}::uuid`);
    const conversation = rows[0];
    if (!conversation) return { conversation: null, messages: [], hasOlder: false };
    const page = await pageOf(tx, ctx, conversation.id, { before: LATEST }, CHAT_PAGE_SIZE);
    return {
      conversation: {
        id: conversation.id,
        lastSeq: Number(conversation.last_seq),
        lastReadSeq: Number(conversation.last_read_seq ?? 0),
        lastStaffSeq: Number(conversation.last_staff_seq),
      },
      messages: page.items,
      hasOlder: page.hasMore,
    };
  });
}

/**
 * `GET /v1/chat/conversations/{id}/messages?afterSeq=|beforeSeq=&limit=` (CHAT-04, D-240): the
 * catch-up and the history, for the member of the thread and for staff on a support thread. A
 * conversation the caller may not read (another member's, another tenant's, an unknown id) is ONE bare
 * `404 NOT_FOUND`, indistinguishable on purpose (D-23).
 */
export async function listMessages(
  ctx: RequestContext,
  conversationId: string,
  query: MessageQuery,
): Promise<MessagePage> {
  const staff = await isStaff(ctx);
  return withTenantTx(ctx, async (tx) => {
    if (!(await visibleConversation(tx, ctx, conversationId, staff))) {
      throw new ApiError(404, 'NOT_FOUND');
    }
    const direction =
      query.afterSeq !== undefined
        ? { after: query.afterSeq }
        : { before: query.beforeSeq ?? LATEST };
    const page = await pageOf(tx, ctx, conversationId, direction, query.limit);
    return { conversationId, items: page.items, hasMore: page.hasMore };
  });
}

/** The live state of a conversation member's membership, as staff decide whether to reply. */
export type MemberState = 'active' | 'blocked' | 'removed';

/**
 * `POST /v1/chat/conversations/{id}/messages` (CHAT-03, D-225): any staff member replies to any
 * support conversation. Nothing is assigned or claimed; the trigger sets the team's shared read
 * position to the reply's seq, so replying clears "awaiting" for every staff member.
 *
 * The conversation row is locked `for update` first, then the member's membership is read: a
 * blocked member answers `409 CONFLICT { chat: 'member_blocked' }` and a soft-deleted (or missing)
 * membership `409 { chat: 'member_removed' }`. Staff can still READ those threads (CONTEXT's
 * discretion item, decided: read-only). An unknown, foreign or non-support conversation is a bare 404.
 */
export async function replyToConversation(
  ctx: RequestContext,
  conversationId: string,
  body: string,
): Promise<SendResult> {
  let result: SendResult;
  try {
    result = await withTenantTx(ctx, async (tx) => {
      const rows = await tx.execute<{ id: string; member_state: MemberState }>(sql`
        select c.id,
               case
                 when ms.id is null or ms.deleted_at is not null then 'removed'
                 when ms.blocked_at is not null or ms.status = 'blocked' then 'blocked'
                 else 'active'
               end as member_state
          from chat_conversations c
          left join memberships ms
                 on ms.tenant_id = c.tenant_id
                and ms.user_id = c.created_by_user_id
         where c.id = ${conversationId}::uuid
           and c.tenant_id = ${ctx.tenantId}::uuid
           and c.kind = 'support'
           for update of c`);
      const conversation = rows[0];
      if (!conversation) throw new ApiError(404, 'NOT_FOUND');
      if (conversation.member_state === 'blocked') {
        throw new ApiError(409, 'CONFLICT', { chat: 'member_blocked' });
      }
      if (conversation.member_state === 'removed') {
        throw new ApiError(409, 'CONFLICT', { chat: 'member_removed' });
      }
      const message = await insertMessage(tx, ctx, conversationId, 'staff', body);
      return { conversationId, message };
    });
  } catch (error) {
    if (bodyCheckViolated(error)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'body_required' });
    }
    throw error;
  }

  emit(ctx, 'chat.message_sent', {
    tenantId: ctx.tenantId,
    conversationId,
    messageId: result.message.id,
    seq: result.message.seq,
    authorUserId: ctx.userId,
    authorSide: 'staff',
  });
  log.info(
    {
      event: 'chat.message_sent',
      tenantId: ctx.tenantId,
      conversationId,
      seq: result.message.seq,
      side: 'staff',
    },
    'chat message sent',
  );
  return result;
}
