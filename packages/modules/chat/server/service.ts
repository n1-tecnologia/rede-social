import { REALTIME_EVENTS, topicSuffix } from '@rede-social/contracts/realtime';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { emit } from '@rede-social/core/server/events/bus';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import type { Counters } from '@rede-social/core/server/modules/counters';
import { decodeCursor, encodeCursor } from '@rede-social/core/server/paging';
import { permissionsForRequest } from '@rede-social/core/server/rbac/permissions';
import { sqlstateOf } from '@rede-social/core/server/safety/sqlstate';
import { sql } from 'drizzle-orm';
import {
  CASE_ACTIVE_STATES,
  CHAT_PAGE_SIZE,
  CHAT_PERMISSIONS,
  type ChatCaseCategory,
  type ChatCasePriority,
  type ChatCaseState,
  type ChatSide,
  type ConversationDetail,
  type ConversationMember,
  type InboxPage,
  type InboxQuery,
  type InboxRow,
  type MessagePage,
  type MessageQuery,
  type MessageRow,
  type SendResult,
  type SupportSendInput,
  type SupportThread,
  type VoiceReplyInput,
  type VoiceSendInput,
} from '../contracts/index';
import {
  activeMemberCase,
  firstMessageJoin,
  hasAnyCaseOf,
  lastMessagePreview,
  memberCaseOf,
  ownerJoins,
  staffCaseOf,
  toInboxCase,
} from './cases';
import { firstNameOf } from './first-name';
import { assertVoiceUsable, storedVoiceMessage, voiceGoneSql } from './voice-sql';

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
  /** Null on a recording (D-846): `toMessage` answers the empty string. */
  body: string | null;
  media_asset_id: string | null;
  voice_seconds: number | null;
  voice_gone: boolean;
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
           m.media_asset_id::text as media_asset_id,
           m.voice_seconds::int as voice_seconds,
           ${voiceGoneSql('m')} as voice_gone,
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
  body: row.body ?? '',
  createdAt: row.created_at,
  author: row.author_side === 'staff' ? { firstName: firstNameOf(row.staff_display_name) } : null,
  authorIsViewer: row.author_is_viewer,
  // D-846: the key exists only on a recording; `deleted` only when its asset has been retired since.
  ...(row.media_asset_id
    ? {
        voice: {
          mediaId: row.media_asset_id,
          durationSeconds: Number(row.voice_seconds),
          ...(row.voice_gone ? { deleted: true } : {}),
        },
      }
    : {}),
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
export function bodyCheckViolated(error: unknown): boolean {
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

/** What a message holds (D-846): plain text, or ONE recording named by the id of its asset. */
export type MessageContent =
  | { kind: 'text'; body: string }
  | { kind: 'voice'; mediaAssetId: string };

/**
 * Inserts one message as the caller. No `seq` is sent: the column is NOT NULL, and Postgres checks
 * that AFTER the BEFORE trigger assigned it; the AFTER trigger then publishes the signals.
 *
 * A recording is inserted with `insert ... select` from the caller's own asset, so `voice_seconds` is the
 * asset's SERVER-MEASURED `duration_seconds` and never a number from the request (T-12.5-16). When the asset
 * is no longer there (retired between the validation and this statement) nothing is inserted and the answer
 * is the same `voice_invalid` as an unknown id.
 */
export async function insertMessage(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
  side: ChatSide,
  content: MessageContent,
): Promise<MessageRow> {
  const inserted =
    content.kind === 'text'
      ? await tx.execute<{ id: string }>(sql`
          insert into chat_messages (tenant_id, conversation_id, author_user_id, author_side, body)
          values (${ctx.tenantId}::uuid, ${conversationId}::uuid, ${ctx.userId}::uuid, ${side}, ${content.body})
          returning id`)
      : await tx.execute<{ id: string }>(sql`
          insert into chat_messages (tenant_id, conversation_id, author_user_id, author_side, body,
                                     media_asset_id, voice_seconds)
          select ${ctx.tenantId}::uuid, ${conversationId}::uuid, ${ctx.userId}::uuid, ${side}::text,
                 null::text, a.id, a.duration_seconds
            from media_assets a
           where a.id = ${content.mediaAssetId}::uuid
             and a.tenant_id = ${ctx.tenantId}::uuid
             and a.owner_user_id = ${ctx.userId}::uuid
             and a.deleted_at is null
          returning id`);
  const id = inserted[0]?.id;
  if (!id) {
    if (content.kind === 'voice') {
      throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'voice_invalid' });
    }
    throw new ApiError(500, 'INTERNAL');
  }
  return insertedMessage(tx, ctx, conversationId, id);
}

/**
 * The state list of the active-case index `chat_conversations_one_active_case_per_member` (D-802), spelled
 * ONCE from the contract constant: the `on conflict` arbiter must repeat the index predicate to the letter or
 * Postgres answers 42P10 (probed), and a test compares this list with the one read back from `pg_indexes`.
 * Exact lowercase literals, no normalisation (EP-012, EP-013).
 */
