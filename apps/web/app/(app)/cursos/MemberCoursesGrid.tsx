'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { CourseCard } from '@rede-social/module-courses/ui';
import { ExclusiveBadge } from '@rede-social/module-store/ui';
import {
  Button,
  chipBase,
  cn,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
} from '@rede-social/ui';
import { CircleAlert, GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import { type CourseCardView, catalogueCategoryHref } from '@/lib/courses-member-view';
import { loadMoreCatalogueAction, refreshCatalogueAction } from './learn-actions';

export interface MemberCoursesGridProps {
  /** The category the TAB decided on the server (`null` = "Todas"); the grid remounts per value. */
  categoryId: string | null;
  /** The tenant's display name (the grid region's name and the empty body). */
  tenantName: string;
  /** A manager's `?ver=aluno` preview: links keep the flag (UI-D-437). */
  preview: boolean;
  /** The first page the SERVER rendered, as finished card views. */
  initialItems: CourseCardView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page (E03 error). */
  initialError?: boolean;
}

/** The first posters load eagerly (two rows on a phone); the rest are lazy. */
const EAGER_CARDS = 4;

/** Two poster skeletons on load more (UI-D-425). */
const LOAD_MORE_SKELETONS = [0, 1];

const GRID = 'grid grid-cols-2 gap-3 px-4 sm:grid-cols-3';

const LINK_OUTLINE =
  'inline-flex h-11 items-center justify-center rounded-xl border border-border-secondary px-5 text-sm font-bold text-text transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg';

/** The over-media "Produto arquivado" pill (UI-D-426): `chipBase` on the over-media ground. */
const OVER_MEDIA_PILL = cn(chipBase, 'max-w-full truncate bg-black/60 text-white backdrop-blur-sm');

/** The poster skeletons, at the grid's geometry (UI-D-425): 4 on first load, 2 on load more. */
export function PosterSkeletons({ count }: { count: number }) {
  return (
    <div aria-busy data-testid="courses-member-skeleton" className={GRID}>
      {Array.from({ length: count }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
          key={index}
          variant="rect"
          className="aspect-[3/4] rounded-xl"
        />
      ))}
    </div>
  );
}

/**
 * The member Cursos tab's grid (08.5-06, UI-D-425, UI-D-426, E03), the `CoursesList` state machine
 * on posters: append-never-replace keyset paging through the shipped `InfiniteScroll` sentinel (20 per
 * page, 2 poster skeletons while a page is in flight), `PullToRefresh` on mobile, and four states:
 * an unreadable first page (the shipped error card with its retry), an empty first page (the
 * catalogue's or the category's own empty copy), the posters, and a LOAD-MORE failure (an inline
 * line plus a retry; the loaded cards stay).
 *
 * Every card arrives as a finished view (lines, meta, tags, progress, accessible name), so nothing
 * here formats or sorts (P09). The store's tags are composed HERE, in the app tier (MOD-02): the
 * courses module never imports the store.
 */
export function MemberCoursesGrid({
  categoryId,
  tenantName,
  preview,
  initialItems,
  initialCursor,
  initialError,
}: MemberCoursesGridProps) {
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

  /** Page 1 again; the cards never become skeletons, so a pull shows only the brand loader. */
  const refresh = useCallback(async () => {
    try {
      const page = await refreshCatalogueAction(categoryId, preview);
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('courses.catalogue_refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [categoryId, preview, items.length]);

  /** APPEND: every card already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreCatalogueAction(categoryId, cursor, preview);
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
      console.error('courses.catalogue_load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [categoryId, cursor, preview]);

  /** Re-arms the sentinel (which is on screen under the retry) rather than fetching twice. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  /** The store's tags, composed in the app tier (UI-D-426): "Exclusivo", then "Produto arquivado". */
  const tagsOf = (view: CourseCardView): ReactNode =>
    view.tags.exclusive ? (
      <>
        <span className="max-w-full shrink-0 overflow-hidden">
          <ExclusiveBadge label={t('member.tags.exclusiveCourse')} />
        </span>
        {view.tags.archived ? (
          <span data-testid="course-card-archived" className={OVER_MEDIA_PILL}>
            {t('member.tags.productArchived')}
          </span>
        ) : null}
      </>
    ) : undefined;

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <div className="px-4 pt-2">
        <EmptyState
          variant="card"
          icon={CircleAlert}
          data-testid="courses-member-error"
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
    body =
      categoryId === null ? (
        <div className="px-4 pt-2">
          <EmptyState
            variant="card"
            icon={GraduationCap}
            data-testid="courses-member-empty"
            title={t('member.catalogue.empty.title')}
            body={t('member.catalogue.empty.body', { tenant: tenantName })}
          />
        </div>
      ) : (
        <div className="px-4 pt-2">
          <EmptyState
            variant="card"
            icon={GraduationCap}
            data-testid="courses-member-category-empty"
            title={t('member.catalogue.categoryEmpty.title')}
            body={t('member.catalogue.categoryEmpty.body')}
            action={
              <a href={catalogueCategoryHref(null, preview)} className={LINK_OUTLINE}>
                {t('member.catalogue.categoryEmpty.cta')}
              </a>
            }
          />
        </div>
      );
  } else {
    body = (
      <>
        <ul
          aria-label={t('list.region', { tenant: tenantName })}
          data-testid="courses-member-grid"
          className={`${GRID} pb-6`}
        >
          {items.map((item, index) => (
            <li key={item.id} data-course-card={item.id} className="min-w-0">
              <CourseCard
                href={item.href}
                ariaLabel={item.ariaLabel}
                title={item.title}
                categoryLine={item.categoryLine}
                meta={item.meta}
                coverAssetId={item.coverAssetId}
                coverWidths={PURPOSE_WIDTHS.cover}
                tags={tagsOf(item)}
                progress={item.progress}
                eager={index < EAGER_CARDS}
              />
            </li>
          ))}
        </ul>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<PosterSkeletons count={LOAD_MORE_SKELETONS.length} />}
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
