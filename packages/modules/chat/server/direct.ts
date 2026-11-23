import { cutOnWord } from '@rede-social/contracts/text';
import { type Tx, withTenantTx } from '@rede-social/core/db/tenant-tx';
import type { RequestContext } from '@rede-social/core/server/auth/context';
import { emit } from '@rede-social/core/server/events/bus';
import { ApiError } from '@rede-social/core/server/http/api-error';
import { moduleLogger } from '@rede-social/core/server/logging';
import { encodeCursor } from '@rede-social/core/server/paging';
import {
  directConversationLimiter,
  directMessageLimiter,
  safetyLimiterKey,
} from '@rede-social/core/server/safety/limits';
import { sqlstateOf } from '@rede-social/core/server/safety/sqlstate';
import { sql } from 'drizzle-orm';
import {
  CHAT_PREVIEW_GRAPHEMES,
  DIRECT_UNREAD_CAP,
  type DirectComposerState,
  type DirectDetail,
  type DirectListAnswer,
  type DirectListQuery,
  type DirectListRow,
  type DirectOther,
  type DirectPreview,
  type DirectSendInput,
  type DirectSendResult,
  type DirectSupportSummary,
  type DirectVoiceSendInput,
  type DirectWithAnswer,
} from '../contracts/index';
import {
  assetIndexViolated,
  bodyCheckViolated,
  CURSOR_NO_INSTANT,
  decodeInstantCursor,
  ISO_MICROSECONDS,
  insertedMessage,
  insertMessage,
  memberSupportUnread,
} from './service';
import { assertVoiceUsable, storedVoiceMessage, voiceGoneSql } from './voice-sql';

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

/** The answer for a take that is ALREADY stored: the same shape, never opening anything (VOICE-18). */
async function storedDirectVoiceResult(
  tx: Tx,
  ctx: RequestContext,
  stored: { id: string; conversationId: string },
): Promise<DirectSendResult> {
  return {
    conversationId: stored.conversationId,
    created: false,
    message: await insertedMessage(tx, ctx, stored.conversationId, stored.id),
  };
}

/**
 * The stored message of a take, answered ONLY for the pair it was sent to (WR-03). `storedVoiceMessage` finds the caller's
 * own message for the asset in ANY conversation (a support case, another member), so the idempotent answer is given only
 * when the named recipient resolves and the pair's conversation IS the stored message's. A take stored anywhere else is the
 * ONE `400 VALIDATION_FAILED { chat: 'voice_invalid' }` of an unusable asset, and so is a recipient that no longer resolves
 * (staff, removed, administrator-blocked, the caller): the refusal is the same body for every cause, so it never reveals a
 * block, a staff target or a removed member (T-11-27). A pair the database closed since reads as no conversation, so it is
 * the same refusal too. Null when the take has no stored message yet.
 */
async function storedDirectVoiceFor(
  tx: Tx,
  ctx: RequestContext,
  input: DirectVoiceSendInput,
): Promise<DirectSendResult | null> {
  const prior = await storedVoiceMessage(tx, ctx, input.mediaId);
  if (!prior) return null;
  const refused = () => new ApiError(400, 'VALIDATION_FAILED', { chat: 'voice_invalid' });
  let conversationId: string | null;
  try {
    const target = await resolveDirectTarget(tx, ctx, input.toMembershipId);
    conversationId = await directConversationOf(tx, ctx, target.userId);
  } catch (error) {
    throw error instanceof ApiError ? refused() : error;
  }
  if (conversationId !== prior.conversationId) throw refused();
  return storedDirectVoiceResult(tx, ctx, prior);
}

/**
 * One attempt of the direct voice send, in ITS OWN transaction. The order is the support voice send's (D-862): the
 * idempotent read of the caller's own message for the asset (answered only for THIS pair, `storedDirectVoiceFor`, WR-03),
 * then the asset validation (every asset refusal BEFORE any conversation write and BEFORE the pair is looked at, so a
 * refusal for the asset never reveals a block, T-11-27), then the target, the limiter for a new conversation,
 * `app.direct_conversation_open` and the insert with the voice content.
 * `fresh` tells the caller whether THIS call stored the message, so only a stored one emits `chat.message_sent`.
 */
