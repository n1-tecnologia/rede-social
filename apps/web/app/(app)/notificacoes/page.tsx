import { NotificationItem, NotificationList } from '@rede-social/module-notifications/ui';
import { EmptyState, PageHeader } from '@rede-social/ui';
import { Bell, CircleAlert } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { requireBootstrap } from '@/lib/bootstrap';
import { loadNotifications } from '@/lib/notifications';
import {
  type NotificationRowView,
  type NotificationTranslator,
  notificationRowView,
} from '@/lib/notifications-view';
import { notificationRenderers } from '@/lib/registry';

/**
 * `/notificacoes` (NOTIF-02, D-231, UI-D-250) — the bell's destination, reached from the TopBar /
 * rail slot the notifications module's manifest declares (D-40, UI-D-268).
 *
 * `PageHeader` "Notificações" (back to `/inicio`), then the "Novas" section (unread, newest first),
 * then "Anteriores" (read). The two sections are two keysets (planning decision 9): page 1 of Novas
 * is read, and Anteriores' page 1 only once Novas has no next page, so the list walks Novas to its
 * end before it starts Anteriores. A section with no rows is absent, header included.
 *
 * Prefetch-safe (the 06-06 rule): this server render RECORDS NOTHING. Marking seen is a client POST
 * after mount (07-01 Task 3), never a side effect of a GET.
 *
 * Every string and time is built HERE on the server from ONE request instant (UI-D-14), and a row's
 * sentence comes from the web registry's renderer for its `kind` (UI-D-251).
 */
export default async function NotificationsPage() {
  const [bootstrap, t, te] = await Promise.all([
    requireBootstrap(),
    getTranslations('notifications'),
    getTranslations('app.error'),
  ]);

  const unreadPage = await loadNotifications({ section: 'unread' });
  const readPage =
    unreadPage !== null && unreadPage.nextCursor === null
      ? await loadNotifications({ section: 'read' })
      : null;

  const header = <PageHeader title={t('title')} backHref="/inicio" backLabel={t('back')} />;

  if (unreadPage === null) {
    return (
      <div className="mx-auto flex w-full max-w-[680px] flex-col">
        {header}
        <EmptyState
          icon={CircleAlert}
          title={te('title')}
          body={te('body')}
          action={
            <a
              href="/notificacoes"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover"
            >
              {te('retry')}
            </a>
          }
        />
      </div>
    );
  }

  // ONE clock read for the whole page: every relative label is computed from the same instant.
  const nowMs = Date.now();
  const translator = t as unknown as NotificationTranslator;
  const toViews = (items: typeof unreadPage.items) =>
    items
      .map((row) =>
        notificationRowView(row, { t: translator, nowMs, renderers: notificationRenderers }),
      )
      .filter((view): view is NotificationRowView => view !== null);

  const unread = toViews(unreadPage.items);
  const read = toViews(readPage?.items ?? []);

  const renderRow = (view: NotificationRowView) => (
    <NotificationItem
      key={view.id}
      href={view.href}
      unread={view.unread}
      leading={view.leading}
      glyph={view.glyph}
      glyphTone={view.glyphTone}
      sentence={view.sentence}
      time={view.time}
      preview={view.preview}
      unreadLabel={t('unreadLabel')}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-[680px] flex-col">
      {header}
      {unread.length === 0 && read.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={t('empty.title')}
          body={t('empty.body', { tenant: bootstrap.tenant.displayName })}
        />
      ) : (
        <NotificationList
          ariaLabel={t('region', { tenant: bootstrap.tenant.displayName })}
          unreadTitle={t('sections.unread')}
          unread={unread.map(renderRow)}
          readTitle={t('sections.read')}
          read={read.map(renderRow)}
        />
      )}
    </div>
  );
}
