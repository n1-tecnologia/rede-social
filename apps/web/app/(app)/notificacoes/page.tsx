import { PageHeader } from '@rede-social/ui';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SoftAsk } from '@/components/push/PushControls';
import { requireBootstrap } from '@/lib/bootstrap';
import { env } from '@/lib/env';
import { loadNotifications } from '@/lib/notifications';
import {
  type NotificationRowView,
  type NotificationTranslator,
  notificationRowView,
} from '@/lib/notifications-view';
import { notificationRenderers } from '@/lib/registry';
import { NotificationsSurface } from './NotificationsSurface';

/**
 * `/notificacoes` (NOTIF-02, D-231, UI-D-250) — the bell's destination, reached from the TopBar /
 * rail slot the notifications module's manifest declares (D-40, UI-D-268).
 *
 * `PageHeader` "Notificações" (back to the previous screen, `/inicio` when opened directly), then the
 * one-time push soft-ask card (07-07, UI-D-255: a client component that renders nothing on the
 * server and decides after mount), then `NotificationsSurface`: the "Novas" section
 * (unread, newest first, with "Marcar todas como lidas" in its header), "Anteriores" (read), the
 * `InfiniteScroll` sentinel and, at the true end, the 90-day footer. The two sections are two keysets
 * (planning decision 9): page 1 of Novas is read here, and Anteriores' page 1 too only when Novas has
 * no next page, so the list walks Novas to its end before it starts Anteriores.
 *
 * Prefetch-safe (the 06-06 rule): this server render RECORDS NOTHING. Seen is a client POST after
 * mount, read is a tap's POST; both are BFF route handlers, never a side effect of a GET.
 *
 * Every string and time is built HERE on the server from ONE request instant (UI-D-14), and a row's
 * sentence comes from the web registry's renderer for its `kind` (UI-D-251).
 */
/** Staff who answer the support chat get the soft-ask's staff body (the kernel's permission key). */
const CHAT_SUPPORT_PERMISSION = 'chat.support';

export default async function NotificationsPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('notifications')]);
  // 07 review C-WR-01: a tenant without the module has no bell; the page is the same miss as any other
  // module page whose module is off (`reels/page.tsx`), never an error card plus a soft-ask.
  if (!bootstrap.modules.some((module) => module.key === 'notifications')) notFound();

  const unreadPage = await loadNotifications({ section: 'unread' });
  const readPage =
    unreadPage !== null && unreadPage.nextCursor === null
      ? await loadNotifications({ section: 'read' })
      : null;

  // ONE clock read for the whole page: every relative label is computed from the same instant.
  const nowMs = Date.now();
  const translator = t as unknown as NotificationTranslator;
  // Every row renders (07-04): an unknown kind is the generic row, never a filtered-out gap.
  const toViews = (items: NonNullable<typeof unreadPage>['items']): NotificationRowView[] =>
    items.map((row) =>
      notificationRowView(row, {
        t: translator,
        nowMs,
        timeZone: bootstrap.tenant.timezone,
        renderers: notificationRenderers,
      }),
    );

  // A failed Anteriores read (with Novas fine) is not a first-load failure: the list starts that
  // section again from the sentinel, exactly as it would after a scroll.
  const readStarted = readPage !== null;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {/* The primitive's default offset: in flow at rest (never pushed down over the Novas header
          row below it) and flush under the TopBar once pinned. */}
      <PageHeader
        title={t('title')}
        backHref="/inicio"
        backLabel={t('back')}
        className="md:static md:px-0"
      />
      <SoftAsk
        vapidKey={env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null}
        tenantName={bootstrap.tenant.displayName}
        staff={bootstrap.permissions.includes(CHAT_SUPPORT_PERMISSION)}
      />
      <NotificationsSurface
        initialUnread={toViews(unreadPage?.items ?? [])}
        initialUnreadCursor={unreadPage?.nextCursor ?? null}
        initialRead={toViews(readPage?.items ?? [])}
        initialReadCursor={readPage?.nextCursor ?? null}
        readStarted={readStarted}
        initialError={unreadPage === null}
        tenantName={bootstrap.tenant.displayName}
        tenantId={bootstrap.tenant.id}
        userId={bootstrap.user.id}
      />
    </div>
  );
}
