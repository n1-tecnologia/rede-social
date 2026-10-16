'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { MediaImage } from '@rede-social/core/ui';
import type { CourseFilter } from '@rede-social/module-courses/contracts';
import { CourseRow, RowSkeleton } from '@rede-social/module-courses/ui';
import { Button, EmptyState, InfiniteScroll, PullToRefresh } from '@rede-social/ui';
import { CircleAlert, Eye, GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import type { CourseRowView } from '@/lib/courses-view';
import { loadMoreCoursesAction, refreshCoursesAction } from './actions';

export interface CoursesListProps {
  /** Which list this is; the TAB decides it on the server and remounts the list per filter. */
  filter: CourseFilter;
  /** The tenant's display name (the list region's name). */
  tenantName: string;
  /** The first page the SERVER rendered, as finished views. */
  initialItems: CourseRowView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page (E03 error). */
  initialError?: boolean;
}

/** The 40px poster thumb: one rung is enough, the ladder starts at 640. */
const THUMB_SIZES = '40px';

/** The first rows load eagerly; the rest are lazy. */
const EAGER_ROWS = 4;

/** Three row skeletons on load more (UI-D-401). */
const LOAD_MORE_SKELETONS = [0, 1, 2];

const LINK_BRAND =
  'inline-flex h-11 items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/**
 * The "Ver como aluno" eye (08.5-10, D-422, UI-D-437): a 44px neutral `<a>` SIBLING of the row link
 * (anchors never nest), with the shipped focus ring; no brand fill.
 */
const EYE_LINK =
  'mr-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-bg-hover active:bg-bg-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The gradient thumb a failed cover falls back to, the same size as the row's box (D-69). */
const GRADIENT_THUMB = (
  <span
    aria-hidden
    data-testid="course-row-thumb-fallback"
    className="block h-full w-full"
    style={{ backgroundImage: 'var(--brand-gradient)' }}
  />
);

function NextRowsSkeleton() {
  return (
    <div aria-busy>
      {LOAD_MORE_SKELETONS.map((index) => (
        <RowSkeleton key={index} />
      ))}
    </div>
  );
}

/** The per-filter empty copy (UI-D-401, E03 empty): only "Todos" carries the create action. */
const EMPTY_KEYS: Record<CourseFilter, { title: string; body: string; testId: string }> = {
  all: { title: 'list.empty.title', body: 'list.empty.body', testId: 'courses-empty' },
  draft: {
    title: 'list.draftsEmpty.title',
    body: 'list.draftsEmpty.body',
    testId: 'courses-empty-drafts',
  },
  published: {
    title: 'list.publishedEmpty.title',
    body: 'list.publishedEmpty.body',
    testId: 'courses-empty-published',
  },
  archived: {
    title: 'list.archivedEmpty.title',
    body: 'list.archivedEmpty.body',
    testId: 'courses-empty-archived',
  },
};

/**
 * The Cursos tab's list body (08.3-06, UI-D-392, UI-D-401), the `ProductGrid` state machine:
 * append-never-replace paging through the shipped `InfiniteScroll` sentinel (20 per page, 3 row
 * skeletons while a page is in flight), `PullToRefresh` on mobile, and four states only: an
 * unreadable first page (the error card with a retry), an empty first page (the filter's own empty
 * copy, never rendered from a failed page), the rows, and a LOAD-MORE failure (an inline danger line
 * plus a retry AT the sentinel; the loaded rows stay).
 *
 * Every row arrives as a finished view (the meta, the pills, the accessible name), so nothing here
 * formats or sorts (P09): pages are appended in the API's order and an id can never show twice. The
 * thumb is the host's `MediaImage` on the `cover` ladder at 3:4; a cover that fails to load falls
 * back to the gradient thumb of the same size (D-69).
 *
 * "Ver como aluno" (08.5-10, D-422, UI-D-437, planning decision 2): a PUBLISHED row becomes a
 * `flex items-center` pair — the shipped `CourseRow` link (`min-w-0 flex-1`, so the name truncates
 * first) and, after it, the 44px eye to `/cursos/{id}?ver=aluno` named "Ver como aluno: {course}".
 * Drafts and archived rows keep the bare row; the module's `CourseRow` is unchanged.
 */
export function CoursesList({
  filter,
  tenantName,
  initialItems,
  initialCursor,
  initialError,
}: CoursesListProps) {
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
      const page = await refreshCoursesAction(filter);
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('courses.refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [filter, items.length]);

  /** APPEND: every row already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreCoursesAction(filter, cursor);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((previous) => {
        // A course can never show twice, even if a page boundary moved under a concurrent write.
        const seen = new Set(previous.map((item) => item.id));
        return [...previous, ...page.items.filter((item) => !seen.has(item.id))];
      });
      setCursor(page.nextCursor);
    } catch (error) {
      // The sentinel hook swallows a rejection; without this catch a dead network would spin forever.
      console.error('courses.load_more_failed', { error: String(error) });
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
          data-testid="courses-error"
          title={t('errors.title')}
          body={t('errors.list')}
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
          icon={GraduationCap}
          data-testid={empty.testId}
          title={t(empty.title)}
          body={t(empty.body)}
          action={
            filter === 'all' ? (
              <a href="/cursos/novo" className={LINK_BRAND}>
                {t('list.empty.cta')}
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
          aria-label={t('list.region', { tenant: tenantName })}
          data-testid="courses-list"
          className="flex flex-col divide-y divide-divider"
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              className={item.status === 'published' ? 'flex items-center' : undefined}
            >
              <div className={item.status === 'published' ? 'min-w-0 flex-1' : undefined}>
                <CourseRow
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
              </div>
              {item.status === 'published' ? (
                <a
                  href={`/cursos/${encodeURIComponent(item.id)}?ver=aluno`}
                  aria-label={t('list.viewAsMember', { course: item.title })}
                  data-testid="course-row-view-as-member"
                  className={EYE_LINK}
                >
                  <Eye aria-hidden size={20} className="shrink-0" />
                </a>
              ) : null}
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
            data-courses-page-error
            className="mt-3 flex flex-col items-center gap-3 px-4 text-center"
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
      <section className="flex flex-col pb-6">{body}</section>
    </PullToRefresh>
  );
}
