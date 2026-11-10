'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { CourseCard } from '@rede-social/module-courses/ui';
import { ExclusiveBadge } from '@rede-social/module-store/ui';
import {
  Button,
  buttonClasses,
  cn,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
} from '@rede-social/ui';
import { CircleAlert, GraduationCap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import { type CourseCardView, catalogueCategoryHref } from '@/lib/courses-member-view';
import { loadMoreCatalogueAction, refreshCatalogueAction } from './learn-actions';
import { MEMBER_EMPTY_WIDE, MemberEmptyCard } from './MemberEmptyCard';
import { riseStyle } from './rise';

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

/**
 * 2026-10-26 (the academy reference's catalogue): the card is a panel with the cover on top, so one
 * a row on a phone, two from 480px, three from `lg` and four from `xl` (it was a 3:4 poster grid).
 */
export const CARD_GRID =
  'grid grid-cols-1 gap-4 px-4 min-[480px]:grid-cols-2 lg:grid-cols-3 lg:gap-5 xl:grid-cols-4';

/** "Ver todos os cursos": the `outline md` look from `buttonClasses`, active state included. */
const LINK_OUTLINE = buttonClasses({ variant: 'outline', size: 'md' });

/**
 * The over-media "Produto arquivado" pill (UI-D-426), in the poster's glass-chip family since
 * 2026-10-22 (9px, uppercase, `bg-black/55`). On a 320px phone a poster's tag stack is ~120px wide
 * and the two words may not fit, so this pill WRAPS onto a second line instead of truncating (the
 * E03 long-text backstop: both tags stay readable); `rounded-[10px]` reads as the pill on one line and
 * stays a soft rectangle on two.
 */
const OVER_MEDIA_PILL =
  'ms-chip max-w-full whitespace-normal rounded-[10px] bg-black/55 px-2 py-0.5 text-left text-[9px] font-bold uppercase leading-tight tracking-wider text-white backdrop-blur-sm';

/**
 * The poster skeletons, at the grid's geometry (UI-D-425): 4 on first load, 2 on load more.
 * 2026-10-23: `wideCount` fills the wider rows of a desktop (the extra ones from `lg` only).
 */
export function PosterSkeletons({
  count,
  wideCount = count,
}: {
  count: number;
  wideCount?: number;
}) {
  return (
    <div aria-busy data-testid="courses-member-skeleton" className={CARD_GRID}>
      {Array.from({ length: Math.max(count, wideCount) }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
          key={index}
          className={cn(
            'ms-panel ms-solid flex flex-col overflow-hidden rounded-2xl border border-border bg-card',
            index >= count && 'hidden lg:flex',
          )}
        >
          <Skeleton variant="rect" className="aspect-video w-full rounded-none" />
          <div className="flex flex-col gap-2.5 p-4">
            <Skeleton className="h-4 w-3/4" />
            <div className="flex justify-between">
              <Skeleton className="h-3 w-1/4" />
              <Skeleton className="h-3 w-1/5" />
            </div>
          </div>
        </div>
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
 *
 * **2026-10-22 (the courses area redesign on the social-igoralves prototype).** The prototype's
 * posters (the frame, the padlock disc on a locked course, the check on a completed one, the glass
 * chips: the compact "Exclusivo" and "Produto arquivado", or the category), 16px under the chip
 * strip; the grid fades and rises in when it mounts, so a category switch (which remounts it) lands
 * with the prototype's swap (`animate-swap-in`, none under "reduzir movimento"). The empty and error
 * states are the area's `MemberEmptyCard`.
 *
 * 2026-10-23 (the wide desktop): the grid grows to 4 posters a row from `lg` and 5 from `xl`, and
 * the empty and error cards keep a readable width there (`MEMBER_EMPTY_WIDE`).
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
          <ExclusiveBadge label={t('member.tags.exclusiveCourse')} size="compact" />
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
      <div className="px-4 pt-4">
        <MemberEmptyCard
          icon={CircleAlert}
          tone="error"
          data-testid="courses-member-error"
          className={MEMBER_EMPTY_WIDE}
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
        <div className="px-4 pt-4">
          <MemberEmptyCard
            icon={GraduationCap}
            data-testid="courses-member-empty"
            className={MEMBER_EMPTY_WIDE}
            title={t('member.catalogue.empty.title')}
            body={t('member.catalogue.empty.body', { tenant: tenantName })}
          />
        </div>
      ) : (
        <div className="px-4 pt-4">
          <MemberEmptyCard
            icon={GraduationCap}
            data-testid="courses-member-category-empty"
            className={MEMBER_EMPTY_WIDE}
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
          className={`${CARD_GRID} animate-swap-in pt-3 pb-6 motion-reduce:animate-none`}
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              data-course-card={item.id}
              className="ms-rise min-w-0"
              style={riseStyle(index)}
            >
              <CourseCard
                href={item.href}
                ariaLabel={item.ariaLabel}
                title={item.title}
                categoryLine={item.categoryLine}
                meta={item.meta}
                duration={item.duration}
                coverAssetId={item.coverAssetId}
                coverWidths={PURPOSE_WIDTHS.cover}
                tags={tagsOf(item)}
                progress={item.progress}
                locked={item.tags.exclusive}
                done={item.progress !== null && item.progress.percent >= 100}
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
