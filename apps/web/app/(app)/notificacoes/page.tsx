import { PageHeader } from '@rede-social/ui';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
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
 * `PageHeader` "Notificações" (back to `/inicio`), then `NotificationsSurface`: the "Novas" section
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
export default async function NotificationsPage() {
  const [bootstrap, t] = await Promise.all([requireBootstrap(), getTranslations('notifications')]);

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
      notificationRowView(row, { t: translator, nowMs, renderers: notificationRenderers }),
    );

  // A failed Anteriores read (with Novas fine) is not a first-load failure: the list starts that
  // section again from the sentinel, exactly as it would after a scroll.
  const readStarted = readPage !== null;

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {/* The in-shell convention (the post and members pages): the header sticks at the top of the
          shell's scroll root, not below a TopBar offset that would overlap the Novas header row. */}
      <PageHeader
        title={t('title')}
        backHref="/inicio"
        backLabel={t('back')}
        stickyTop="0px"
        className="md:static md:px-0"
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
