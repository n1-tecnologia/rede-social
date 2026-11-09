'use client';

import type { LiveFilter } from '@rede-social/module-courses/contracts';
import { Button, cn, EmptyState, InfiniteScroll, PullToRefresh } from '@rede-social/ui';
import { CircleAlert, Radio } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState } from 'react';
import type { CourseRowView } from '@/lib/courses-view';
import { ADMIN_LIVES_GRID, AdminLiveCard, AdminLiveCardSkeletons } from './AdminLiveCards';
import { loadMoreLivesAction, refreshLivesAction } from './actions';
import { OUTLINE_LINK, UPCOMING_LIVES_GRID, WIDE_EMPTY } from './admin-styles';

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

/** The spotlight and the first tiles load their covers eagerly; the rest are lazy. */
const EAGER_CARDS = 4;

/** The card skeletons on load more (UI-D-401): three agenda rows, or one row of three tiles. */
const LOAD_MORE_SKELETONS = 3;

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
 *
 * 2026-10-22 (the courses area redesign on the social-igoralves prototype): the rows live in ONE
 * outlined list card with hairlines between them (80px thumbs, the pill under the date line), the
 * load-more skeletons in a card of their own; the screen's frame owns the side padding. The empty
 * state's "Agendar live" is an outline link: the header's "Nova live" is the screen's one brand fill.
 *
 * 2026-10-23 (the Lives screen in the reference's design): the body is the member's showcase, each
 * card with its "Editar" door (`AdminLiveCard`). "Próximas": the first live as the `spotlight`, the
 * rest as `agenda` rows; "Passadas": the `tile` grid, two columns and three from 640px. The card
 * keeps the row's link and name ("{title}, {status}"), the status words sit in the card's chip, and
 * the load-more skeletons take the cards' geometry. The paging, the refresh, the empty and the error
 * states, `lives-list` and the page error are unchanged; the `LiveRow` hooks (`live-row-*`) left with
 * the rows for the card's (`live-card-*`, `live-edit`).
 *
 * 2026-10-23 (the wide desktop page, `data-shell-wide`): from `lg` "Próximas" is two columns
 * (`UPCOMING_LIVES_GRID`): the spotlight on the left (3/5), the agenda rows stacked on the right
 * (2/5). One list still, in the server's order: the spotlight spans every agenda row plus a trailing
 * `1fr` row (inline `grid-template-rows` / `grid-row`, read only by the `lg` grid; the phone's flex
 * column ignores them), so a tall spotlight never spreads the agenda apart. "Passadas" gains a
 * fourth column from `xl` (`ADMIN_LIVES_GRID`). The empty and error cards keep a readable width.
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
      <div className={WIDE_EMPTY}>
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
      <div className={WIDE_EMPTY}>
        <EmptyState
          variant="card"
          icon={Radio}
          data-testid={empty.testId}
          title={t(empty.title)}
          body={t(empty.body)}
          action={
            filter === 'upcoming' ? (
              <a href="/cursos/lives/nova" className={OUTLINE_LINK}>
                {t('lives.empty.cta')}
              </a>
            ) : undefined
          }
        />
      </div>
    );
  } else {
    const past = filter === 'past';
    // Every live row carries its card words (`liveRowView`); a row without them is not a live.
    const cards = items.flatMap((item) => (item.live ? [{ item, card: item.live }] : []));
    // The agenda rows beside the spotlight (`lg`): the spotlight spans them all plus a `1fr` row.
    const agendaRows = past ? 0 : Math.max(cards.length - 1, 0);
    body = (
      <>
        <ol
          aria-label={t('lives.region', { tenant: tenantName })}
          data-testid="lives-list"
          data-layout={past ? 'grid' : 'agenda'}
          className={past ? ADMIN_LIVES_GRID : UPCOMING_LIVES_GRID}
          style={
            agendaRows > 0 ? { gridTemplateRows: `repeat(${agendaRows}, auto) 1fr` } : undefined
          }
        >
          {cards.map(({ item, card }, index) => (
            <li
              key={item.id}
              data-live-card={item.id}
              className={cn(
                'min-w-0',
                !past && index === 0 && 'mb-2 lg:mb-0',
                !past && index > 0 && 'lg:col-start-2',
              )}
              style={
                !past && index === 0 && agendaRows > 0
                  ? { gridRow: `1 / span ${agendaRows + 1}` }
                  : undefined
              }
            >
              <AdminLiveCard
                item={item}
                card={card}
                variant={past ? 'tile' : index === 0 ? 'spotlight' : 'agenda'}
                eager={index < EAGER_CARDS}
              />
            </li>
          ))}
        </ol>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin. */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={
            <div className="pt-3">
              <AdminLiveCardSkeletons
                variant={past ? 'tile' : 'agenda'}
                count={LOAD_MORE_SKELETONS}
              />
            </div>
          }
        />

        {pageFailed ? (
          <div
            role="alert"
            data-lives-page-error
            className="mt-3 flex flex-col items-center gap-3 text-center"
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
