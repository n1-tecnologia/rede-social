import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';
import { CHAT_NOTIFICATION_KINDS, type ChatMessageSent } from '../contracts/index';
import {
  caseAssignedPushCopy,
  caseNewPushCopy,
  caseReopenedPushCopy,
  caseResolvedPushCopy,
  memberMessagePushCopy,
  supportReplyPushCopy,
} from './notification-copy';

/**
 * The chat module's notification sources (07-08, D-228, D-235; 12.4-09, D-808, D-809, D-841), declared in the chat
 * manifest and registered on the kernel seam by the app registry: the notifications module never imports chat, and
 * chat never imports the notifications module (MOD-02). The kinds are free strings, so no notifications migration
 * exists.
 *
 * `chat.message_sent` → at most ONE push-only intent (`channels: ['push']`): a message never writes a bell row.
 * NOTIF-01's "support replies" is this push plus the chat badge (D-237).
 *  - a STAFF message pushes the thread's member (`chat.support_reply`): title "Equipe {tenant}", the reply as the
 *    body, a tap opening `/suporte`;
 *  - a MEMBER message pushes the TEAM, never the author (title: the tenant, a tap opening `/suporte/{id}`), and the
 *    audience and the kind follow the case (D-809, D-841):
 *      · a `reopened` history row that carries this message id (the owner was cleared) → `chat.case_reopened` to every
 *        live staff member;
 *      · the case's first message (`seq = 1`) → `chat.case_new` to every live staff member;
 *      · otherwise `chat.member_message` ("Nova mensagem de {member} no chamado #N: ...") to the OWNER ONLY when the
 *        owner is still live staff, and to every live staff member when there is no live owner.
 *    The team's own Resolver, Fechar and Reabrir are not messages and push the team nothing.
 * `chat.case_assigned` → one push-only `chat.case_assigned` to the assignee, never the actor (an admin assigning a
 * case to themselves notifies nobody); the dedupe key carries the sink instant, so a second assignment notifies again.
 * `chat.case_resolved` → the member's ONLY case notice (D-808): one bell row plus a push, ids-only facts
 * `{ caseId, number }`, for the case's member alone. The resolver re-reads the case and answers nothing unless the case
 * is still `resolved` and its CURRENT `resolved_at` equals the event's, compared in SQL as timestamptz (never through a
 * JavaScript Date, so microsecond rounding cannot decide): a resolve that was reopened or superseded notifies nobody,
 * the latest one notifies once. Closing, reopening, taking and editing notify the member of nothing.
 * Every push uses the conversation id without hyphens (exactly 32 hex characters, RFC 8030's `Topic` limit) as `tag`
 * and `topic`: one device tag per case, so a newer notice replaces the older banner of the same case and still
 * re-alerts (`renotify: true`), with `urgency: 'high'` and a 72 h TTL.
 *
 * `resolve` runs in the WORKER, inside the event tenant's lane (`notificationsSystemCtx`, role `support_tenant`, so the
 * staff-aware chat policies admit it), and reads only chat's own tables plus the kernel's memberships and profiles,
 * every statement pinned to the payload's tenant. A non-support conversation (V2 `direct`/`group`) yields `[]` until
 * its own rule exists.
 */

/** 72 hours: a support answer is still worth delivering to a phone that was off for a weekend. */
export const CHAT_PUSH_TTL_SECONDS = 259_200;

/** The conversation's 32-hex `tag`/`topic` (a uuid without its hyphens). */
export const conversationTag = (conversationId: string): string =>
  conversationId.replaceAll('-', '').toLowerCase();

/** The push hint every chat notice shares: one tag per case, re-alerting, high urgency, a 72 h life. */
const pushHint = (
  conversationId: string,
  title: 'tenant' | 'team',
  body: string,
  url: string,
): NonNullable<NotificationIntent['push']> => {
  const tag = conversationTag(conversationId);
  return {
    title,
    body,
    url,
    tag,
    topic: tag,
    ttlSeconds: CHAT_PUSH_TTL_SECONDS,
    urgency: 'high',
    renotify: true,
  };
};

/** Placeholder banner for a staff voice reply until plan 09 writes the real wording. */
const VOICE_REPLY_PLACEHOLDER = 'Mensagem de voz';

type MessageFactsRow = {
  kind: string;
  member_user_id: string | null;
  member_name: string | null;
  /** Null on a recording (12.5): the banner wording of a voice message is plan 09's. */
  body: string | null;
  author_side: 'member' | 'staff';
  author_user_id: string;
  case_number: number | null;
  owner_user_id: string | null;
  owner_live: boolean;
  reopened: boolean;
};

