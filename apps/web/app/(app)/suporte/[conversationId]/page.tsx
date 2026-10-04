import { avatarUrlFor } from '@rede-social/contracts/profiles';
import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import { ThreadHeader } from '@rede-social/module-chat/ui';
import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getConversation, getMessages } from '@/lib/chat';
import { chatMessageView, tenantDayKeys } from '@/lib/chat-view';
import { replyToConversationAction } from '../actions';
import { ThreadPane } from '../ThreadPane';

/** A canonical uuid: anything else is the one not-found screen before any request (D-23). */
const CONVERSATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The fixed-height thread column (UI-D-261): the member page's heights on the phone and the `md` rail,
 * and the split card's full right pane from `lg` (UI-D-264), so only the message scroller scrolls.
 */
const COLUMN =
  'flex h-[calc(var(--screen-h)-var(--safe-top)-3.5rem-var(--safe-bottom)-5.25rem)] flex-col md:h-[calc(var(--screen-h)-7rem)] lg:h-full lg:min-h-0';

/**
 * `/suporte/[conversationId]` (CHAT-03, D-224, D-225, UI-D-263) [designed]: the staff side of one
 * member's support conversation. On a phone and at `md` it is its own screen; from `lg` it is the right
 * pane of the shared layout's split card, beside the inbox list.
 *
 * **Every miss is ONE screen** (D-23, T-07-66, T-07-67): a caller without `chat.support` (a member
 * probing a staff URL), a malformed id, an unknown id, another tenant's id and another member's id all
 * render `not-found.tsx`. The API answers the last three with the same bare 404; permission is read from
 * `bootstrap.permissions`, never from a role. A transport failure is the pane's load error instead,
 * never dressed up as "not found".
 *
 * The header is the staff variant of `ThreadHeader`: back to `/suporte` ("Voltar para as conversas")
 * and ONE link to the member's existing profile `/membros/{membershipId}` with the avatar and the name,
 * "Ver o perfil de {name}" (no side panel). A departed member is "Membro removido" with no link.
 *
 * The pane is 07-09's `ThreadPane` with `viewer="staff"` and the staff reply action: member bubbles on
 * the left with no label, every team bubble on the right with the sender's first name above it, or
 * "Você" (UI-D-259). A blocked or departed member's thread is read-only: the notice replaces the
 * composer (UI-D-263), and a reply racing a block is handled by the pane.
 *
 * Prefetch-safe: this render records nothing. The pane POSTs the team's read mark after mount while
 * visible, which clears "awaiting" for the whole team (D-225, D-238). Every time and day label is
 * formatted here in the tenant zone from ONE `Date.now()` (UI-D-14).
 */
export default async function StaffThreadPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const [{ conversationId }, bootstrap, t] = await Promise.all([
    params,
    requireBootstrap(),
    getTranslations('chat'),
  ]);

  if (!bootstrap.permissions.includes(CHAT_PERMISSIONS.answer)) notFound();
  if (!CONVERSATION_ID_RE.test(conversationId)) notFound();
  const id = conversationId.toLowerCase();

  const conversation = await getConversation(id);
  if (conversation.status === 'not-found') notFound();
  if (conversation.status === 'ok' && conversation.detail.viewer !== 'staff') notFound();

  const page = conversation.status === 'ok' ? await getMessages(id, null) : null;
  const timeZone = bootstrap.tenant.timezone;
  const tenantName = bootstrap.tenant.displayName;
  // ONE clock read for the whole page: the day keys every separator compares against.
  const keys = tenantDayKeys(Date.now(), timeZone);

  if (conversation.status !== 'ok' || conversation.detail.viewer !== 'staff' || page === null) {
    return (
      <div data-chat-thread className={COLUMN}>
        <PageHeader
          backHref="/suporte"
          backLabel={t('staff.back')}
          className="shrink-0 border-b border-border md:static"
        />
        <ThreadPane
          tenantId={bootstrap.tenant.id}
          tenantName={tenantName}
          logoUrl={null}
          initialConversationId={id}
          initialViews={[]}
          initialHasOlder={false}
          initialKeys={keys}
          initialError
          viewer="staff"
        />
      </div>
    );
  }

  const { member } = conversation.detail;
  const removed = member.state === 'removed';
  const name = removed ? t('removed.name') : (member.displayName ?? t('removed.name'));
  const profileHref =
    removed || member.membershipId === null
      ? null
      : `/membros/${encodeURIComponent(member.membershipId)}`;
  const views = page.items.map((row) => chatMessageView(row, { timeZone, viewer: 'staff', t }));
  const blockedNotice = t('blocked.notice', { name });
  const removedNotice = t('removed.notice');
  const readOnlyNotice =
    member.state === 'blocked' ? blockedNotice : removed ? removedNotice : null;

  return (
    <div data-chat-thread className={COLUMN}>
      <ThreadHeader
        backHref="/suporte"
        backLabel={t('staff.back')}
        avatar={removed ? null : avatarUrlFor(member.avatarAssetId)}
        name={name}
        profileHref={profileHref}
        profileLabel={t('staff.profile', { name })}
      />
      <ThreadPane
        tenantId={bootstrap.tenant.id}
        tenantName={tenantName}
        logoUrl={null}
        initialConversationId={id}
        initialViews={views}
        initialHasOlder={page.hasMore}
        initialKeys={keys}
        initialError={false}
        viewer="staff"
        onSendAction={replyToConversationAction}
        readOnlyNotice={readOnlyNotice}
        raceNotices={{ member_blocked: blockedNotice, member_removed: removedNotice }}
      />
    </div>
  );
}
