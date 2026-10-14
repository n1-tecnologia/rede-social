'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { LiveFilter } from '@rede-social/module-courses/contracts';
import { LiveRow, RowSkeleton } from '@rede-social/module-courses/ui';
import { Button, EmptyState, InfiniteScroll, PullToRefresh } from '@rede-social/ui';
import { CircleAlert, Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import type { CourseRowView } from '@/lib/courses-view';
import { loadMoreLivesAction, refreshLivesAction } from './actions';

export interface LivesListProps {
  /** Which bucket this is; the TAB decides it on the server and remounts the list per filter. */
  filter: LiveFilter;
  /** The tenant's display name (the list region's name). */
  tenantName: string;
  /** The first page the SERVER rendered, as finished views (`liveRowView`). */
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
    data-testid="live-row-thumb-fallback"
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

/** The per-filter empty copy (UI-D-401, E04 empty): only "Próximas" carries the create action. */
const EMPTY_KEYS: Record<LiveFilter, { title: string; body: string; testId: string }> = {
  upcoming: { title: 'lives.empty.title', body: 'lives.empty.body', testId: 'lives-empty' },
  past: {
    title: 'lives.pastEmpty.title',
    body: 'lives.pastEmpty.body',
    testId: 'lives-empty-past',
  },
};

/**
 * The Lives tab's list body (08.3-11, UI-D-392, UI-D-401): the `TracksList` state machine over
 * `LiveRow`s — append-never-replace paging through `InfiniteScroll` (20 per page, 3 wide row
 * skeletons while a page is in flight), `PullToRefresh` on mobile, and four states only: an
 * unreadable first page (the error card with a retry), an empty first page (the bucket's own empty
 * copy — "Agendar live" on Próximas only), the rows, and a LOAD-MORE failure (the inline danger line
 * plus a retry AT the sentinel; the loaded rows stay).
 *
 * Every row arrives as a finished view (the tenant-timezone date line, the DERIVED status pill, the
 * accessible name), so nothing here formats, reads the clock or sorts (P09, D-416, UI-D-407). The
 * thumb is the host's `MediaImage` on the `cover` ladder at 16:10 (`LiveRow`'s `wide` slot); a cover
 * that fails to load falls back to the gradient thumb of the same size (D-69).
 */
export function LivesList({
  filter,
  tenantName,
  initialItems,
  initialCursor,
  initialError,
}: LivesListProps) {
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
      const page = await refreshLivesAction(filter);
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('courses.lives_refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [filter, items.length]);

  /** APPEND: every row already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreLivesAction(filter, cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((previous) => {
        // A live can never show twice, even if a page boundary moved under a concurrent write.
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      // The sentinel hook swallows a rejection; without this catch a dead network would spin forever.
      console.error('courses.lives_load_more_failed', { error: String(error) });
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
          data-testid="lives-error"
          title={t('errors.title')}
          body={t('errors.lives')}
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
          icon={Radio}
          data-testid={empty.testId}
          title={t(empty.title)}
          body={t(empty.body)}
          action={
            filter === 'upcoming' ? (
              <a href="/cursos/lives/nova" className={LINK_BRAND}>
                {t('lives.empty.cta')}
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
          aria-label={t('lives.region', { tenant: tenantName })}
          data-testid="lives-list"
          className="flex flex-col divide-y divide-divider"
        >
          {items.map((item, index) => (
            <li key={item.id}>
              <LiveRow
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
            data-lives-page-error
            className="mt-3 flex flex-col items-center gap-3 px-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{t('errors.loadMoreLives')}</p>
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
