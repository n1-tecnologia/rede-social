'use client';

import type { CommunitySummary } from '@tria/module-communities/contracts';
import { CommunityCard } from '@tria/module-communities/ui';
import { Button, Card, EmptyState, InfiniteScroll, PullToRefresh, Skeleton } from '@tria/ui';
import { TriangleAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import { loadMoreCommunitiesAction, refreshCommunitiesAction } from './actions';

export interface CommunitiesListProps {
  /** The first page the SERVER rendered — the list is seeded from it and owns every page after it. */
  initialItems: CommunitySummary[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all (UI-SPEC E10/error). */
  initialError?: boolean;
  /** The tenant's display name, interpolated into the member empty state. */
  tenantName: string;
  /** The composed `communities.community.manage` permission — never a role comparison here. */
  canManage: boolean;
}

/** The geometry of a real card: a 16/7 cover block and a counts row. */
export function CommunityCardSkeleton() {
  return (
    <Card aria-hidden className="flex flex-col">
      <Skeleton variant="rect" className="aspect-[16/7] w-full rounded-none" />
      <div className="flex items-center gap-2 px-4 py-3">
        <Skeleton variant="circle" className="h-4 w-4" />
        <Skeleton variant="text" width="35%" className="h-3" />
      </div>
    </Card>
  );
}

const SKELETON_CARDS = [0, 1, 2];

/**
 * Three cards, shared with `loading.tsx` so the first paint and the skeleton have the SAME geometry
 * and the swap to content does not shift the page (UI-SPEC E10/loading).
 */
export function CommunitiesSkeleton() {
  return (
    <div aria-busy data-testid="communities-skeleton" className="flex flex-col gap-3 px-4">
      {SKELETON_CARDS.map((index) => (
        <CommunityCardSkeleton key={index} />
      ))}
    </div>
  );
}

/**
 * The `/comunidades` list body (COMM-03, D-76, UI-SPEC E10).
 *
 * **The state machine is `MembersList`'s, append-never-replace**: a page APPENDS, so every card
 * already on screen keeps its order and its DOM position; a load-more failure renders an inline
 * danger line plus an outline retry AT THE SENTINEL and never discards the rows already loaded (the
 * 03-05 rule). The one delta from the member directory is D-76's: paging is driven by `@tria/ui`'s
 * `InfiniteScroll` sentinel rather than by an explicit "Carregar mais" button.
 *
 * **Four states, and only four.** An unreadable first page renders the generic error card with a
 * retry; zero communities renders the empty state — with the "Criar comunidade" CTA for an admin
 * (D-77), which is what makes the empty state the creation entry point; anything else renders the
 * column. A LOAD-MORE failure is the fourth and is deliberately not any of the other three.
 *
 * Ordering is the server's (`last_activity_at desc, id desc`) and is never restated here: nothing in
 * this file sorts, re-sorts or filters what the API answered.
 */
export function CommunitiesList({
  initialItems,
  initialCursor,
  initialError,
  tenantName,
  canManage,
}: CommunitiesListProps) {
  const t = useTranslations('communities');

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);

  // The SERVER sent a different first page (a navigation, not a refresh): re-seed rather than merge.
  // Adjusting state during render is React's documented alternative to an effect.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
  }

  /**
   * Page 1 again. Replaces the list; the cards never become skeletons, so a pull shows only the
   * brand loader (UI-SPEC E10/loading).
   */
  const refresh = useCallback(async () => {
    try {
      const page = await refreshCommunitiesAction();
      if (!page.ok) {
        setFirstLoadFailed(items.length === 0);
        return;
      }
      setItems(page.items);
      setCursor(page.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
    } catch (error) {
      console.error('communities.refresh_failed', { error: String(error) });
      setFirstLoadFailed(items.length === 0);
    }
  }, [items.length]);

  /** APPEND: every card already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const from = cursor;
    try {
      const page = await loadMoreCommunitiesAction(from);
      if (!page.ok) {
        setPageFailed(true);
        return;
      }
      setPageFailed(false);
      setItems((previous) => [...previous, ...page.items]);
      setCursor(page.nextCursor);
    } catch (error) {
      // The sentinel hook swallows a rejection so it cannot reach render; without this catch a dead
      // network would spin the sentinel forever with no retry ever offered.
      console.error('communities.load_more_failed', { error: String(error) });
      setPageFailed(true);
    }
  }, [cursor]);

  /**
   * The retry RE-ARMS the sentinel rather than fetching itself. The retry control renders AT the
   * sentinel, so the sentinel is on screen; re-enabling it rebuilds the observer, which fires
   * immediately for a target already intersecting. Calling `loadMore()` here as well would load two
   * pages for one tap.
   */
  const retryPage = useCallback(() => {
    setPageFailed(false);
  }, []);

  const retryFirst = useCallback(() => {
    setFirstLoadFailed(false);
    void refresh();
  }, [refresh]);

  // A LINK, not a `Button`: the shipped button is a `<button>` and the form is a route. The brand
  // styling is the button's, read through the tenant tokens exactly as `Button` reads them.
  const createCta = canManage ? (
    <a
      href="/comunidades/nova"
      className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-bold text-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      {t('actions.create')}
    </a>
  ) : null;

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
    // D-77: the tab STAYS VISIBLE with zero communities — navigation is driven by the module flag,
    // never by data — and for an admin this card is also the creation entry point.
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={Users}
          data-testid="communities-empty"
          title={t('empty.title')}
          body={canManage ? t('empty.bodyAdmin') : t('empty.body', { tenant: tenantName })}
          action={createCta ?? undefined}
        />
      </div>
    );
  } else {
    body = (
      <>
        <div className="flex flex-col gap-3 px-4">
          {items.map((community) => (
            <CommunityCard
              key={community.id}
              href={`/comunidades/${community.id}`}
              name={community.name}
              description={community.description}
              coverAssetId={community.coverAssetId}
              coverVariantWidths={community.coverVariantWidths}
              postCountLabel={t('card.posts', { count: community.postCount })}
              coverAlt={t('card.cover', { community: community.name })}
            />
          ))}
        </div>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin: the
            member asks for the retry explicitly. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={
            <div className="px-4">
              <CommunityCardSkeleton />
            </div>
          }
          className="mt-3"
        />

        {pageFailed ? (
          <div
            data-communities-page-error
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
      {/* `list.region` names the LIST; `communities.region` names one community's post list on its
          own page (UI-SPEC §Copywriting Contract). 05-04 moved this key so the spec's own name is
          free for the surface the spec gives it to. */}
      <section aria-label={t('list.region', { tenant: tenantName })} className="flex flex-col pb-6">
        {body}
      </section>
    </PullToRefresh>
  );
}