async function sendDirectVoiceOnce(
  ctx: RequestContext,
  input: DirectVoiceSendInput,
  limiterKey: string[],
): Promise<{ result: DirectSendResult; fresh: boolean }> {
  return withTenantTx(ctx, async (tx) => {
    const stored = await storedDirectVoiceFor(tx, ctx, input);
    if (stored) return { result: stored, fresh: false };
    await assertVoiceUsable(tx, ctx, input.mediaId);
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
      kind: 'voice',
      mediaAssetId: input.mediaId,
    });
    return {
      result: { conversationId: row.conversation_id, created: row.created, message },
      fresh: true,
    };
  });
}

/**
 * `POST /v1/chat/direct/voice-messages` (CHAT-06, D-734, D-722, VOICE-18): the caller sends ONE recording to another
 * member, by membership id. Nothing is rebuilt: it is the support voice send over the same `storedVoiceMessage`,
 * `assertVoiceUsable` and `insertMessage`, with the pair opened by the same definer as the text send. The duration is the
 * asset's server-measured one (no client duration is accepted) and a recording is one message with no text.
 *
 * Idempotent per take, with no client key: a repeat answers the stored message with `created: false` and emits nothing.
 * A concurrent double send loses on the single-use index (`23505`), which aborted its transaction, so the loser re-reads in
 * a NEW one. A pair the database closed (`DM001`) is `409 CONFLICT { chat: 'direct_closed' }`, the same body as text, and
 * the take stays unused (the orphan sweep of 12.5 retires it).
 *
 * `chat.message_sent` is queued AFTER the transaction returned and only when THIS call stored the message.
 */
export async function sendDirectVoiceMessage(
  ctx: RequestContext,
  input: DirectVoiceSendInput,
): Promise<DirectSendResult> {
  const limiterKey = safetyLimiterKey(ctx);
  if (!directMessageLimiter.consume(limiterKey)) throw new ApiError(429, 'RATE_LIMITED');

  let outcome: { result: DirectSendResult; fresh: boolean };
  try {
    try {
      outcome = await sendDirectVoiceOnce(ctx, input, limiterKey);
    } catch (error) {
      if (!assetIndexViolated(error)) throw error;
      const stored = await withTenantTx(ctx, (tx) => storedDirectVoiceFor(tx, ctx, input));
      if (!stored) throw error;
      outcome = { result: stored, fresh: false };
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const state = sqlstateOf(error);
    if (state === 'DM001') throw new ApiError(409, 'CONFLICT', { chat: 'direct_closed' });
    if (state === '42501') throw new ApiError(403, 'FORBIDDEN');
    throw error;
  }

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
        direct: true,
        voice: true,
        created: result.created,
      },
      'direct voice message sent',
    );
  }
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

/* ── Phase 11, plan 10: the Conversas list and the conversation detail (CHAT-06, CHAT-07; D-719, D-721..D-723) ─── */

/**
 * The OTHER member of a paired conversation, from the caller's side: the pair user that is not the caller, read in the
 * tenant lane. `removed` is an anonymised (or soft-deleted) account, or a membership the lane cannot see: the row stays,
 * read-only, with no id, no name and no avatar (D-721). The avatar id is nulled when the asset is gone. One projection for
 * the list and the detail, so the two never describe the same member differently.
 */
const otherMemberColumns = sql`
           o.user_id as other_user_id,
           (ms.id is null or ms.deleted_at is not null or ms.anonymised_at is not null) as other_removed,
           case when ms.id is not null and ms.deleted_at is null and ms.anonymised_at is null then ms.id end
             as other_membership_id,
           case when ms.id is not null and ms.deleted_at is null and ms.anonymised_at is null
                then mp.display_name end as other_display_name,
           case when ms.id is not null and ms.deleted_at is null and ms.anonymised_at is null and a.id is not null
                then mp.avatar_asset_id end as other_avatar_asset_id`;

const otherMemberJoins = (ctx: RequestContext) => sql`
      cross join lateral (
        select case when c.direct_low_user_id = ${ctx.userId}::uuid
                    then c.direct_high_user_id else c.direct_low_user_id end as user_id
      ) o
      left join memberships ms
             on ms.tenant_id = c.tenant_id
            and ms.user_id = o.user_id
      left join member_profiles mp on mp.membership_id = ms.id
      left join media_assets a on a.id = mp.avatar_asset_id and a.deleted_at is null`;

type OtherMemberDbRow = {
  other_user_id: string;
  other_removed: boolean;
  other_membership_id: string | null;
  other_display_name: string | null;
  other_avatar_asset_id: string | null;
};

