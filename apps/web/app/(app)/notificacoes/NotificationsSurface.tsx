'use client';

import { REALTIME_EVENTS, tenantTopic, userTopic } from '@rede-social/contracts/realtime';
import { useRealtimeTopic } from '@rede-social/core/ui';
import { NotificationItem, NotificationList } from '@rede-social/module-notifications/ui';
import {
  Button,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
  useToast,
} from '@rede-social/ui';
import { Bell, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationRowView } from '@/lib/notifications-view';
import { loadMoreNotificationsAction, refreshNotificationsAction } from './actions';

export interface NotificationsSurfaceProps {
  /** Page 1 of Novas, built on the server (sentences and times already rendered). */
  initialUnread: NotificationRowView[];
  initialUnreadCursor: string | null;
  /** Page 1 of Anteriores when the server already read it (Novas had no next page), else `[]`. */
  initialRead: NotificationRowView[];
  initialReadCursor: string | null;
  /** `true` when Anteriores' page 1 is already loaded. */
  readStarted: boolean;
  /** `true` when the server could not read the first page at all (UI-D-265). */
  initialError?: boolean;
  /** The tenant's display name, for the region label and the empty body. */
  tenantName: string;
  /** The tenant of record and the member (bootstrap), for the two live topics (07-03). */
  tenantId: string;
  userId: string;
}

/** The own-topic markers the seen/read routes publish: they never add a row to this list. */
const MARK_KINDS = new Set(['seen', 'read']);

const LIVE_EVENTS = [REALTIME_EVENTS.notificationsChanged];

/** One row's geometry: a 40px circle, two text bars at 14px and 12px, `px-4 py-3` (UI-D-265). */
function NotificationRowSkeleton() {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Skeleton variant="circle" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Skeleton variant="text" width="80%" className="h-3.5" />
        <Skeleton variant="text" width="30%" className="h-3" />
      </div>
    </div>
  );
}

/** `count` row skeletons; `loading.tsx` shows 6, a load-more shows 3 at the sentinel. */
export function NotificationsSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy data-testid="notifications-skeleton" className="flex flex-col">
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders, never reordered
        <NotificationRowSkeleton key={index} />
      ))}
    </div>
  );
}

/**
 * The `/notificacoes` body (NOTIF-02, D-230, D-231, UI-D-250, UI-D-252, UI-D-265).
 *
 * - **Two keysets walked in order.** Novas pages to its end BEFORE Anteriores starts (page 1 of
 *   Anteriores is asked for with a null cursor once Novas has none). A page APPENDS; nothing on
 *   screen moves. The 90-day footer shows only at the true end of both.
 * - **Seen after mount, while visible.** The page's server render records nothing (prefetch-safe);
 *   this component POSTs `/api/notifications/seen` ONCE, when the document is visible or on the first
 *   `visibilitychange` to visible. The bell drops to zero; the tints stay.
 * - **Read on tap, in place.** A row's activation fires `/api/notifications/{id}/read` with
 *   `keepalive` WITHOUT awaiting it, clears that row's tint locally and lets the anchor navigate. The
 *   row moves to Anteriores only on the next load (moving rows under the finger is what this avoids).
 *   A REMOVED row (07-04 keep-and-mark) is a button: the same read, the same tint, and the info toast
 *   "Este conteúdo não está mais disponível." instead of a navigation (UI-D-254).
 * - **Mark all.** Visible while any loaded row is unread; `aria-busy` and disabled during the POST;
 *   clears every tint optimistically, restores them and fires the error toast on failure.
 *
 * - **Live merge (07-03, D-240).** On a `notifications.changed` signal on the member's own topic or
 *   the tenant topic, on every (re-)join and on every return to visible, page 1 of Novas is read again
 *   (`refreshNotificationsAction`) and rows not on screen yet are merged at the TOP by id; nothing
 *   already shown moves. When something was added and the page is visible, seen is POSTed again so
 *   the bell stays at zero. The list is NOT a live region and raises no toast (UI-SPEC Interaction).
 *   The seen/read markers on the own topic are ignored here (they add no row), so the seen POST can
 *   never loop back into another refetch.
 *
 * No clock is read and no catalog is formatted here beyond fixed labels: every sentence and relative
 * time arrives finished from the server (the page and the two actions).
 */
