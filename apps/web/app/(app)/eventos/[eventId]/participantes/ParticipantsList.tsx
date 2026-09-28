'use client';

import type { AttendanceList } from '@rede-social/module-events/contracts';
import { AttendeeRow } from '@rede-social/module-events/ui';
import {
  Button,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
  StatusPill,
} from '@rede-social/ui';
import { TriangleAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import type { AttendeeView } from '@/lib/events-view';
import { loadMoreAttendanceAction, refreshAttendanceAction } from '../../actions';

export interface ParticipantsListProps {
  eventId: string;
  /** Which chip this is. The PAGE decides it and remounts this component per chip. */
  list: AttendanceList;
  /** The first page the SERVER rendered, already formatted: the list owns every page after it. */
  initialItems: AttendeeView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all (UI-D-216). */
  initialError?: boolean;
}

/** Each chip's own empty state (UI-SPEC Copywriting "Participantes" empties). */
const EMPTY_KEYS: Readonly<Record<AttendanceList, 'confirmed' | 'present' | 'notGoing'>> = {
  confirmed: 'confirmed',
  present: 'present',
  not_going: 'notGoing',
};

/**
 * Six rows in the row's own geometry (UI-D-216): a 32px circle and two bars, so nothing shifts when
 * the real rows swap in.
 */
export function ParticipantsSkeleton() {
  return (
    <div aria-busy data-testid="participants-skeleton" className="flex flex-col px-4">
      {Array.from({ length: 6 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: six identical static placeholders.
        <div key={index} className="flex min-h-14 items-center gap-3 border-b border-divider py-2">
          <Skeleton variant="circle" className="h-8 w-8" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" className="w-3/5" />
            <Skeleton variant="text" className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The `Participantes` list body (EVENT-05, UI-D-213, UI-D-216), the `EventsList` machine over one
 * attendance chip: a page APPENDS, so every row on screen keeps its position; a load-more failure
 * renders the inline danger line plus a retry AT THE SENTINEL and never discards what is loaded; the
 * mobile pull refreshes page 1 of THIS chip (05.1 Pitfall 9: the list is threaded through both
 * actions).
 *
 * It receives FINISHED `AttendeeView`s from the server: no instant is formatted and no clock is read
 * here (UI-D-203). Rows are `AttendeeRow`s and are NOT links (D-47). In Presentes a walk-in carries
 * the neutral `StatusPill` "Sem confirmação" as its trailing tag; in the other chips there is none.
 *
 * Four states: an unreadable first page (the generic error card with a retry), the chip's own empty
 * state, the rows, and the load-more failure. The code card above always renders, so the screen is
 * never blank (UI E11/empty).
 */
export function ParticipantsList({
  eventId,
  list,
  initialItems,
  initialCursor,
  initialError,
}: ParticipantsListProps) {
  const t = useTranslations('events');

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);

  // The SERVER sent a different first page (a refresh after a regeneration): re-seed, never merge.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
  }

  /** Page 1 of THIS chip again; the rows never become skeletons (brand loader only). */
  const refresh = useCallback(async () => {
    try {
      const page = await refreshAttendanceAction(eventId, list);
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('events.attendance_refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [eventId, items.length, list]);

  /** APPEND: every row already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreAttendanceAction(eventId, list, cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      console.error('events.attendance_load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor, eventId, list]);

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
  } else if (items.length === 0) {
    const key = EMPTY_KEYS[list];
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={Users}
          data-testid="participants-empty"
          data-list={list}
          title={t(`participants.empty.${key}.title`)}
          body={t(`participants.empty.${key}.body`)}
        />
      </div>
    );
  } else {
    body = (
      <>
        <div className="flex flex-col px-4">
          {items.map((row) => (
            <AttendeeRow
              key={row.id}
              name={row.name}
              removed={row.removed}
              avatarUrl={row.avatarUrl}
              meta={row.meta}
              tag={
                list === 'present' && row.walkIn ? (
                  <StatusPill tone="neutral" data-testid="walk-in-tag">
                    {t('state.walkIn')}
                  </StatusPill>
                ) : undefined
              }
            />
          ))}
        </div>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<ParticipantsSkeleton />}
          className="mt-2"
        />

        {pageFailed ? (
          <div
            data-participants-page-error
            className="mt-4 flex flex-col items-center gap-3 px-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('participants.errors.loadMore')}</p>
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
      <section aria-label={t('participants.region')} className="flex flex-col pb-6">
        {body}
      </section>
    </PullToRefresh>
  );
}
