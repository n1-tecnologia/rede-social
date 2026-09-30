'use client';

import { tenantTopic, userTopic } from '@rede-social/contracts/realtime';
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
  /** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (07-07); null leaves push out entirely. */
  vapidPublicKey?: string | null;
  children: ReactNode;
}

/**
 * The tenant shell's live layer (07-03, NOTIF-02): ONE Realtime client for the window, the counters
 * the TopBar bell and the rail read, and the stateful slot labels (UI-D-253).
 *
 * Topics: the member's own `tenant:<t>:user:<u>` (seen/read in another tab, personal kinds) and, while
 * `notifications` is on, `tenant:<t>:all` (broadcast kinds). Both are built by the contract builders.
 * The `all` join is left out when the module is off: the database would refuse it anyway, and a
 * refused channel only costs retries.
 *
 * Push (07-07): once after mount, with a VAPID key and permission already granted, the current
 * subscription is re-saved or re-made under a rotated key (`syncPushOnOpen`, never a prompt). The shell
 * also provides the kernel's `BeforeLogoutProvider` with "forget this device's push", which the
 * desktop rail's "Sair" awaits (bounded to 2 s) before signing out.
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
  vapidPublicKey = null,
  children,
}: LiveShellProps) {
  const t = useTranslations('notifications');

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

  const topics = useMemo(
    () =>
      notificationsEnabled
        ? [userTopic(tenantId, userId), tenantTopic(tenantId)]
        : [userTopic(tenantId, userId)],
    [tenantId, userId, notificationsEnabled],
  );

  // UI-D-253: "Notificações, 1 nova" / "Notificações, 3 novas". 07-09 adds the chat label.
  const labelFor = useCallback<SlotBadgeLabel>(
    (badge, count) => (badge === 'unreadNotifications' ? t('navBadge', { count }) : undefined),
    [t],
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
      >
        <SlotBadgeLabelsProvider value={labelFor}>
          <BeforeLogoutProvider value={forgetDevice}>{children}</BeforeLogoutProvider>
        </SlotBadgeLabelsProvider>
      </LiveCountersProvider>
    </RealtimeProvider>
  );
}