const ACTIVE_CASE_STATES = sql.raw(CASE_ACTIVE_STATES.map((state) => `'${state}'`).join(','));

/** The member's ACTIVE case (open, in_progress or resolved) with its state, or null when every case they had is closed. */
async function activeCaseOf(
  tx: Tx,
  ctx: RequestContext,
): Promise<{ id: string; state: string } | null> {
  const rows = await tx.execute<{ id: string; state: string }>(sql`
    select c.id, c.state
      from chat_conversations c
     where c.tenant_id = ${ctx.tenantId}::uuid
       and c.kind = 'support'
       and c.created_by_user_id = ${ctx.userId}::uuid
       and c.state in (${ACTIVE_CASE_STATES})
     order by c.case_number desc nulls last
     limit 1`);
  return rows[0] ?? null;
}

/** The case a message just landed in, as the send answers it (number and state AFTER the message trigger ran). */
async function caseOfSend(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
): Promise<{ id: string; number: number; state: ChatCaseState }> {
  const rows = await tx.execute<{ id: string; number: number; state: ChatCaseState }>(sql`
    select c.id, c.case_number::int as number, c.state
      from chat_conversations c
     where c.id = ${conversationId}::uuid
       and c.tenant_id = ${ctx.tenantId}::uuid`);
  const row = rows[0];
  if (!row) throw new ApiError(500, 'INTERNAL');
  return { id: row.id, number: Number(row.number), state: row.state };
}

/**
 * The member's send inside ONE transaction, for either content (D-846): the active case or its lazy creation (the
 * category and the subject written only by the statement that creates it), the participant row, the message. A
 * recording takes exactly the path text takes, so the case transitions, the numbering and the signals are the same.
 */
async function supportSendInTx(
  tx: Tx,
  ctx: RequestContext,
  input: { category?: ChatCaseCategory | undefined; subject?: string | undefined },
  content: MessageContent,
): Promise<SendResult> {
  const existing = await activeCaseOf(tx, ctx);
  let conversationId = existing?.id ?? null;
  let opened = false;
  if (!conversationId) {
    // The category and the subject are written ONLY by the statement that creates the case (D-812, EP-031): a
    // conflicting insert applies none of them, so two devices racing never mix fields. The priority, the state and
    // the owner are never sent from here: the defaults trigger makes the case born open, normal and unowned.
    const created = await tx.execute<{ id: string }>(sql`
        insert into chat_conversations (tenant_id, kind, created_by_user_id, category, subject)
        values (${ctx.tenantId}::uuid, 'support', ${ctx.userId}::uuid,
                ${input.category ?? 'other'}::text, ${input.subject ?? null}::text)
        on conflict (tenant_id, created_by_user_id)
          where kind = 'support' and state in (${ACTIVE_CASE_STATES}) do nothing
        returning id`);
    opened = created.length > 0;
    conversationId = created[0]?.id ?? (await activeCaseOf(tx, ctx))?.id ?? null;
  }
  if (!conversationId) throw new ApiError(500, 'INTERNAL');
  // A message that goes to a RESOLVED case moves it back to open (the message trigger); never both flags.
  const reopened = !opened && existing?.state === 'resolved';
  await tx.execute(sql`
      insert into chat_participants (conversation_id, tenant_id, user_id, role)
      values (${conversationId}::uuid, ${ctx.tenantId}::uuid, ${ctx.userId}::uuid, 'member')
      on conflict (conversation_id, user_id) do nothing`);
  const message = await insertMessage(tx, ctx, conversationId, 'member', content);
  const landed = await caseOfSend(tx, ctx, conversationId);
  return {
    conversationId,
    message,
    case: { id: landed.id, number: landed.number, state: landed.state, opened, reopened },
  };
}

/** One attempt of the member's text send, in ITS OWN transaction (a raised CS004 aborts the Postgres transaction). */
async function sendSupportMessageOnce(
  ctx: RequestContext,
  input: SupportSendInput,
): Promise<SendResult> {
  return withTenantTx(ctx, (tx) =>
    supportSendInTx(tx, ctx, input, { kind: 'text', body: input.body }),
  );
}

