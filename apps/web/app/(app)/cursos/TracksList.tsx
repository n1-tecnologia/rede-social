'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { TrackFilter } from '@rede-social/module-courses/contracts';
import { RowSkeleton, TrackRow } from '@rede-social/module-courses/ui';
import { Button, EmptyState, InfiniteScroll, PullToRefresh } from '@rede-social/ui';
import { CircleAlert, Route } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import type { CourseRowView } from '@/lib/courses-view';
import { loadMoreTracksAction, refreshTracksAction } from './actions';

export interface TracksListProps {
  /** Which list this is; the TAB decides it on the server and remounts the list per filter. */
  filter: TrackFilter;
  /** The tenant's display name (the list region's name). */
  tenantName: string;
  /** The first page the SERVER rendered, as finished views (`trackRowView`). */
  initialItems: CourseRowView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page (E04 error). */
  initialError?: boolean;
}

/** The 64px 16:10 thumb: one rung is enough, the ladder starts at 640. */
const THUMB_SIZES = '64px';

/** The first rows load eagerly; the rest are lazy. */
const EAGER_ROWS = 4;

/** Three row skeletons on load more (UI-D-401). */
const LOAD_MORE_SKELETONS = [0, 1, 2];

const LINK_BRAND =
  'inline-flex h-11 items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The gradient thumb a failed cover falls back to, the same size as the row's box (D-69). */
const GRADIENT_THUMB = (
  <span
    aria-hidden
    data-testid="track-row-thumb-fallback"
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

function NextRowsSkeleton() {
  return (
    <div aria-busy>
      {LOAD_MORE_SKELETONS.map((index) => (
        <RowSkeleton key={index} variant="wide" />
      ))}
    </div>
  );
}

/** The per-filter empty copy (UI-D-401, E04 empty): only "Ativas" carries the create action. */
const EMPTY_KEYS: Record<TrackFilter, { title: string; body: string; testId: string }> = {
  active: { title: 'tracks.empty.title', body: 'tracks.empty.body', testId: 'tracks-empty' },
  archived: {
    title: 'tracks.archivedEmpty.title',
    body: 'tracks.archivedEmpty.body',
    testId: 'tracks-empty-archived',
  },
};

/**
 * The Trilhas tab's list body (08.3-10, UI-D-392, UI-D-401): the `CoursesList` state machine over
 * `TrackRow`s — append-never-replace paging through `InfiniteScroll` (20 per page, 3 wide row
 * skeletons while a page is in flight), `PullToRefresh` on mobile, and four states only: an
 * unreadable first page (the error card with a retry), an empty first page (the filter's own empty
 * copy — "Criar trilha" on Ativas only), the rows, and a LOAD-MORE failure (the inline danger line
 * plus a retry AT the sentinel; the loaded rows stay).
 *
 * Every row arrives as a finished view (the published-only count, the "Arquivada" pill, the
 * accessible name), so nothing here formats, counts or sorts (P09, D-415). The thumb is the host's
 * `MediaImage` on the `cover` ladder at 16:10 (`TrackRow`'s `wide` slot); a cover that fails to load
 * falls back to the gradient thumb of the same size (D-69).
 */
export function TracksList({
  filter,
  tenantName,
  initialItems,
  initialCursor,
  initialError,
}: TracksListProps) {
  const t = useTranslations('courses');

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

  /** Page 1 again; the rows never become skeletons, so a pull shows only the brand loader. */
  const refresh = useCallback(async () => {
    try {
      const page = await refreshTracksAction(filter);
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('courses.tracks_refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [filter, items.length]);

  /** APPEND: every row already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreTracksAction(filter, cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((previous) => {
        // A track can never show twice, even if a page boundary moved under a concurrent write.
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      // The sentinel hook swallows a rejection; without this catch a dead network would spin forever.
      console.error('courses.tracks_load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor, filter]);

  /** Re-arms the sentinel (which is on screen under the retry) rather than fetching twice. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4 pt-2">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="tracks-error"
          title={t('errors.title')}
          body={t('errors.tracks')}
          action={
            <Button variant="outline" onClick={retryFirst}>
              {t('errors.retry')}
            </Button>
          }
        />
      </div>
    );
  } else if (items.length === 0) {
    const empty = EMPTY_KEYS[filter];
    body = (
      <div className="px-4 pt-2">
        <EmptyState
          variant="card"
          icon={Route}
          data-testid={empty.testId}
          title={t(empty.title)}
          body={t(empty.body)}
          action={
            filter === 'active' ? (
              <a href="/cursos/trilhas/nova" className={LINK_BRAND}>
                {t('tracks.empty.cta')}
              </a>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        <ol
          aria-label={t('tracks.region', { tenant: tenantName })}
          data-testid="tracks-list"
          className="flex flex-col divide-y divide-divider"
        >
          {items.map((item, index) => (
            <li key={item.id}>
              <TrackRow
                href={item.href}
                ariaLabel={item.ariaLabel}
                title={item.title}
                meta={item.meta}
                pills={item.pills}
                thumb={
                  item.coverAssetId ? (
                    <MediaImage
                      assetId={item.coverAssetId}
                      widths={PURPOSE_WIDTHS.cover}
                      alt={item.coverAlt}
                      sizes={THUMB_SIZES}
                      eager={index < EAGER_ROWS}
                      ratio=""
                      className="h-full w-full"
                      fallback={GRADIENT_THUMB}
                    />
                  ) : undefined
                }
              />
            </li>
          ))}
        </ol>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<NextRowsSkeleton />}
        />

        {pageFailed ? (
          <div
            role="alert"
            data-tracks-page-error
            className="mt-3 flex flex-col items-center gap-3 px-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('errors.loadMoreTracks')}</p>
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
      <section className="flex flex-col pb-6">{body}</section>
    </PullToRefresh>
  );
}