export function NotificationsSurface({
  initialUnread,
  initialUnreadCursor,
  initialRead,
  initialReadCursor,
  readStarted: initialReadStarted,
  initialError,
  tenantName,
  tenantId,
  userId,
}: NotificationsSurfaceProps) {
  const t = useTranslations('notifications');
  const te = useTranslations('app.error');
  const { show } = useToast();

  const [unread, setUnread] = useState(initialUnread);
  const [read, setRead] = useState(initialRead);
  const [unreadCursor, setUnreadCursor] = useState(initialUnreadCursor);
  const [readCursor, setReadCursor] = useState(initialReadCursor);
  const [readStarted, setReadStarted] = useState(initialReadStarted);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);
  /** Ids whose tint was cleared in place (a tap or mark-all) since the last load. */
  const [locallyRead, setLocallyRead] = useState<ReadonlySet<string>>(() => new Set());
  const [markingAll, setMarkingAll] = useState(false);

  // ── seen: once, after mount, while visible (UI-D-252) ──────────────────────────────────────────
  const seenPosted = useRef(false);
  useEffect(() => {
    const postSeen = () => {
      if (seenPosted.current) return;
      seenPosted.current = true;
      void fetch('/api/notifications/seen', { method: 'POST' }).catch(() => {});
    };
    if (document.visibilityState === 'visible') {
      postSeen();
      return;
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      postSeen();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // ── live merge: new rows at the top, never a move (07-03, D-240) ───────────────────────────────
  const shown = useRef({ unread, read });
  shown.current = { unread, read };
  const merging = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });

  const mergeLatest = useCallback(async () => {
    if (merging.current.busy) {
      merging.current.again = true;
      return;
    }
    merging.current.busy = true;
    try {
      do {
        merging.current.again = false;
        const result = await refreshNotificationsAction().catch(() => null);
        if (!result?.ok) continue;
        const known = new Set([...shown.current.unread, ...shown.current.read].map((v) => v.id));
        const fresh = result.unread.items.filter((view) => !known.has(view.id));
        if (fresh.length === 0) continue;
        setUnread((previous) => {
          const onScreen = new Set(previous.map((view) => view.id));
          const add = fresh.filter((view) => !onScreen.has(view.id));
          return add.length > 0 ? [...add, ...previous] : previous;
        });
        setFirstLoadFailed(false);
        if (document.visibilityState === 'visible') {
          void fetch('/api/notifications/seen', { method: 'POST' }).catch(() => {});
        }
      } while (merging.current.again);
    } finally {
      merging.current.busy = false;
    }
  }, []);

  const onLiveSignal = useCallback(
    (_event: string, payload: unknown) => {
      const kind = (payload as { kind?: unknown } | null)?.kind;
      if (typeof kind === 'string' && MARK_KINDS.has(kind)) return;
      void mergeLatest();
    },
    [mergeLatest],
  );
  const liveOptions = { onSubscribed: () => void mergeLatest() };
  useRealtimeTopic(userTopic(tenantId, userId), LIVE_EVENTS, onLiveSignal, liveOptions);
  useRealtimeTopic(tenantTopic(tenantId), LIVE_EVENTS, onLiveSignal, liveOptions);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void mergeLatest();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [mergeLatest]);

  const isUnread = useCallback(
    (view: NotificationRowView) => view.unread && !locallyRead.has(view.id),
    [locallyRead],
  );

  // ── read on tap: fire and forget, tint cleared in place ────────────────────────────────────────
  const activate = useCallback(
    (view: NotificationRowView) => {
      if (isUnread(view)) {
        void fetch(`/api/notifications/${encodeURIComponent(view.id)}/read`, {
          method: 'POST',
          keepalive: true,
        }).catch(() => {});
      }
      setLocallyRead((previous) => new Set(previous).add(view.id));
      if (view.removed) show({ tone: 'info', message: t('fallback.removed') });
    },
    [isUnread, show, t],
  );

  // ── mark all: optimistic, restored on failure ─────────────────────────────────────────────────
  const markAll = useCallback(async () => {
    const before = locallyRead;
    const everything = new Set(before);
    for (const view of [...unread, ...read]) everything.add(view.id);
    setMarkingAll(true);
    setLocallyRead(everything);
    let ok = false;
    try {
      const res = await fetch('/api/notifications/read-all', { method: 'POST' });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      setLocallyRead(before);
      show({ tone: 'error', message: t('errors.markAll') });
    }
    setMarkingAll(false);
  }, [locallyRead, unread, read, show, t]);

  // ── paging: Novas to its end, then Anteriores ──────────────────────────────────────────────────
  const hasMore = unreadCursor !== null || !readStarted || readCursor !== null;

  const loadMore = useCallback(async () => {
    try {
      if (unreadCursor !== null) {
        const page = await loadMoreNotificationsAction('unread', unreadCursor);
        if (!page.ok) return setPageFailed(true);
        setUnread((previous) => [...previous, ...page.items]);
        setUnreadCursor(page.nextCursor);
      } else if (!readStarted) {
        const page = await loadMoreNotificationsAction('read', null);
        if (!page.ok) return setPageFailed(true);
        setRead(page.items);
        setReadCursor(page.nextCursor);
        setReadStarted(true);
      } else if (readCursor !== null) {
        const page = await loadMoreNotificationsAction('read', readCursor);
        if (!page.ok) return setPageFailed(true);
        setRead((previous) => [...previous, ...page.items]);
        setReadCursor(page.nextCursor);
      }
      setPageFailed(false);
    } catch (error) {
      console.error('notifications.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [unreadCursor, readStarted, readCursor]);

  const refresh = useCallback(async () => {
    try {
      const result = await refreshNotificationsAction();
      if (!result.ok) {
        setFirstLoadFailed(unread.length === 0 && read.length === 0);
        return;
      }
      setUnread(result.unread.items);
      setUnreadCursor(result.unread.nextCursor);
      setRead(result.read?.items ?? []);
      setReadCursor(result.read?.nextCursor ?? null);
      setReadStarted(result.read !== null);
      setLocallyRead(new Set());
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('notifications.refresh_failed', { error: String(error) });
      setFirstLoadFailed(unread.length === 0 && read.length === 0);
    }
  }, [unread.length, read.length]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => setPageFailed(false), []);
  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  const renderRow = (view: NotificationRowView) => (
    <NotificationItem
      key={view.id}
      href={view.href}
      onActivate={() => activate(view)}
      unread={isUnread(view)}
      leading={view.leading}
      glyph={view.glyph}
      glyphTone={view.glyphTone}
      sentence={view.sentence}
      time={view.time}
      preview={view.preview}
      removed={view.removed}
      unreadLabel={t('unreadLabel')}
    />
  );

  let body: ReactNode;
  if (firstLoadFailed && unread.length === 0 && read.length === 0) {
    body = (
      <div className="px-4 pt-4">
        <EmptyState
          variant="card"
          icon={TriangleAlert}
          title={te('title')}
          body={te('body')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {te('retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (unread.length === 0 && read.length === 0 && !hasMore) {
    body = (
      <EmptyState
        icon={Bell}
        data-testid="notifications-empty"
        title={t('empty.title')}
        body={t('empty.body', { tenant: tenantName })}
      />
    );
  } else {
    const anyUnread = [...unread, ...read].some(isUnread);
    body = (
      <NotificationList
        ariaLabel={t('region', { tenant: tenantName })}
        unreadTitle={t('sections.unread')}
        unread={unread.map(renderRow)}
        readTitle={t('sections.read')}
        read={read.map(renderRow)}
        markAll={
          anyUnread ? (
            <Button
              variant="ghost"
              size="sm"
              loading={markingAll}
              onClick={markAll}
              data-testid="notifications-mark-all"
              className="shrink-0 whitespace-nowrap"
            >
              {t('markAll')}
            </Button>
          ) : null
        }
        footer={
          <>
            {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
            <InfiniteScroll
              hasMore={hasMore}
              enabled={!pageFailed}
              onLoadMore={loadMore}
              skeleton={<NotificationsSkeleton count={3} />}
            />
            {pageFailed ? (
              <div
                data-notifications-page-error
                className="mt-4 flex flex-col items-center gap-3 px-4 text-center"
              >
                <p className="text-sm font-normal text-danger">{t('errors.loadMore')}</p>
                <Button variant="outline" onClick={retryPage}>
                  {te('retry')}
                </Button>
              </div>
            ) : null}
            {!hasMore ? (
              <p
                data-testid="notifications-retention"
                className="px-4 pt-6 text-center text-xs text-text-tertiary"
              >
                {t('retention')}
              </p>
            ) : null}
          </>
        }
      />
    );
  }

  return <PullToRefresh onRefresh={refresh}>{body}</PullToRefresh>;
}