/**
 * `POST /v1/chat/support/messages` (CHAT-02, D-220, D-801, D-802, D-811, D-812): the member writes to the team.
 *
 * The member's ACTIVE case (state open, in_progress or resolved) takes the message. With none, the case is
 * created LAZILY, here, on the first message: in ONE transaction it is inserted with `on conflict … do
 * nothing` on the partial unique index `chat_conversations_one_active_case_per_member`, read back, the
 * member's participant row is ensured, and the message is inserted. Twenty concurrent first messages
 * therefore create exactly one case: every loser of the insert race waits on the winner's index entry,
 * does nothing, and reads the committed row. `body` arrives trimmed and bounded (`chatBodySchema`).
 *
 * A case the team closed while the member was typing refuses the message in the database (SQLSTATE CS004,
 * the message trigger, D-845). That aborts the transaction, so the retry is NEVER in the same one: the send
 * runs at most twice, each attempt in its own `withTenantTx`, and the second attempt opens a NEW case (the
 * closed one no longer counts at the index), so the message never lands in a closed case. A second refusal
 * in a row is a 409.
 *
 * The `chat.message_sent` event is queued AFTER the transaction returned (once, for the attempt that
 * committed), so a rolled-back send notifies nobody.
 */
export async function sendSupportMessage(
  ctx: RequestContext,
  input: SupportSendInput,
): Promise<SendResult> {
  let result: SendResult | undefined;
  for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
    try {
      result = await sendSupportMessageOnce(ctx, input);
    } catch (error) {
      if (bodyCheckViolated(error)) {
        throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'body_required' });
      }
      if (sqlstateOf(error) === 'CS004') {
        if (attempt === 1) throw new ApiError(409, 'CONFLICT');
        continue;
      }
      throw error;
    }
  }
  if (!result) throw new ApiError(500, 'INTERNAL');

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

/** The `23505` of the single-use index: another request already stored this take (VOICE-18). */
function assetIndexViolated(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== null && current !== undefined && !seen.has(current)) {
    seen.add(current);
    const candidate = current as { code?: unknown; constraint_name?: unknown; cause?: unknown };
    if (
      candidate.code === '23505' &&
      candidate.constraint_name === 'chat_messages_tenant_media_asset_uq'
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** The answer for a take that is ALREADY stored: the same shape, never opening or reopening anything (VOICE-18). */
async function storedVoiceResult(
  tx: Tx,
  ctx: RequestContext,
  stored: { id: string; conversationId: string },
): Promise<SendResult> {
  const message = await insertedMessage(tx, ctx, stored.conversationId, stored.id);
  const landed = await caseOfSend(tx, ctx, stored.conversationId);
  return {
    conversationId: stored.conversationId,
    message,
    case: {
      id: landed.id,
      number: landed.number,
      state: landed.state,
      opened: false,
      reopened: false,
    },
  };
}

/**
 * One attempt of the member's voice send, in ITS OWN transaction. The order is the text order (D-862): the
 * idempotent read of the caller's own message for the asset, then the asset validation (every refusal BEFORE any
 * case write), then the unchanged case flow and the insert. `fresh` tells the caller whether THIS call stored the
 * message, so only a stored one emits `chat.message_sent`.
 */
async function sendSupportVoiceOnce(
  ctx: RequestContext,
  input: VoiceSendInput,
): Promise<{ result: SendResult; fresh: boolean }> {
  return withTenantTx(ctx, async (tx) => {
    const prior = await storedVoiceMessage(tx, ctx, input.mediaId);
    if (prior) return { result: await storedVoiceResult(tx, ctx, prior), fresh: false };
    await assertVoiceUsable(tx, ctx, input.mediaId);
    const result = await supportSendInTx(tx, ctx, input, {
      kind: 'voice',
      mediaAssetId: input.mediaId,
    });
    return { result, fresh: true };
  });
}

/**
 * `POST /v1/chat/support/voice-messages` (D-866, D-861, D-862, VOICE-04, VOICE-05, VOICE-18, VOICE-31): the member
 * sends ONE recording as a message. It goes through the same case flow as text (a first recording may open the
 * case with its category and subject, one to a resolved case reopens it, one after a close opens a NEW case), gets
 * the gapless `seq`, the signals and `chat.message_sent` with the ids-only payload of text.
 *
 * Idempotent per take, with no client key: a repeat answers the stored message (`opened` and `reopened` false, no
 * second event). A concurrent double send loses on the single-use index (`23505`); that aborted the transaction,
 * so the loser re-reads in a NEW one. A closed case that closes under the send is the CS004 retry of text.
 */
export async function sendSupportVoiceMessage(
  ctx: RequestContext,
  input: VoiceSendInput,
): Promise<SendResult> {
  let outcome: { result: SendResult; fresh: boolean } | undefined;
  for (let attempt = 0; attempt < 2 && !outcome; attempt += 1) {
    try {
      outcome = await sendSupportVoiceOnce(ctx, input);
    } catch (error) {
      if (assetIndexViolated(error)) {
        const stored = await withTenantTx(ctx, async (tx) => {
          const prior = await storedVoiceMessage(tx, ctx, input.mediaId);
          return prior ? storedVoiceResult(tx, ctx, prior) : null;
        });
        if (!stored) throw error;
        outcome = { result: stored, fresh: false };
        continue;
      }
      if (sqlstateOf(error) === 'CS004') {
        if (attempt === 1) throw new ApiError(409, 'CONFLICT');
        continue;
      }
      throw error;
    }
  }
  if (!outcome) throw new ApiError(500, 'INTERNAL');
  const { result, fresh } = outcome;

  if (fresh) {
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
        voice: true,
      },
      'chat message sent',
    );
  }
  return result;
}

