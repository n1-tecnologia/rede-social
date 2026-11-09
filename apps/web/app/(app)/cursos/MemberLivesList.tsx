'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { LiveCard } from '@rede-social/module-courses/ui';
import { ExclusiveBadge } from '@rede-social/module-store/ui';
import { Button, InfiniteScroll, Skeleton } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import type { LiveCardView } from '@/lib/courses-member-view';
import { loadMoreLivesAction } from './learn-actions';
import { riseStyle } from './rise';

/** The "Gravadas" grid (UI-D-434): two columns, three from 640px, four from `lg` (2026-10-23). */
export const LIVES_GRID =
  'grid grid-cols-1 gap-4 px-4 min-[480px]:grid-cols-2 lg:grid-cols-3 lg:gap-5 xl:grid-cols-4';

/** Two card skeletons on load more of "Gravadas" (E04 loading). */
const LOAD_MORE_SKELETONS = 2;

/** The first cards of a screen load eagerly; the rest are lazy. */
const EAGER_CARDS = 4;

/**
 * The live card skeletons (E04 loading), at the 2026-10-22 tile's geometry: the 16:10 rect IS the
 * card (the words sit on the cover), outlined like the tiles. No words. Used for the "Gravadas" load
 * more; the screen's first load is `LivesSkeleton` (2026-10-23).
 */
export function LiveCardSkeletons({ count }: { count: number }) {
  return (
    <div aria-busy data-testid="lives-member-skeleton" className={LIVES_GRID}>
      {Array.from({ length: count }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
          key={index}
          className="ms-panel ms-solid flex flex-col overflow-hidden rounded-2xl border border-border bg-card"
        >
          <Skeleton variant="rect" className="aspect-video w-full rounded-none" />
          <div className="flex flex-col gap-2.5 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One live card with the store's tag composed in the app tier (MOD-02): the courses module never
 * imports the store. Used by both groups, so "Próximas" (server-rendered) and "Gravadas" (paged
 * here) can never draw a card differently. 2026-10-22: the host picks the card's `variant` (the
 * spotlight, an agenda row or a tile) and the tag is the compact glass "Exclusiva".
 */
export function MemberLiveCard({
  view,
  eager = false,
  variant = 'card',
  wide = false,
}: {
  view: LiveCardView;
  eager?: boolean;
  variant?: 'card' | 'spotlight' | 'agenda';
  /** The spotlight alone across the row (3:1 from `lg`). */
  wide?: boolean;
}) {
  const t = useTranslations('courses');
  return (
    <LiveCard
      variant={variant}
      wide={wide}
      href={view.href}
      ariaLabel={view.ariaLabel}
      title={view.title}
      meta={view.meta}
      statusLabel={view.statusLabel}
      statusIcon={view.statusIcon}
      coverAssetId={view.coverAssetId}
      coverWidths={PURPOSE_WIDTHS.cover}
      cancelled={view.cancelled}
      day={view.day}
      month={view.month}
      timeLine={view.timeLine}
      eager={eager}
      tags={
        view.exclusive ? (
          <ExclusiveBadge label={t('member.tags.exclusiveLive')} size="compact" />
        ) : undefined
      }
    />
  );
}

export interface MemberLivesListProps {
  /** The `<ul>`'s name: the group's heading id. */
  labelledBy: string;
  /** A manager's `?ver=aluno` preview: links keep the flag (UI-D-437). */
  preview: boolean;
  /** The first "Gravadas" page the SERVER rendered, as finished views. */
  initialItems: LiveCardView[];
  initialCursor: string | null;
}

/**
 * The "Gravadas" group's grid (08.5-06, UI-D-434, E04): the ONLY group that pages. Append-never-
 * replace keyset paging through the shipped `InfiniteScroll` (2 card skeletons while a page is in
 * flight), and a LOAD-MORE failure as an inline line plus a retry with the loaded cards kept. Every
 * card arrives finished (status words, tenant-time meta, tag, name): nothing here reads the clock
 * (UI-D-288), formats or sorts (P09). 2026-10-22: the prototype's tiles (the words on the cover, the
 * ▶ chip of a replay).
 */
export function MemberLivesList({
  labelledBy,
  preview,
  initialItems,
  initialCursor,
}: MemberLivesListProps) {
  const t = useTranslations('courses');

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [pageFailed, setPageFailed] = useState(false);

  // The SERVER sent a different first page (a navigation, not a refresh): re-seed rather than merge.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setPageFailed(false);
  }

  /** APPEND: every card already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    try {
      const page = await loadMoreLivesAction(cursor, preview);
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
  }, [cursor, preview]);

  /** Re-arms the sentinel (which is on screen under the retry) rather than fetching twice. */
  const retryPage = useCallback(() => setPageFailed(false), []);

  return (
    <>
      <ul aria-labelledby={labelledBy} data-testid="lives-member-recorded" className={LIVES_GRID}>
        {items.map((item, index) => (
          <li
            key={item.id}
            data-live-card={item.id}
            className="ms-rise min-w-0"
            style={riseStyle(index)}
          >
            <MemberLiveCard view={item} eager={index < EAGER_CARDS} />
          </li>
        ))}
      </ul>

      {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
      <InfiniteScroll
        hasMore={cursor !== null}
        enabled={!pageFailed}
        onLoadMore={loadMore}
        skeleton={
          <div className="pt-3">
            <LiveCardSkeletons count={LOAD_MORE_SKELETONS} />
          </div>
        }
      />

      {pageFailed ? (
        <div
          role="alert"
          data-courses-page-error
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
