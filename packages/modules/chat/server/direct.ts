import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { emit } from '@rede-social/core/server/events/bus';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import {
  directConversationLimiter,
  directMessageLimiter,
  safetyLimiterKey,
} from '@rede-social/core/server/safety/limits';
import { sqlstateOf } from '@rede-social/core/server/safety/sqlstate';
import { sql } from 'drizzle-orm';
import type {
  DirectComposerState,
  DirectSendInput,
  DirectSendResult,
  DirectWithAnswer,
} from '../contracts/index';
import { bodyCheckViolated, insertMessage } from './service';

const log = moduleLogger('module-chat');

/**
 * The direct conversation between two members (Phase 11, CHAT-06; D-719, D-720, D-722). A PURE TENANT-LANE area like the
 * rest of the chat service: every read and write is `withTenantTx(ctx, …)`, and the tenant and the author are never
 * parameters a caller supplies. The DATABASE decides who may talk to whom: `app.direct_conversation_open` (plan 03) is the
 * only creator of a direct conversation and the `chat_messages` BEFORE INSERT trigger (plan 06) is the send guard, both
 * refusing with the single SQLSTATE `DM001`. This file resolves a MEMBERSHIP id to a live member, spends the limiters and
 * projects the answers; it never computes a block.
 *
 * T-11-06 (no member-id oracle): the target is resolved by membership id in the caller's lane and EVERY miss (staff, the
 * caller's own membership, another tenant's, an administrator-blocked or removed member, an unknown id) is ONE bare
 * `404 NOT_FOUND`. A pair with a member block between them is NOT a miss at this layer: the database refuses the send with
 * `DM001` and the answer is `409 CONFLICT` with the one word `direct_closed` (T-11-03).
 *
 * Logs carry the SHAPE of a call (ids, seq, side), never a body or a name.
 */

/** The live `member` a membership id names in the caller's tenant (never staff, never the caller). */
export type DirectTarget = {
  membershipId: string;
  userId: string;
  displayName: string | null;
  avatarAssetId: string | null;
};

/**
 * The target of a direct call, read in the lane. A flat conjunction on purpose (the `social` posture): role `member`,
 * active, not blocked by the administrator, not removed, in the CALLER's tenant, and not the caller. The avatar id is
 * nulled when the asset is gone (a retired asset is hidden by its policy and by the explicit `deleted_at`).
 */
export async function resolveDirectTarget(
  tx: Tx,
  ctx: RequestContext,
  membershipId: string,
): Promise<DirectTarget> {
  const rows = await tx.execute<{
    membership_id: string;
    user_id: string;
    display_name: string | null;
    avatar_asset_id: string | null;
  }>(sql`
    select m.id as membership_id,
           m.user_id,
           mp.display_name,
           case when a.id is not null then mp.avatar_asset_id end as avatar_asset_id
      from memberships m
      left join member_profiles mp on mp.membership_id = m.id
      left join media_assets a on a.id = mp.avatar_asset_id and a.deleted_at is null
     where m.id = ${membershipId}::uuid
       and m.tenant_id = ${ctx.tenantId}::uuid
       and m.role = 'member'
       and m.status = 'active'
       and m.blocked_at is null
       and m.deleted_at is null
       and m.user_id <> ${ctx.userId}::uuid
     limit 1`);
  const row = rows[0];
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    displayName: row.display_name,
    avatarAssetId: row.avatar_asset_id,
  };
}

/**
 * The conversation of the pair, or null: the lane read (the select policy hides a closed one), pinned to the tenant, on
 * the ordered pair columns (`least` and `greatest` on the uuid type, the byte order the database encodes).
 */
export async function directConversationOf(
  tx: Tx,
  ctx: RequestContext,
  otherUserId: string,
): Promise<string | null> {
  const rows = await tx.execute<{ id: string }>(sql`
    select c.id
      from chat_conversations c
     where c.tenant_id = ${ctx.tenantId}::uuid
       and c.kind = 'direct'
       and c.direct_low_user_id = least(${ctx.userId}::uuid, ${otherUserId}::uuid)
       and c.direct_high_user_id = greatest(${ctx.userId}::uuid, ${otherUserId}::uuid)
     limit 1`);
  return rows[0]?.id ?? null;
}

