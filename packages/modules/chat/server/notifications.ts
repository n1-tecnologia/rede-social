import type { Tx } from '@rede-social/core/db/tenant-tx';
import type {
  NotificationIntent,
  NotificationSource,
} from '@rede-social/core/server/notifications/source';
import { sql } from 'drizzle-orm';
import { CHAT_NOTIFICATION_KINDS, type ChatMessageSent } from '../contracts/index';
import { memberMessagePushCopy, supportReplyPushCopy } from './notification-copy';

/**
 * The chat module's notification source (07-08, D-228, D-235), declared in the chat manifest and
 * registered on the kernel seam by the app registry: the notifications module never imports chat,
 * and chat never imports the notifications module (MOD-02).
 *
 * `chat.message_sent` → at most ONE push-only intent (`channels: ['push']`): support messages never
 * write a bell row. NOTIF-01's "support replies" is this push plus the chat badge (D-237).
 *  - a STAFF message pushes the thread's member: title "Equipe {tenant}", the reply as the body, a tap
 *    opening `/suporte`;
 *  - a MEMBER message pushes every live staff member of the tenant (`admin_tenant`,
 *    `support_tenant`, active, not blocked, not removed) except the author: "Nova mensagem de
 *    {member}: {preview}", a tap opening `/suporte/{conversationId}`.
 * Both use the conversation id without hyphens (exactly 32 hex characters, RFC 8030's `Topic` limit)
 * as `tag` and `topic`, so a newer message replaces the older banner of the same thread and still
 * re-alerts (`renotify: true`), with `urgency: 'high'` and a 72 h TTL.
 *
 * `resolve` runs in the WORKER, inside the event tenant's lane (`notificationsSystemCtx`, role
 * `support_tenant`, so the staff-aware chat policies admit it), and reads only chat's own tables plus
 * the kernel's memberships and profiles. A non-support conversation (V2 `direct`/`group`) yields
 * `[]` until its own rule exists.
 */

/** 72 hours: a support answer is still worth delivering to a phone that was off for a weekend. */
export const CHAT_PUSH_TTL_SECONDS = 259_200;

/** The conversation's 32-hex `tag`/`topic` (a uuid without its hyphens). */
export const conversationTag = (conversationId: string): string =>
  conversationId.replaceAll('-', '').toLowerCase();

type MessageFactsRow = {
  kind: string;
  member_user_id: string | null;
  member_name: string | null;
  body: string;
  author_side: 'member' | 'staff';
  author_user_id: string;
};

async function resolveMessageSent(tx: Tx, payload: ChatMessageSent): Promise<NotificationIntent[]> {
  const rows = await tx.execute<MessageFactsRow>(sql`
    select c.kind,
           c.created_by_user_id as member_user_id,
           mp.display_name as member_name,
           m.body,
           m.author_side,
           m.author_user_id
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

  const tag = conversationTag(payload.conversationId);
  const common = {
    subject: { type: 'conversation', id: payload.conversationId },
    object: null,
    actorUserId: row.author_user_id,
    facts: {},
  } as const;

  if (row.author_side === 'staff') {
    return [
      {
        ...common,
        kind: CHAT_NOTIFICATION_KINDS.supportReply,
        audience: { type: 'users', userIds: [row.member_user_id] },
        excludeUserIds: [row.author_user_id],
        dedupeKey: `${CHAT_NOTIFICATION_KINDS.supportReply}:${payload.messageId}`,
        channels: ['push'],
        push: {
          title: 'team',
          body: supportReplyPushCopy(row.body),
          url: '/suporte',
          tag,
          topic: tag,
          ttlSeconds: CHAT_PUSH_TTL_SECONDS,
          urgency: 'high',
          renotify: true,
        },
      },
    ];
  }

  // The live team of the tenant, by role in the membership row (the D-223 staff roles; the same
  // literal list the chat policies use, pinned against `permissionsFor` by the role-drift test).
  const staff = await tx.execute<{ user_id: string }>(sql`
    select ms.user_id::text as user_id
      from memberships ms
     where ms.tenant_id = ${payload.tenantId}::uuid
       and ms.role in ('admin_tenant', 'support_tenant')
       and ms.status = 'active'
       and ms.blocked_at is null
       and ms.deleted_at is null
     order by ms.user_id`);
  const userIds = staff.map((s) => s.user_id).filter((id) => id !== row.author_user_id);
  if (userIds.length === 0) return [];

  return [
    {
      ...common,
      kind: CHAT_NOTIFICATION_KINDS.memberMessage,
      audience: { type: 'users', userIds },
      excludeUserIds: [row.author_user_id],
      dedupeKey: `${CHAT_NOTIFICATION_KINDS.memberMessage}:${payload.messageId}`,
      channels: ['push'],
      push: {
        title: 'tenant',
        body: memberMessagePushCopy(row.member_name, row.body),
        url: `/suporte/${payload.conversationId}`,
        tag,
        topic: tag,
        ttlSeconds: CHAT_PUSH_TTL_SECONDS,
        urgency: 'high',
        renotify: true,
      },
    },
  ];
}

export const chatNotificationSources: NotificationSource<'chat.message_sent'>[] = [
  { event: 'chat.message_sent', resolve: (tx, payload) => resolveMessageSent(tx, payload) },
];