async function resolveMessageSent(tx: Tx, payload: ChatMessageSent): Promise<NotificationIntent[]> {
  // One tenant-pinned read: the message, the thread's member, the case number and owner, whether that owner is still
  // live staff (the same literal role list as the audience query below) and whether THIS message reopened the case.
  const rows = await tx.execute<MessageFactsRow>(sql`
    select c.kind,
           c.created_by_user_id as member_user_id,
           mp.display_name as member_name,
           m.body,
           m.author_side,
           m.author_user_id,
           c.case_number::int as case_number,
           c.owner_user_id::text as owner_user_id,
           exists (
             select 1
               from memberships om
              where om.tenant_id = c.tenant_id
                and om.user_id = c.owner_user_id
                and om.role in ('admin_tenant', 'support_tenant')
                and om.status = 'active'
                and om.blocked_at is null
                and om.deleted_at is null
           ) as owner_live,
           exists (
             select 1
               from chat_case_events e
              where e.tenant_id = m.tenant_id
                and e.conversation_id = m.conversation_id
                and e.message_id = m.id
                and e.kind = 'reopened'
           ) as reopened
      from chat_messages m
      join chat_conversations c
        on c.id = m.conversation_id
       and c.tenant_id = m.tenant_id
      left join memberships ms
             on ms.tenant_id = c.tenant_id
            and ms.user_id = c.created_by_user_id
            and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id
     where m.id = ${payload.messageId}::uuid
       and m.tenant_id = ${payload.tenantId}::uuid
       and m.conversation_id = ${payload.conversationId}::uuid
       and m.deleted_at is null`);
  const row = rows[0];
  if (row?.kind !== 'support' || !row.member_user_id) return [];

  const common = {
    subject: { type: 'conversation', id: payload.conversationId },
    object: null,
    actorUserId: row.author_user_id,
    facts: {},
  } as const;

  // A recording has no body (12.5, D-846). Until the voice banner wording lands (plan 09), the staff reply banner of a
  // recording is a neutral placeholder and the member-message previews read an empty string, so nothing crashes.
  const text = row.body ?? '';

  if (row.author_side === 'staff') {
    return [
      {
        ...common,
        kind: CHAT_NOTIFICATION_KINDS.supportReply,
        audience: { type: 'users', userIds: [row.member_user_id] },
        excludeUserIds: [row.author_user_id],
        dedupeKey: `${CHAT_NOTIFICATION_KINDS.supportReply}:${payload.messageId}`,
        channels: ['push'],
        push: pushHint(
          payload.conversationId,
          'team',
          row.body === null ? VOICE_REPLY_PLACEHOLDER : supportReplyPushCopy(text),
          '/suporte',
        ),
      },
    ];
  }

  // Who is told, and what: D-809 / D-841. A reopen wins over "first message" (a reopen is never message 1).
  const kind = row.reopened
    ? CHAT_NOTIFICATION_KINDS.caseReopened
    : payload.seq === 1
      ? CHAT_NOTIFICATION_KINDS.caseNew
      : CHAT_NOTIFICATION_KINDS.memberMessage;
  const ownerOnly = kind === CHAT_NOTIFICATION_KINDS.memberMessage && row.owner_live;

  let userIds: string[];
  if (ownerOnly && row.owner_user_id) {
    userIds = [row.owner_user_id];
  } else {
    // The live team of the tenant, by role in the membership row (the D-223 staff roles; the same literal list the chat
    // policies use, pinned against `permissionsFor` by the role-drift test), sorted so the intent is deterministic.
    const staff = await tx.execute<{ user_id: string }>(sql`
      select ms.user_id::text as user_id
        from memberships ms
       where ms.tenant_id = ${payload.tenantId}::uuid
         and ms.role in ('admin_tenant', 'support_tenant')
         and ms.status = 'active'
         and ms.blocked_at is null
         and ms.deleted_at is null
       order by ms.user_id`);
    userIds = staff.map((s) => s.user_id);
  }
  userIds = userIds.filter((id) => id !== row.author_user_id);
  if (userIds.length === 0) return [];

  let body: string;
  if (kind === CHAT_NOTIFICATION_KINDS.caseNew && row.case_number !== null) {
    body = caseNewPushCopy(row.case_number, row.member_name, text);
  } else if (kind === CHAT_NOTIFICATION_KINDS.caseReopened && row.case_number !== null) {
    body = caseReopenedPushCopy(row.case_number, row.member_name, text);
  } else {
    body = memberMessagePushCopy(row.member_name, row.case_number, text);
  }

  return [
    {
      ...common,
      kind,
      audience: { type: 'users', userIds },
      excludeUserIds: [row.author_user_id],
      dedupeKey: `${kind}:${payload.messageId}`,
      channels: ['push'],
      push: pushHint(payload.conversationId, 'tenant', body, `/suporte/${payload.conversationId}`),
    },
  ];
}