const toOther = (row: OtherMemberDbRow): DirectOther => ({
  membershipId: row.other_membership_id,
  displayName: row.other_display_name,
  avatarAssetId: row.other_avatar_asset_id,
  removed: row.other_removed,
});

type PreviewDbRow = {
  lm_body: string | null;
  lm_voice_seconds: number | null;
  lm_voice_gone: boolean | null;
  lm_own: boolean;
};

/** The last live message of a conversation as a lateral read (a soft-deleted one is skipped, its seq stays taken). */
const lastMessageLateral = (ctx: RequestContext, join: 'join' | 'left join') =>
  sql`${sql.raw(join)} lateral (
        select m.body,
               m.voice_seconds::int as voice_seconds,
               ${voiceGoneSql('m')} as voice_gone,
               (m.author_user_id = ${ctx.userId}::uuid) as own
          from chat_messages m
         where m.tenant_id = c.tenant_id
           and m.conversation_id = c.id
           and m.deleted_at is null
         order by m.seq desc
         limit 1
      ) lm on true`;

const previewColumns = sql`
           lm.body as lm_body,
           lm.voice_seconds as lm_voice_seconds,
           lm.voice_gone as lm_voice_gone,
           lm.own as lm_own`;

/** A recording is its stored length (and `deleted` once its asset is gone); a text is one line cut on a word. */
const toPreview = (row: PreviewDbRow): DirectPreview =>
  row.lm_voice_seconds === null
    ? {
        kind: 'text',
        text: cutOnWord(row.lm_body ?? '', CHAT_PREVIEW_GRAPHEMES),
        own: row.lm_own,
      }
    : {
        kind: 'voice',
        durationSeconds: Number(row.lm_voice_seconds),
        own: row.lm_own,
        ...(row.lm_voice_gone === true ? { deleted: true as const } : {}),
      };

type ListDbRow = OtherMemberDbRow &
  PreviewDbRow & {
    id: string;
    last_message_at: string;
    unread_count: number;
  };

/**
 * The pinned support row of the Conversas list (D-719): the preview of the last live message of the member's most recent
 * support conversation (null when they never wrote) and the SHIPPED dot rule, read by the same statement the bubble uses.
 * No staff id, owner or priority is selected.
 */
async function supportSummaryOf(tx: Tx, ctx: RequestContext): Promise<DirectSupportSummary> {
  const rows = await tx.execute<PreviewDbRow>(sql`
    select ${previewColumns}
      from chat_conversations c
      ${lastMessageLateral(ctx, 'join')}
     where c.tenant_id = ${ctx.tenantId}::uuid
       and c.kind = 'support'
       and c.created_by_user_id = ${ctx.userId}::uuid
     order by c.last_message_at desc nulls last, c.id desc
     limit 1`);
  const row = rows[0];
  return { lastPreview: row ? toPreview(row) : null, unread: await memberSupportUnread(tx, ctx) };
}

/**
 * `GET /v1/chat/direct?cursor=&limit=` (CHAT-06, D-719, D-721): the Conversas list. The rows are the paired direct
 * conversations the caller's LANE can read (the select policy already hides a pair with an administrator-blocked or removed
 * member, and `social` off hides them all, so no extra predicate restates it: the list, the counter and the reads share
 * ONE rule, T-11-25), newest activity first by `(last_message_at desc, id desc)`, 20 a page, keyset with the shipped
 * instant-cursor guard (a forged cursor degrades to page 1, T-11-26) and an over-fetch of one. A conversation with no live
 * message does not show. The first page also answers the support summary. A member block does NOT hide a row (the history
 * stays, D-723): only the composer word of the detail changes.
 */