/**
 * `GET /v1/chat/support` (D-220, D-803): the member's ACTIVE case, READ-ONLY. When every case they had is
 * closed, or before the first message, there is none and the answer is
 * `{ conversation: null, messages: [], hasOlder: false, case: null, hasAnyCase }`; this GET never writes (the
 * 06-06 prefetch rule), so opening the screen never fills the staff inbox with an empty thread. Otherwise it
 * answers the member's read position, the latest page of that case and its member-shaped `case` (no priority,
 * owner or history, UI-D-835).
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
         and c.created_by_user_id = ${ctx.userId}::uuid
         and c.state in (${ACTIVE_CASE_STATES})
       order by c.case_number desc nulls last
       limit 1`);
    const conversation = rows[0];
    if (!conversation) {
      return {
        conversation: null,
        messages: [],
        hasOlder: false,
        case: null,
        hasAnyCase: await hasAnyCaseOf(tx, ctx),
      };
    }
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
      case: await activeMemberCase(tx, ctx),
      hasAnyCase: true,
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
 * The lookup and the member-state refusals shared by BOTH staff replies (text and voice, D-862): the support
 * conversation of the caller's tenant locked `for update` (an unknown, foreign, direct or group id is ONE bare 404),
 * then `member_blocked` and `member_removed` (both 409). Everything below these refusals is the caller's own.
 */