type ResolvedRow = { member_user_id: string; case_number: number };

/**
 * D-808: the member's "resolved" notice. The case is re-read in the worker's lane and the instant is compared in SQL
 * as timestamptz (EP-061); anything but "still resolved at exactly this instant" yields no intent (EP-060, T-12.4-43).
 */
async function resolveCaseResolved(
  tx: Tx,
  payload: { tenantId: string; conversationId: string; resolvedAt: string },
): Promise<NotificationIntent[]> {
  const rows = await tx.execute<ResolvedRow>(sql`
    select c.created_by_user_id::text as member_user_id,
           c.case_number::int as case_number
      from chat_conversations c
     where c.id = ${payload.conversationId}::uuid
       and c.tenant_id = ${payload.tenantId}::uuid
       and c.kind = 'support'
       and c.state = 'resolved'
       and c.resolved_at = ${payload.resolvedAt}::timestamptz`);
  const row = rows[0];
  if (!row?.member_user_id || row.case_number === null) return [];

  return [
    {
      kind: CHAT_NOTIFICATION_KINDS.caseResolved,
      audience: { type: 'users', userIds: [row.member_user_id] },
      excludeUserIds: [],
      dedupeKey: `${CHAT_NOTIFICATION_KINDS.caseResolved}:${payload.conversationId}:${payload.resolvedAt}`,
      subject: { type: 'conversation', id: payload.conversationId },
      object: null,
      actorUserId: null,
      // Ids and a number only (T-12.4-41): never a subject, a message text or a staff name.
      facts: { caseId: payload.conversationId, number: row.case_number },
      channels: ['in_app', 'push'],
      push: pushHint(
        payload.conversationId,
        'team',
        caseResolvedPushCopy(row.case_number),
        `/suporte/${payload.conversationId}`,
      ),
    },
  ];
}

type AssignedRow = { case_number: number | null; member_name: string | null };

/** D-809: the assignee's push. A self-assignment (actor equals assignee) notifies nobody. */
async function resolveCaseAssigned(
  tx: Tx,
  payload: {
    tenantId: string;
    conversationId: string;
    assigneeUserId: string;
    actorUserId: string;
  },
  meta: { sinkAt: string },
): Promise<NotificationIntent[]> {
  if (payload.assigneeUserId === payload.actorUserId) return [];
  const rows = await tx.execute<AssignedRow>(sql`
    select c.case_number::int as case_number,
           mp.display_name as member_name
      from chat_conversations c
      left join memberships ms
             on ms.tenant_id = c.tenant_id
            and ms.user_id = c.created_by_user_id
            and ms.deleted_at is null
      left join member_profiles mp on mp.membership_id = ms.id
     where c.id = ${payload.conversationId}::uuid
       and c.tenant_id = ${payload.tenantId}::uuid
       and c.kind = 'support'`);
  const row = rows[0];
  if (!row || row.case_number === null) return [];

  return [
    {
      kind: CHAT_NOTIFICATION_KINDS.caseAssigned,
      audience: { type: 'users', userIds: [payload.assigneeUserId] },
      excludeUserIds: [payload.actorUserId],
      dedupeKey: `${CHAT_NOTIFICATION_KINDS.caseAssigned}:${payload.conversationId}:${payload.assigneeUserId}:${meta.sinkAt}`,
      subject: { type: 'conversation', id: payload.conversationId },
      object: null,
      actorUserId: payload.actorUserId,
      facts: {},
      channels: ['push'],
      push: pushHint(
        payload.conversationId,
        'tenant',
        caseAssignedPushCopy(row.case_number, row.member_name),
        `/suporte/${payload.conversationId}`,
      ),
    },
  ];
}

export const chatNotificationSources = [
  {
    event: 'chat.message_sent',
    resolve: (tx, payload) => resolveMessageSent(tx, payload),
  } satisfies NotificationSource<'chat.message_sent'>,
  {
    event: 'chat.case_resolved',
    resolve: (tx, payload) => resolveCaseResolved(tx, payload),
  } satisfies NotificationSource<'chat.case_resolved'>,
  {
    event: 'chat.case_assigned',
    resolve: (tx, payload, meta) => resolveCaseAssigned(tx, payload, meta),
  } satisfies NotificationSource<'chat.case_assigned'>,
] as NotificationSource[];