export async function listDirect(
  ctx: RequestContext,
  query: DirectListQuery,
): Promise<DirectListAnswer> {
  const limit = query.limit;
  const decoded = decodeInstantCursor(query.cursor);
  const after = decoded && decoded.n !== CURSOR_NO_INSTANT ? decoded : null;
  const firstPage = after === null;
  const keyset = after
    ? sql`and (c.last_message_at, c.id) < (${after.n}::timestamptz, ${after.id}::uuid)`
    : sql``;

  const { rows, support } = await withTenantTx(ctx, async (tx) => {
    const found = await tx.execute<ListDbRow>(sql`
      select c.id,
             to_char(c.last_message_at at time zone 'utc', ${ISO_MICROSECONDS}) as last_message_at,
             ${otherMemberColumns},
             ${previewColumns},
             unread.n as unread_count
        from chat_conversations c
        join chat_participants p
          on p.conversation_id = c.id
         and p.tenant_id = c.tenant_id
         and p.user_id = ${ctx.userId}::uuid
        ${otherMemberJoins(ctx)}
        ${lastMessageLateral(ctx, 'join')}
        left join lateral (
          select count(*)::int as n
            from (
              select 1
                from chat_messages m
               where m.tenant_id = c.tenant_id
                 and m.conversation_id = c.id
                 and m.deleted_at is null
                 and m.seq > p.last_read_seq
                 and m.author_user_id <> ${ctx.userId}::uuid
               limit ${DIRECT_UNREAD_CAP}
            ) capped
        ) unread on true
       where c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'direct'
         and c.direct_low_user_id is not null
         and c.last_message_at is not null
         ${keyset}
       order by c.last_message_at desc, c.id desc
       limit ${limit + 1}`);
    return { rows: found, support: firstPage ? await supportSummaryOf(tx, ctx) : undefined };
  });

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ n: last.last_message_at, id: last.id }) : null;
  log.info(
    {
      event: 'chat.direct_list',
      tenantId: ctx.tenantId,
      requestId: ctx.requestId,
      limit,
      returned: page.length,
      hasNext: nextCursor !== null,
    },
    'direct conversations listed',
  );
  const items: DirectListRow[] = page.map((row) => ({
    conversationId: row.id,
    other: toOther(row),
    lastPreview: toPreview(row),
    lastMessageAt: row.last_message_at,
    unreadCount: Math.min(Number(row.unread_count), DIRECT_UNREAD_CAP),
  }));
  return { ...(support ? { support } : {}), rows: items, nextCursor };
}

/**
 * `GET /v1/chat/direct/{conversationId}` (CHAT-07, D-722, D-723, A-11-ROLE): what the screen of one conversation draws.
 *
 * The conversation is read through the lane (a miss, a conversation of another tenant, a support case, a pair the
 * administrator hid or one the caller is not part of is ONE bare 404). The composer is the finished enum by the
 * precedence `removed` (the other account is anonymised), `blocker` (`app.is_blocked_by_viewer`: the caller's OWN block),
 * `closed` (`app.members_blocked_between`: a block either way, so the blocked side learns nothing from a row it cannot
 * read), else `open`. `closed` carries no reason, date or name, and no key of the answer says "blocked me". `canBlock` is
 * true only for a viewer whose role of record on the request is `member`, with a live other member the viewer has not
 * blocked already: the web never compares a role, and the SQL definer of the block is not narrowed.
 */
export async function getDirectDetail(
  ctx: RequestContext,
  conversationId: string,
): Promise<DirectDetail> {
  return withTenantTx(ctx, async (tx) => {
    const rows = await tx.execute<
      OtherMemberDbRow & {
        id: string;
        last_seq: number;
        last_read_seq: number;
        blocker: boolean;
        closed: boolean;
      }
    >(sql`
      select c.id,
             c.last_seq::int as last_seq,
             p.last_read_seq::int as last_read_seq,
             ${otherMemberColumns},
             app.is_blocked_by_viewer(o.user_id) as blocker,
             app.members_blocked_between(o.user_id) as closed
        from chat_conversations c
        join chat_participants p
          on p.conversation_id = c.id
         and p.tenant_id = c.tenant_id
         and p.user_id = ${ctx.userId}::uuid
        ${otherMemberJoins(ctx)}
       where c.id = ${conversationId}::uuid
         and c.tenant_id = ${ctx.tenantId}::uuid
         and c.kind = 'direct'
         and c.direct_low_user_id is not null`);
    const row = rows[0];
    if (!row) throw new ApiError(404, 'NOT_FOUND');
    const composer: DirectComposerState = row.other_removed
      ? 'removed'
      : row.blocker
        ? 'blocker'
        : row.closed
          ? 'closed'
          : 'open';
    return {
      conversationId: row.id,
      other: toOther(row),
      composer,
      canBlock: ctx.role === 'member' && !row.other_removed && !row.blocker,
      lastSeq: Number(row.last_seq),
      lastReadSeq: Number(row.last_read_seq),
    };
  });
}
