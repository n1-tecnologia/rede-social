'use client';

import { PURPOSE_WIDTHS } from '@rede-social/contracts/media';
import { LiveCard } from '@rede-social/module-courses/ui';
import { ExclusiveBadge } from '@rede-social/module-store/ui';
import { Button, InfiniteScroll, Skeleton } from '@rede-social/ui';
import { useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import type { LiveCardView } from '@/lib/courses-member-view';
import { loadMoreLivesAction } from './learn-actions';

/** The lives grid of both groups (UI-D-434). */
export const LIVES_GRID = 'grid grid-cols-2 gap-3 px-4 sm:grid-cols-3';

/** Two card skeletons on load more of "Gravadas" (E04 loading). */
const LOAD_MORE_SKELETONS = 2;

/** The first cards of a screen load eagerly; the rest are lazy. */
const EAGER_CARDS = 4;

/** The live card skeletons (E04 loading): the 16:10 rect plus two bars, at the grid's geometry. */
export function LiveCardSkeletons({ count }: { count: number }) {
  return (
    <div aria-busy data-testid="lives-member-skeleton" className={LIVES_GRID}>
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, static placeholder row.
        <div key={index} className="flex flex-col overflow-hidden rounded-xl bg-bg-secondary">
          <Skeleton variant="rect" className="aspect-[16/10] rounded-none" />
          <div className="flex flex-col gap-2 p-3">
            <Skeleton variant="text" width="80%" />
            <Skeleton variant="text" width="55%" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * One live card with the store's tag composed in the app tier (MOD-02): the courses module never
 * imports the store. Used by both groups, so "Próximas" (server-rendered) and "Gravadas" (paged
 * here) can never draw a card differently.
 */
export function MemberLiveCard({ view, eager = false }: { view: LiveCardView; eager?: boolean }) {
  const t = useTranslations('courses');
  return (
    <LiveCard
      href={view.href}
      ariaLabel={view.ariaLabel}
      title={view.title}
      meta={view.meta}
      statusLabel={view.statusLabel}
      statusIcon={view.statusIcon}
      coverAssetId={view.coverAssetId}
      coverWidths={PURPOSE_WIDTHS.cover}
      cancelled={view.cancelled}
      eager={eager}
      tags={view.exclusive ? <ExclusiveBadge label={t('member.tags.exclusiveLive')} /> : undefined}
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
 * (UI-D-288), formats or sorts (P09).
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
          <li key={item.id} data-live-card={item.id} className="min-w-0">
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