/**
 * `POST /v1/chat/direct/messages` (CHAT-06, D-720, D-722, D-734): the caller writes to another member by membership id.
 *
 * Order, every refusal BEFORE any write: (1) the per-member send limiter (every attempt counts, `429 RATE_LIMITED`);
 * (2) ONE `withTenantTx` that resolves the target (a miss is the bare 404), reads whether the pair already has a
 * conversation, spends the new-conversation limiter only when it has none, then selects `app.direct_conversation_open`
 * and inserts the message through the SAME `insertMessage` the support send uses, so the conversation and its first
 * message commit or roll back together and no conversation without a message exists. Twenty concurrent first sends make
 * one conversation: the definer's `on conflict` arbiter lets the losers read the winner's id, and the message trigger
 * serialises the `seq` under the conversation row lock.
 *
 * A send the database refuses (`DM001`: a block either way, `social` off, the other member no longer live) is `409
 * CONFLICT` with `details.chat = 'direct_closed'` and nothing else; the transaction rolled back, so neither the
 * conversation nor the message exists. A `42501` (the caller stopped being live between the guard and the statement) is a
 * plain `403 FORBIDDEN`, never a module or a block word.
 *
 * `chat.message_sent` is queued AFTER the transaction returned (once), with the same ids-only payload as the support send
 * and `authorSide: 'member'`; a rolled-back send notifies nobody. The push for the recipient is plan 13's.
 */
export async function sendDirectMessage(
  ctx: RequestContext,
  input: DirectSendInput,
): Promise<DirectSendResult> {
  const limiterKey = safetyLimiterKey(ctx);
  if (!directMessageLimiter.consume(limiterKey)) throw new ApiError(429, 'RATE_LIMITED');

  let result: DirectSendResult;
  try {
    result = await withTenantTx(ctx, async (tx) => {
      const target = await resolveDirectTarget(tx, ctx, input.toMembershipId);
      const existing = await directConversationOf(tx, ctx, target.userId);
      if (!existing && !directConversationLimiter.consume(limiterKey)) {
        throw new ApiError(429, 'RATE_LIMITED');
      }
      const opened = await tx.execute<{ conversation_id: string; created: boolean }>(sql`
        select conversation_id, created from app.direct_conversation_open(${target.userId}::uuid)`);
      const row = opened[0];
      if (!row) throw new ApiError(500, 'INTERNAL');
      const message = await insertMessage(tx, ctx, row.conversation_id, 'member', {
        kind: 'text',
        body: input.body,
      });
      return { conversationId: row.conversation_id, created: row.created, message };
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const state = sqlstateOf(error);
    if (state === 'DM001') throw new ApiError(409, 'CONFLICT', { chat: 'direct_closed' });
    if (state === '42501') throw new ApiError(403, 'FORBIDDEN');
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
      direct: true,
      created: result.created,
    },
    'direct message sent',
  );
  return result;
}

/**
 * `GET /v1/chat/direct/with/{membershipId}` (CHAT-06, D-720, D-722, UI-D-864, UI-D-865): what the screen of a person needs
 * to draw the conversation or the empty start: the pair's conversation id or null (a GET never creates one), who the other
 * member is and what the composer may do.
 *
 * Every miss (staff, the caller's own membership, another tenant's, an administrator-blocked or removed member, an unknown
 * id) is the ONE bare `404 NOT_FOUND` of the resolver. A pair with a member block is NOT a miss: the answer is 200 and the
 * `composer` word is the only thing that tells the two sides apart: `blocker` for the member who blocked (the strip offers
 * the way to unblock), `closed` for the member who was blocked (a strip that never says why). `app.is_blocked_by_viewer`
 * reads only the CALLER's own block rows, so the blocked side can never learn that a block exists from any field here; the
 * answer carries no "blocked me" flag. A mutual block reads `blocker` (the member can still lift their own).
 *
 * The `removed` composer state is for the list and the detail of plan 10; here a removed member is a miss, so the key is
 * always `false` on a 200.
 */
export async function getDirectWith(
  ctx: RequestContext,
  membershipId: string,
): Promise<DirectWithAnswer> {
  return withTenantTx(ctx, async (tx) => {
    const target = await resolveDirectTarget(tx, ctx, membershipId);
    const conversationId = await directConversationOf(tx, ctx, target.userId);
    const flags = await tx.execute<{ blocker: boolean; closed: boolean }>(sql`
      select app.is_blocked_by_viewer(${target.userId}::uuid) as blocker,
             app.members_blocked_between(${target.userId}::uuid) as closed`);
    const composer: DirectComposerState = flags[0]?.blocker
      ? 'blocker'
      : flags[0]?.closed
        ? 'closed'
        : 'open';
    return {
      conversationId,
      other: {
        membershipId: target.membershipId,
        displayName: target.displayName,
        avatarAssetId: target.avatarAssetId,
        removed: false,
      },
      composer,
    };
  });
}
