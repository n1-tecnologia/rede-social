'use client';

import type { EventPeriod } from '@tria/module-events/contracts';
import { EventPoster } from '@tria/module-events/ui';
import { Button, EmptyState, InfiniteScroll, PullToRefresh, Skeleton } from '@tria/ui';
import { CalendarDays, History, Plus, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import type { EventPosterView } from '@/lib/events-view';
import { loadMoreEventsAction, refreshEventsAction } from './actions';

export interface EventsListProps {
  /** The first page the SERVER rendered, already formatted — the list owns every page after it. */
  initialItems: EventPosterView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all (UI-D-216). */
  initialError?: boolean;
  /** The tenant's display name, interpolated into the Próximos empty state and the region label. */
  tenantName: string;
  /** Which chip this is. The PAGE decides it and remounts this component per period. */
  period: EventPeriod;
  /**
   * The composed `events.event.manage` permission (06-04): the Próximos empty state then speaks to
   * the manager and carries the brand "Criar evento" link beside the title-row control (D-77).
   */
  canManage?: boolean;
}

/** The geometry of a real poster: a 4/5 rounded block (UI-D-216). */
function PosterSkeleton({ className }: { className?: string }) {
  return (
    <Skeleton variant="rect" className={`aspect-[4/5] w-full rounded-xl ${className ?? ''}`} />
  );
}

/**
 * Two poster skeletons in the grid's own geometry, shared with `loading.tsx` so the first paint and
 * the skeleton match (UI-D-216). At load-more the list shows ONE per column: the second hides below
 * `sm`, where the grid has one column.
 */
export function EventsSkeleton() {
  return (
    <div
      aria-busy
      data-testid="events-skeleton"
      className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2"
    >
      <PosterSkeleton />
      <PosterSkeleton className="hidden sm:block" />
    </div>
  );
}

/**
 * The `/eventos` list body (EVENT-02, UI-D-200, UI-D-216), the `CommunitiesList` machine over the
 * events keyset: a page APPENDS, so every poster on screen keeps its position; a load-more failure
 * renders an inline danger line plus a retry AT THE SENTINEL and never discards what is loaded.
 *
 * It receives FINISHED `EventPosterView`s from the server (the page and the two actions): no instant
 * is formatted and no clock is read here (UI-D-203). Ordering is the server's, never restated.
 *
 * Four states: an unreadable first page (the generic error card with a retry), an empty period (its
 * own named state; a manager gets its own body and the brand "Criar evento" link), the grid, and
 * the load-more failure. The first two posters load eagerly, the rest lazily.
 */
export function EventsList({
  initialItems,
  initialCursor,
  initialError,
  tenantName,
  period,
  canManage = false,
}: EventsListProps) {
  const t = useTranslations('events');

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);

  // The SERVER sent a different first page (a navigation, not a refresh): re-seed rather than merge.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
  }

  /** Page 1 of THIS period again; the posters never become skeletons (brand loader only). */
  const refresh = useCallback(async () => {
    try {
      const page = await refreshEventsAction(period);
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('events.refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [items.length, period]);

  /** APPEND: every poster already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreEventsAction(period, cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      console.error('events.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor, period]);

  /** Re-arms the sentinel (which is on screen) rather than fetching, so one tap loads one page. */
  const retryPage = useCallback(() => {
    setPageFailed(false);
  }, []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={TriangleAlert}
          title={t('errors.title')}
          body={t('errors.generic')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {t('errors.retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0 && period === 'past') {
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={History}
          data-testid="events-empty-past"
          title={t('empty.past.title')}
          body={t('empty.past.body')}
        />
      </div>
    );
  } else if (items.length === 0) {
    // D-77: the tab stays visible with zero events — navigation is driven by the module flag.
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={CalendarDays}
          data-testid="events-empty-upcoming"
          title={t('empty.upcoming.title')}
          body={
            canManage
              ? t('empty.upcoming.bodyManager')
              : t('empty.upcoming.body', { tenant: tenantName })
          }
          action={
            canManage ? (
              <a
                href="/eventos/novo"
                data-events-empty-create
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                <Plus aria-hidden size={16} />
                {t('actions.create')}
              </a>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        <div className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2">
          {items.map((poster, index) => (
            <EventPoster
              key={poster.id}
              href={poster.href}
              ariaLabel={poster.ariaLabel}
              title={poster.title}
              overline={poster.overline}
              overlineLive={poster.overlineLive}
              place={poster.place}
              placeKind={poster.placeKind}
              pill={poster.pill}
              coverAssetId={poster.coverAssetId}
              coverVariantWidths={poster.coverVariantWidths}
              coverAlt={poster.coverAlt}
              meta={poster.meta}
              grayscale={poster.grayscale}
              eager={index < 2}
            />
          ))}
        </div>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<EventsSkeleton />}
          className="mt-4"
        />

        {pageFailed ? (
          <div
            data-events-page-error
            className="mt-4 flex flex-col items-center gap-3 px-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('errors.loadMore')}</p>
            <Button variant="outline" onClick={retryPage}>
              {t('errors.retry')}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <section
        aria-label={
          period === 'past'
            ? t('list.regionPast', { tenant: tenantName })
            : t('list.regionUpcoming', { tenant: tenantName })
        }
        className="flex flex-col pb-6"
      >
        {body}
      </section>
    </PullToRefresh>
  );
}