async function lockSupportConversation(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
): Promise<void> {
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
}

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
      await lockSupportConversation(tx, ctx, conversationId);
      const message = await insertMessage(tx, ctx, conversationId, 'staff', { kind: 'text', body });
      return { conversationId, message };
    });
  } catch (error) {
    if (bodyCheckViolated(error)) {
      throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'body_required' });
    }
    // 12.4 (CASE-07, UI-D-828): the message trigger refuses a message to a CLOSED case with CS004. A blocked or removed
    // member was already answered above (those win over closed), and the refused insert rolled the transaction back.
    if (sqlstateOf(error) === 'CS004') {
      throw new ApiError(409, 'CONFLICT', { chat: 'case_closed' });
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

/**
 * The stored recording the caller already sent, answered in the shipped staff shape. A take is usable ONCE per
 * tenant (single-use index), so a stored message that sits in ANOTHER conversation means the asset is spent for this
 * one: the same `voice_invalid` as an asset another staff member owns.
 */
async function storedStaffVoiceResult(
  tx: Tx,
  ctx: RequestContext,
  conversationId: string,
  mediaId: string,
): Promise<SendResult | null> {
  const prior = await storedVoiceMessage(tx, ctx, mediaId);
  if (!prior) return null;
  if (prior.conversationId !== conversationId) {
    throw new ApiError(400, 'VALIDATION_FAILED', { chat: 'voice_invalid' });
  }
  return { conversationId, message: await insertedMessage(tx, ctx, conversationId, prior.id) };
}

/**
 * `POST /v1/chat/conversations/{id}/voice-messages` (D-866, D-847, D-862, VOICE-18, VOICE-32): any staff member
 * answers a support conversation with ONE recording of their own. The order is the text reply's, asserted by the
 * tests: 1. the `for update` lookup of a support conversation of the tenant (bare 404), 2. `member_blocked`,
 * 3. `member_removed`, then the idempotent read of the caller's own message for the asset, 4. the asset validation
 * (`voice_not_ready` 409, `voice_invalid` 400), 5. the insert, which is where a closed case refuses
 * (`409 case_closed`, the CS004 of the text path). No check of the case state runs before the insert, so an asset
 * refusal wins over a closed case. The take-on-reply and the no-reopen rules are the message trigger's (it reads no
 * body), so a recording moves the case exactly as text does.
 *
 * Idempotent per take: a repeated or concurrent send of the same asset answers the stored message and stores one
 * row; the loser of a concurrent double send (`23505` of the single-use index) re-reads in a NEW transaction. Only
 * the call that stored the message emits `chat.message_sent`.
 */
export async function replyVoiceToConversation(
  ctx: RequestContext,
  conversationId: string,
  input: VoiceReplyInput,
): Promise<SendResult> {
  let outcome: { result: SendResult; fresh: boolean };
  try {
    outcome = await withTenantTx(ctx, async (tx) => {
      await lockSupportConversation(tx, ctx, conversationId);
      const prior = await storedStaffVoiceResult(tx, ctx, conversationId, input.mediaId);
      if (prior) return { result: prior, fresh: false };
      await assertVoiceUsable(tx, ctx, input.mediaId);
      const message = await insertMessage(tx, ctx, conversationId, 'staff', {
        kind: 'voice',
        mediaAssetId: input.mediaId,
      });
      return { result: { conversationId, message }, fresh: true };
    });
  } catch (error) {
    if (assetIndexViolated(error)) {
      const stored = await withTenantTx(ctx, (tx) =>
        storedStaffVoiceResult(tx, ctx, conversationId, input.mediaId),
      );
      if (!stored) throw error;
      return stored;
    }
    // The message trigger refuses a message to a CLOSED case with CS004 (raised only by the insert, as for text).
    if (sqlstateOf(error) === 'CS004') {
      throw new ApiError(409, 'CONFLICT', { chat: 'case_closed' });
    }
    throw error;
  }

  if (outcome.fresh) {
    emit(ctx, 'chat.message_sent', {
      tenantId: ctx.tenantId,
      conversationId,
      messageId: outcome.result.message.id,
      seq: outcome.result.message.seq,
      authorUserId: ctx.userId,
      authorSide: 'staff',
    });
    log.info(
      {
        event: 'chat.message_sent',
        tenantId: ctx.tenantId,
        conversationId,
        seq: outcome.result.message.seq,
        side: 'staff',
        voice: true,
      },
      'chat message sent',
    );
  }
  return outcome.result;
}

/* ── 07-08 Task 3: the staff side and the badges ────────────────────────────────────────────────── */

/**
 * The member behind a support thread, projected for STAFF (the feed's author rule): the member's
 * membership in THIS tenant, whatever its state, and its profile. A soft-deleted or missing
 * membership is `removed` with every identity field null (UI-D-24); a blocked one keeps its name.
 * The avatar id is nulled when the asset is gone (`media_assets_tenant_select` hides a retired one).
 */
const memberIdentity = sql`
           case
             when ms.id is null or ms.deleted_at is not null then 'removed'
             when ms.blocked_at is not null or ms.status = 'blocked' then 'blocked'
             else 'active'
           end as member_state,
           case when ms.deleted_at is null then ms.id end as member_membership_id,
           case when ms.deleted_at is null then mp.display_name end as member_display_name,
           case when ms.deleted_at is null and a.id is not null then mp.avatar_asset_id end
             as member_avatar_asset_id`;

const memberJoins = sql`
      left join memberships ms
             on ms.tenant_id = c.tenant_id
            and ms.user_id = c.created_by_user_id
      left join member_profiles mp on mp.membership_id = ms.id
      left join media_assets a on a.id = mp.avatar_asset_id`;

type MemberIdentityRow = {
  member_state: MemberState;
  member_membership_id: string | null;
  member_display_name: string | null;
  member_avatar_asset_id: string | null;
};

const toMember = (row: MemberIdentityRow): ConversationMember =>
  row.member_state === 'removed'
    ? { membershipId: null, displayName: null, avatarAssetId: null, state: 'removed' }
    : {
        membershipId: row.member_membership_id,
        displayName: row.member_display_name,
        avatarAssetId: row.member_avatar_asset_id,
        state: row.member_state,
      };

/**
 * `GET /v1/chat/conversations/{id}` (D-224): staff get the member behind the thread and the team's
 * read position; the thread's member gets their own position. Anyone else (another member, another
 * tenant, an unknown id, or staff on a non-support conversation) gets one bare 404.
 */
export async function getConversation(
  ctx: RequestContext,
  conversationId: string,
): Promise<ConversationDetail> {
  const permissions = await permissionsForRequest(ctx);
  const staff = permissions.includes(CHAT_PERMISSIONS.answer);
  return withTenantTx(ctx, async (tx) => {
    if (staff) {
      const rows = await tx.execute<
        MemberIdentityRow & { id: string; last_seq: number; staff_last_read_seq: number }
      >(sql`
        select c.id,
               c.last_seq::int as last_seq,
               c.staff_last_read_seq::int as staff_last_read_seq,
               ${memberIdentity}
          from chat_conversations c
          ${memberJoins}
         where c.id = ${conversationId}::uuid
           and c.tenant_id = ${ctx.tenantId}::uuid
           and c.kind = 'support'`);
      const row = rows[0];
      if (!row) throw new ApiError(404, 'NOT_FOUND');
      // 12.4: the case with the list of actions THIS viewer may take, decided from the viewer's permissions (D-842).
      const staffCase = await staffCaseOf(tx, ctx, row.id, permissions);
      return {
        viewer: 'staff',
        id: row.id,
        member: toMember(row),
        lastSeq: Number(row.last_seq),
        staffLastReadSeq: Number(row.staff_last_read_seq),
        ...(staffCase ? { case: staffCase } : {}),
      };
    }
    const rows = await tx.execute<{
      id: string;
      last_seq: number;
      last_staff_seq: number;
      last_read_seq: number;
    }>(sql`
      select c.id,
             c.last_seq::int as last_seq,
             c.last_staff_seq::int as last_staff_seq,
             p.last_read_seq::int as last_read_seq
        from chat_conversations c
        join chat_participants p
          on p.conversation_id = c.id
         and p.tenant_id = c.tenant_id
         and p.user_id = ${ctx.userId}::uuid
       where c.id = ${conversationId}::uuid
         and c.tenant_id = ${ctx.tenantId}::uuid`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    // 12.4: the member-shaped case of ANY case of theirs, a closed one included (it reads read-only).
    const memberCase = await memberCaseOf(tx, ctx, row.id);
    return {
      viewer: 'member',
      id: row.id,
      lastSeq: Number(row.last_seq),
      lastReadSeq: Number(row.last_read_seq),
      lastStaffSeq: Number(row.last_staff_seq),
      ...(memberCase ? { case: memberCase } : {}),
    };
  });
}

/**
 * `POST /v1/chat/conversations/{id}/read { seq }` (D-225, D-237, D-238): the caller has seen the
 * thread up to `seq`. Positions only move FORWARD and never past the conversation's `last_seq`, so a
 * stale or forged seq can neither un-read a thread nor pre-read a message that does not exist yet.
 *
 * - **Staff** (`chat.support`) move the TEAM's shared position,
 *   `staff_last_read_seq = greatest(staff_last_read_seq, least(seq, last_seq))`: one staff read clears
 *   "awaiting" for every staff member. When it moved, `chat.read` is signalled on `support-inbox` so
 *   every staff badge and inbox refetches.
 * - **The thread's member** moves their participant row's `last_read_seq` the same way and stamps
 *   `last_read_at`. When it moved, `chat.unread` is signalled on their own user topic so their other
 *   devices clear the dot.
 *
 * Both signals are published by the definer inside this transaction (ids only). Any other caller, or
 * an unknown or foreign id, is one bare 404.
 */
export async function markConversationRead(
  ctx: RequestContext,
  conversationId: string,
  seq: number,
): Promise<void> {
  const staff = await isStaff(ctx);
  await withTenantTx(ctx, async (tx) => {
    if (staff) {
      const rows = await tx.execute<{ prior: number; current_seq: number }>(sql`
        with target as (
          select c.id, c.staff_last_read_seq as prior
            from chat_conversations c
           where c.id = ${conversationId}::uuid
             and c.tenant_id = ${ctx.tenantId}::uuid
             and c.kind = 'support'
             for update
        )
        update chat_conversations c
           set staff_last_read_seq = greatest(c.staff_last_read_seq, least(${seq}::bigint, c.last_seq))
          from target
         where c.id = target.id
        returning target.prior::int as prior, c.staff_last_read_seq::int as current_seq`);
      const row = rows[0];
      if (!row) throw new ApiError(404, 'NOT_FOUND');
      if (Number(row.current_seq) > Number(row.prior)) {
        await tx.execute(
          sql`select app.realtime_signal(${topicSuffix.inbox()}, ${REALTIME_EVENTS.chatRead}, ${JSON.stringify({ conversationId, seq: Number(row.current_seq) })}::jsonb)`,
        );
      }
      return;
    }
    const rows = await tx.execute<{ prior: number; current_seq: number }>(sql`
      with target as (
        select p.conversation_id, p.last_read_seq as prior, c.last_seq
          from chat_participants p
          join chat_conversations c
            on c.id = p.conversation_id
           and c.tenant_id = p.tenant_id
         where p.conversation_id = ${conversationId}::uuid
           and p.tenant_id = ${ctx.tenantId}::uuid
           and p.user_id = ${ctx.userId}::uuid
           for update of p
      )
      update chat_participants p
         set last_read_seq = greatest(p.last_read_seq, least(${seq}::bigint, target.last_seq)),
             last_read_at = now()
        from target
       where p.conversation_id = target.conversation_id
         and p.tenant_id = ${ctx.tenantId}::uuid
         and p.user_id = ${ctx.userId}::uuid
      returning target.prior::int as prior, p.last_read_seq::int as current_seq`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    if (Number(row.current_seq) > Number(row.prior)) {
      await tx.execute(
        sql`select app.realtime_signal(${topicSuffix.user(ctx.userId)}, ${REALTIME_EVENTS.chatUnread}, ${JSON.stringify({ conversationId, seq: Number(row.current_seq) })}::jsonb)`,
      );
    }
  });
}

/**
 * A cursor's `n` must be an instant this service could have issued before it reaches a
 * `::timestamptz` cast (T-06-04): a tampered `n` degrades to page 1, never a 500.
 */
const CURSOR_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?Z$/;

/**
 * A cursor of a thread that has no message yet (`last_message_at` null, which sorts FIRST): the instant slot carries
 * this literal instead of an instant, so a walk can continue PAST such a row without skipping or repeating (EP-053).
 */
const CURSOR_NO_INSTANT = 'none';

function decodeInstantCursor(raw: string | undefined) {
  const decoded = decodeCursor(raw);
  if (!decoded) return null;
  if (decoded.n === CURSOR_NO_INSTANT) return decoded;
  const match = CURSOR_INSTANT.exec(decoded.n);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid =
    year >= 1000 &&
    at.getUTCFullYear() === year &&
    at.getUTCMonth() === month - 1 &&
    at.getUTCDate() === day &&
    at.getUTCHours() === hour &&
    at.getUTCMinutes() === minute &&
    at.getUTCSeconds() === second;
  return valid ? decoded : null;
}

type InboxDbRow = MemberIdentityRow & {
  id: string;
  last_message_at: string | null;
  awaiting: boolean;
  lm_seq: number | null;
  lm_body: string | null;
  lm_voice_seconds: number | null;
  lm_voice_gone: boolean | null;
  lm_side: ChatSide | null;
  lm_author_name: string | null;
  case_number: number | null;
  case_state: ChatCaseState | null;
  case_subject: string | null;
  case_category: ChatCaseCategory | null;
  case_priority: ChatCasePriority | null;
  first_body: string | null;
  first_is_voice: boolean;
  owner_name: string | null;
  owner_is_viewer: boolean;
};

const toInboxRow = (row: InboxDbRow): InboxRow => {
  const caseFacts = toInboxCase({
    case_number: row.case_number,
    state: row.case_state,
    subject: row.case_subject,
    first_body: row.first_body,
    first_is_voice: row.first_is_voice,
    category: row.case_category,
    priority: row.case_priority,
    owner_name: row.owner_name,
    owner_is_viewer: row.owner_is_viewer,
  });
  return {
    conversationId: row.id,
    member: toMember(row),
    lastMessage:
      row.lm_seq === null || row.lm_side === null
        ? null
        : {
            seq: Number(row.lm_seq),
            ...lastMessagePreview(row.lm_body, row.lm_voice_seconds, row.lm_voice_gone === true),
            side: row.lm_side,
            authorFirstName: row.lm_side === 'staff' ? firstNameOf(row.lm_author_name) : null,
          },
    lastMessageAt: row.last_message_at,
    awaiting: row.awaiting,
    ...(caseFacts ? { case: caseFacts } : {}),
  };
};

/**
 * `GET /v1/chat/inbox?tab=&owner=&priority=&awaiting=&cursor=&limit=` (CHAT-03, CASE-16, D-221, D-224, D-805, D-809):
 * the support cases of the tenant, most recent activity first (`last_message_at desc, id desc`, so an exact tie on the
 * instant is broken by id and a `limit=1` walk visits each thread once). The ORDER never depends on a filter.
 *
 * The tab is a COMPLETE literal predicate chosen in TypeScript, never a bound value (the `pageOf` rule): `open` is
 * `state in ('open','in_progress')` so the partial index `chat_conversations_open_inbox_idx` can serve it, `resolved`
 * and `closed` read `chat_conversations_inbox_idx` (pgTAP 152 fact 7 explains each by name). The owner, priority and
 * awaiting filters are bound values the closed query schema already validated; a bad value degraded to its default
 * there. `awaiting` (the latest message is the member's and the team has not read up to it) only applies on the open
 * tab, so with no other filter it counts the same as the staff badge (UI-D-823).
 *
 * Per row: the member, the latest message as a one-line preview, the instant, `awaiting` and the case facts (number,
 * state, label, category, priority, the owner's NAME). Over-fetch by one decides `nextCursor`.
 */
export async function listInbox(ctx: RequestContext, query: InboxQuery): Promise<InboxPage> {
  const limit = query.limit;
  const after = decodeInstantCursor(query.cursor);
  const afterAt = after?.n === CURSOR_NO_INSTANT ? null : (after?.n ?? null);
  const afterId = after?.id ?? null;
  const afterNoInstant = after?.n === CURSOR_NO_INSTANT;

  const tabPredicate =
    query.tab === 'resolved'
      ? sql`c.state = 'resolved'`
      : query.tab === 'closed'
        ? sql`c.state = 'closed'`
        : sql`c.state in ('open','in_progress')`;
  const ownerPredicate =
    query.owner === 'me'
      ? sql`and c.owner_user_id = ${ctx.userId}::uuid`
      : query.owner === 'none'
        ? sql`and c.owner_user_id is null`
        : query.owner !== undefined
          ? sql`and c.owner_user_id = ${query.owner}::uuid`
          : sql``;
  const priorityPredicate =
    query.priority !== undefined ? sql`and c.priority = ${query.priority}::text` : sql``;
  const awaitingPredicate =
    query.awaiting && query.tab === 'open'
      ? sql`and c.last_message_side = 'member' and c.last_seq > c.staff_last_read_seq`
      : sql``;
  const keysetPredicate = afterNoInstant
    ? sql`and ((c.last_message_at is null and c.id < ${afterId}::uuid) or c.last_message_at is not null)`
    : sql`and (
           ${afterAt}::timestamptz is null
           or (c.last_message_at, c.id) < (${afterAt}::timestamptz, ${afterId}::uuid)
         )`;

  const rows = await withTenantTx(ctx, (tx) =>
    tx.execute<InboxDbRow>(sql`
      select c.id,
             to_char(c.last_message_at at time zone 'utc', ${ISO_MICROSECONDS}) as last_message_at,
             coalesce(c.last_message_side = 'member' and c.last_seq > c.staff_last_read_seq, false) as awaiting,
             ${memberIdentity},
             lm.seq::int as lm_seq,
             lm.body as lm_body,
             lm.voice_seconds::int as lm_voice_seconds,
             lm.voice_gone as lm_voice_gone,
             lm.author_side as lm_side,
             lmp.display_name as lm_author_name,
             c.case_number::int as case_number,
             c.state as case_state,
             c.subject as case_subject,
             c.category as case_category,
             c.priority as case_priority,
             fm.body as first_body,
             fm.voice_seconds is not null as first_is_voice,
             omp.display_name as owner_name,
             (c.owner_user_id is not null and c.owner_user_id = ${ctx.userId}::uuid) as owner_is_viewer
        from chat_conversations c
        ${memberJoins}
        ${ownerJoins}
        ${firstMessageJoin}
        left join lateral (
          select m.seq, m.body, m.voice_seconds, m.author_side, m.author_user_id,
                 ${voiceGoneSql('m')} as voice_gone
            from chat_messages m
           where m.tenant_id = c.tenant_id
             and m.conversation_id = c.id
             and m.deleted_at is null
           order by m.seq desc
           limit 1
        ) lm on true
        left join memberships lms
               on lm.author_side = 'staff'
              and lms.tenant_id = c.tenant_id
              and lms.user_id = lm.author_user_id
              and lms.deleted_at is null
        left join member_profiles lmp on lmp.membership_id = lms.id
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'support'
         and ${tabPredicate}
         ${ownerPredicate}
         ${priorityPredicate}
         ${awaitingPredicate}
         ${keysetPredicate}
       order by c.last_message_at desc, c.id desc
       limit ${limit + 1}`),
  );
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? encodeCursor({ n: last.last_message_at ?? CURSOR_NO_INSTANT, id: last.id })
      : null;
  log.info(
    {
      event: 'chat.inbox',
      tenantId: ctx.tenantId,
      requestId: ctx.requestId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'chat inbox listed',
  );
  return { items: page.map(toInboxRow), nextCursor };
}

/**
 * The chat module's share of `bootstrap.counters` (D-237, D-238, D-840), inside the caller's tenant lane,
 * decided by the caller's composed PERMISSIONS (planning decision 4), never by a role literal. "Active" means
 * `state <> 'closed'` (D-840): a closed case never lights a badge or a dot, whatever is unread in it. Every
 * comparison is of integer sequences and of the exact lowercase state literal, so nothing is normalised (EP-055):
 * - `chat.support` (staff): `count` = ACTIVE support cases awaiting the team, i.e. the latest message is
 *   the member's and the team's shared position is below it, whoever owns the case (D-238);
 * - `chat.support.contact` (member): `dot` = 1 exactly while the team wrote something past the
 *   member's own read position in a case that is not closed, else 0;
 * - neither: nothing (the zeros stand).
 */
export async function chatCounters(
  tx: Tx,
  ctx: RequestContext,
  permissions: readonly string[],
): Promise<Partial<Counters>> {
  if (permissions.includes(CHAT_PERMISSIONS.answer)) {
    const rows = await tx.execute<{ awaiting: number }>(sql`
      select count(*)::int as awaiting
        from chat_conversations c
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'support'
         and c.state <> 'closed'
         and c.last_message_side = 'member'
         and c.last_seq > c.staff_last_read_seq`);
    return { unreadConversations: Number(rows[0]?.awaiting ?? 0), conversationsBadge: 'count' };
  }
  if (permissions.includes(CHAT_PERMISSIONS.contact)) {
    const rows = await tx.execute<{ unread: boolean }>(sql`
      select exists (
        select 1
          from chat_conversations c
          join chat_participants p
            on p.conversation_id = c.id
           and p.tenant_id = c.tenant_id
           and p.user_id = ${ctx.userId}::uuid
         where c.tenant_id = ${ctx.tenantId}::uuid
           and c.kind = 'support'
           and c.created_by_user_id = ${ctx.userId}::uuid
           and c.state <> 'closed'
           and c.last_staff_seq > p.last_read_seq
      ) as unread`);
    return { unreadConversations: rows[0]?.unread ? 1 : 0, conversationsBadge: 'dot' };
  }
  return {};
}
