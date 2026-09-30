import { resolveBranding } from '@rede-social/contracts';
import { TenantLogo } from '@rede-social/core/ui';
import { CHAT_PERMISSIONS } from '@rede-social/module-chat/contracts';
import { ThreadHeader } from '@rede-social/module-chat/ui';
import { EmptyState } from '@rede-social/ui';
import { MessageCircle } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { getSupportThread } from '@/lib/chat';
import { chatMessageView, tenantDayKeys } from '@/lib/chat-view';
import { ThreadPane } from './ThreadPane';

/**
 * `/suporte` (CHAT-02, D-220, D-222, UI-D-258): the chat slot's destination. One tap on the TopBar
 * balloon lands a MEMBER straight in their one conversation with the organisation's team: no help
 * hub, no ticket, no subject.
 *
 * **Who gets what is decided by permission, never by role** (D-223, D-224):
 * - a holder of `chat.support` (staff) gets the inbox from the shared `/suporte` layout (07-10), and
 *   THIS page is only the right pane's idle state "Escolha uma conversa", drawn from `lg` (below `lg`
 *   the layout shows the list instead and hides this pane);
 * - a caller without `chat.support.contact` (the chat module is off for the tenant, D-40) gets the
 *   not-found screen too;
 * - everyone else is a member and gets the thread.
 *
 * **The GET creates nothing** (lazy creation): before the first message `GET /v1/chat/support` answers
 * no conversation and the pane shows the greeting; the first send creates it. Nothing is marked read
 * here either: the pane POSTs the read mark after mount while visible (prefetch-safe, the 06-06 rule).
 *
 * **The thread is a fixed-height column** (UI-D-261) that exactly fills the shell's content area
 * (the mobile TopBar and floating BottomNav, or the desktop column paddings), so only the message
 * scroller scrolls and there is no pull-to-refresh. Every time and day label is formatted HERE in the
 * tenant zone from ONE `Date.now()` (UI-D-14, UI-D-259).
 */
export default async function SupportPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('chat')]);

  // 07-10 (UI-D-264): staff see the inbox from the layout; this is the split's idle right pane.
  if (bootstrap.permissions.includes(CHAT_PERMISSIONS.answer)) {
    return (
      <div data-support-idle className="hidden min-h-0 flex-1 items-center justify-center lg:flex">
        <EmptyState
          variant="plain"
          icon={MessageCircle}
          title={t('inbox.idle.title')}
          body={t('inbox.idle.body')}
          className="justify-center"
        />
      </div>
    );
  }
  if (!bootstrap.permissions.includes(CHAT_PERMISSIONS.contact)) notFound();

  const thread = await getSupportThread();
  const timeZone = bootstrap.tenant.timezone;
  // ONE clock read for the whole page: the day keys every separator compares against.
  const keys = tenantDayKeys(Date.now(), timeZone);
  const views = (thread?.messages ?? []).map((row) =>
    chatMessageView(row, { timeZone, viewer: 'member', t }),
  );
  const tenantName = bootstrap.tenant.displayName;
  const { logoUrl } = resolveBranding(bootstrap.tenant.branding);

  return (
    <div
      data-chat-thread
      className="flex h-[calc(var(--screen-h)-var(--safe-top)-3.5rem-var(--safe-bottom)-5.25rem)] flex-col md:h-[calc(var(--screen-h)-7rem)]"
    >
      <ThreadHeader
        logo={
          logoUrl ? <TenantLogo logoUrl={logoUrl} displayName={tenantName} size="thread" /> : null
        }
        title={t('member.title', { tenant: tenantName })}
        backHref="/inicio"
        backLabel={t('member.back')}
      />
      <ThreadPane
        tenantId={bootstrap.tenant.id}
        tenantName={tenantName}
        logoUrl={logoUrl}
        initialConversationId={thread?.conversation?.id ?? null}
        initialViews={views}
        initialHasOlder={thread?.hasOlder ?? false}
        initialKeys={keys}
        initialError={thread === null}
      />
    </div>
  );
}
