'use client';

import {
  inboxTopic,
  REALTIME_EVENTS,
  tenantTopic,
  userTopic,
} from '@rede-social/contracts/realtime';
import {
  BeforeLogoutProvider,
  type LiveCounters,
  LiveCountersProvider,
  RealtimeProvider,
  type SlotBadgeLabel,
  SlotBadgeLabelsProvider,
} from '@rede-social/core/ui';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useMemo } from 'react';
import {
  disablePush,
  type PushWindowLike,
  pushRegistration,
  pushRegistrationWithin,
  pushSupport,
  syncPushOnOpen,
} from '@/lib/push';

export interface LiveShellProps {
  /** `NEXT_PUBLIC_SUPABASE_URL`, passed by the server layout. */
  supabaseUrl: string;
  /** `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, passed by the server layout. */
  publishableKey: string;
  /** The tenant of record and the member, from the bootstrap (never from the host). */
  tenantId: string;
  userId: string;
  /** `bootstrap.counters`: the server's numbers until the first live refetch. */
  initialCounters: LiveCounters;
  /** `notifications` is enabled for the tenant: only then may the member join `tenant:<t>:all`. */
  notificationsEnabled: boolean;
  /**
   * 07-09: the viewer holds `chat.support` (from `bootstrap.permissions`, never a role comparison), so
   * the shell also joins `tenant:<t>:support-inbox` to keep the staff's awaiting count live.
   */
  supportInbox?: boolean;
  /** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (07-07); null leaves push out entirely. */
  vapidPublicKey?: string | null;
  children: ReactNode;
}

/**
 * 08-04 (MODER-02, T-08-24): a counters refetch REFUSED with 403 `MEMBERSHIP_BLOCKED` (the BFF adds the
 * shipped flow's path) takes the open app to the blocked flow — the same `/auth/blocked` destination
 * `requireBootstrap` maps the code to, which signs this device out and shows "Acesso suspenso". A full
 * navigation, because the route handler clears the session cookies. Only that one code, and only a
 * same-origin `/auth/blocked` path, ever navigates; every other refusal keeps the last counters.
 */
export async function landOnBlockedFlow(
  response: Response,
  navigate: (path: string) => void,
): Promise<boolean> {
  if (response.status !== 403) return false;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return false;
  }
  const refusal = body as { error?: { code?: unknown }; location?: unknown };
  if (refusal?.error?.code !== 'MEMBERSHIP_BLOCKED') return false;
  const location = refusal.location;
  if (typeof location !== 'string' || !location.startsWith('/auth/blocked')) return false;
  navigate(location);
  return true;
}

const assignLocation = (path: string) => window.location.assign(path);
const onCountersRefused = (response: Response) =>
  landOnBlockedFlow(response, assignLocation).then(() => undefined);

/** Every signal that can move a badge: the bell, the member's dot and the staff count. */
const COUNTER_EVENTS = [
  REALTIME_EVENTS.notificationsChanged,
  REALTIME_EVENTS.chatUnread,
  REALTIME_EVENTS.chatMessage,
  REALTIME_EVENTS.chatRead,
] as const;

/**
 * The tenant shell's live layer (07-03, NOTIF-02): ONE Realtime client for the window, the counters
 * the TopBar bell and the rail read, and the stateful slot labels (UI-D-253).
 *
 * Topics: the member's own `tenant:<t>:user:<u>` (seen/read in another tab, personal kinds) and, while
 * `notifications` is on, `tenant:<t>:all` (broadcast kinds). Both are built by the contract builders.
 * The `all` join is left out when the module is off: the database would refuse it anyway, and a
 * refused channel only costs retries.
 *
 * Chat (07-09, D-237..D-240): the counters also refetch on `chat.unread` (the member's dot, published
 * on their user topic) and, for holders of `chat.support`, on `chat.message` / `chat.read` on the
 * support inbox (the staff's awaiting count). A message arriving outside an open thread raises no
 * toast: the badge is the signal (UI-D-253).
 *
 * Push (07-07): once after mount, with a VAPID key and permission already granted, the current
 * subscription is re-saved or re-made under a rotated key (`syncPushOnOpen`, never a prompt). The shell
 * also provides the kernel's `BeforeLogoutProvider` with "forget this device's push", which the
 * desktop rail's "Sair" awaits (bounded to 2 s) before signing out.
 *
 * Blocked with the app open (08-04): an admin's block nudges `notifications.changed` on the member's
 * user topic; the refetch answers 403 `MEMBERSHIP_BLOCKED` and `landOnBlockedFlow` navigates to the
 * shipped blocked flow, with no manual reload.
 *
 * Mounted by `app/(app)/layout.tsx` on the tenant branch only. Leaving the `(app)` segment (logout,
 * the blocked flow's `/acesso-suspenso`) unmounts it, and the provider disconnects on unmount.
 */
export function LiveShell({
  supabaseUrl,
  publishableKey,
  tenantId,
  userId,
  initialCounters,
  notificationsEnabled,
  supportInbox = false,
  vapidPublicKey = null,
  children,
}: LiveShellProps) {
  const t = useTranslations('notifications');
  const tChat = useTranslations('chat');

  useEffect(() => {
    if (!vapidPublicKey) return;
    if (pushSupport(window as unknown as PushWindowLike, vapidPublicKey) !== 'available') return;
    if (Notification.permission !== 'granted') return;
    let alive = true;
    void pushRegistration().then((registration) => {
      if (alive && registration) void syncPushOnOpen(registration, vapidPublicKey);
    });
    return () => {
      alive = false;
    };
  }, [vapidPublicKey]);

  const forgetDevice = useCallback(async () => {
    await disablePush(await pushRegistrationWithin());
  }, []);

  const topics = useMemo(() => {
    const list = [userTopic(tenantId, userId)];
    if (notificationsEnabled) list.push(tenantTopic(tenantId));
    if (supportInbox) list.push(inboxTopic(tenantId));
    return list;
  }, [tenantId, userId, notificationsEnabled, supportInbox]);

  // UI-D-253: "Notificações, 1 nova" / "Notificações, 3 novas"; the chat slot reads "Suporte, nova
  // resposta da equipe" for a member's dot and "Suporte, 2 aguardando resposta" for the staff count.
  const labelFor = useCallback<SlotBadgeLabel>(
    (badge, count, style) => {
      if (badge === 'unreadNotifications') return t('navBadge', { count });
      if (badge === 'unreadConversations')
        return style === 'dot' ? tChat('navBadge.member') : tChat('navBadge.staff', { count });
      return undefined;
    },
    [t, tChat],
  );

  return (
    <RealtimeProvider
      supabaseUrl={supabaseUrl}
      publishableKey={publishableKey}
      tokenUrl="/api/realtime/token"
    >
      <LiveCountersProvider
        initial={initialCounters}
        countersUrl="/api/me/counters"
        topics={topics}
        events={COUNTER_EVENTS}
        onRefused={onCountersRefused}
      >
        <SlotBadgeLabelsProvider value={labelFor}>
          <BeforeLogoutProvider value={forgetDevice}>{children}</BeforeLogoutProvider>
        </SlotBadgeLabelsProvider>
      </LiveCountersProvider>
    </RealtimeProvider>
  );
}
