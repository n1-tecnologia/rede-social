'use client';

import {
  COMMUNITY_MAX_ORDER,
  type CommunityStatus,
  type CommunitySummary,
} from '@rede-social/module-communities/contracts';
import { CommunityCard, CommunityReorderList } from '@rede-social/module-communities/ui';
import {
  Button,
  Card,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
  StatusPill,
  useToast,
} from '@rede-social/ui';
import { Archive, ArrowUpDown, TriangleAlert, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  loadMoreCommunitiesAction,
  loadOrderableCommunitiesAction,
  type OrderableCommunitiesResult,
  type ReorderCommunitiesResult,
  refreshCommunitiesAction,
  reorderCommunitiesAction,
} from './actions';

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
  /**
   * Which list this is (05.1, D-88). The PAGE decides it on the server — `archived` only for a
   * manager asking `?status=arquivadas` — and remounts this component per status, so no state is
   * ever carried from one list into the other. Refresh and load-more pass it on (Pitfall 9).
   */
  status?: CommunityStatus;
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

/** The reorder mode's draft: the order the mode opened on, and the order the admin is building. */
type ReorderDraft = { original: CommunitySummary[]; draft: CommunitySummary[] };

/** Where focus goes once the next render has committed (the mode swaps the controls out). */
type FocusTarget = 'heading' | 'toggle' | 'save';

const sameOrder = (a: readonly CommunitySummary[], b: readonly CommunitySummary[]) =>
  a.length === b.length && a.every((community, index) => community.id === b[index]?.id);

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
 * 03-05 rule). The one delta from the member directory is D-76's: paging is driven by `@rede-social/ui`'s
 * `InfiniteScroll` sentinel rather than by an explicit "Carregar mais" button.
 *
 * **Four states, and only four.** An unreadable first page renders the generic error card with a
 * retry; zero communities renders the empty state — with the "Criar comunidade" CTA for an admin
 * (D-77), which is what makes the empty state the creation entry point; anything else renders the
 * column. A LOAD-MORE failure is the fourth and is deliberately not any of the other three.
 *
 * Ordering is the server's (`position asc, last_activity_at desc, id desc` since 2026-10-03: the
 * admin's order, then activity) and is never restated here: nothing in this file sorts, re-sorts or
 * filters what the API answered — the reorder mode below only moves rows in a DRAFT, and the list
 * shows the server's answer to saving it.
 *
 * **2026-10-03 — the reorder mode (managers, `Ativas` only).** A "Reordenar" control sits above the
 * cards when the viewer holds `communities.community.manage`, the list is `Ativas` and there are at
 * least two communities to order; a member's markup is unchanged. It opens a mode that:
 *   - first loads EVERY active community (`loadOrderableCommunitiesAction`), because the order is one
 *     permutation of the whole set and the list on screen may hold only its first page;
 *   - swaps the cards for `CommunityReorderList` — compact rows with "Mover para cima/baixo" buttons
 *     named after each community, disabled at the ends, focus following the moved row — under a
 *     heading that takes focus as the mode opens, with "Cancelar" and "Salvar ordem";
 *   - saves through `reorderCommunitiesAction` and re-seeds from its answer (page 1 in the new
 *     order), toasting the success; a draft identical to the opening order saves nothing;
 *   - on `order_stale` (a community was created, archived or removed meanwhile) closes, toasts why
 *     and RELOADS the list, because the draft was built on a set that no longer exists; on any other
 *     failure keeps the draft and the mode, so "Salvar ordem" can simply be tried again.
 * Closing the mode returns focus to "Reordenar". While it is open the list neither pulls to refresh
 * nor pages: there is nothing to append to a permutation.
 *
 * **05.1 — the `Arquivadas` list (D-88) is the same machine over a different keyset.** `status`
 * travels with every refresh and load-more, so a pull or a scroll on `Arquivadas` never swaps the
 * active list in. Its zero state is its own (UI-D-51: named, and with NO call to action, because
 * archiving happens on the edit form); each archived row carries the neutral "Arquivada" pill in the
 * card's slot (UI-D-50, not dimmed); and the region says which list it is. The title-row create
 * control lives on the PAGE; `createCta` here serves the Ativas empty state only, which keeps its
 * own route to the form (D-87).
 */
export function CommunitiesList({
  initialItems,
  initialCursor,
  initialError,
  tenantName,
  canManage,
  status = 'active',
}: CommunitiesListProps) {
  const t = useTranslations('communities');
  const toast = useToast();

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
      const page = await refreshCommunitiesAction(status);
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
  }, [items.length, status]);

  /** APPEND: every card already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const from = cursor;
    try {
      const page = await loadMoreCommunitiesAction(from, status);
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
  }, [cursor, status]);

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

  /* ── The reorder mode (2026-10-03) ──────────────────────────────────────────────────────────── */

  const [reorder, setReorder] = useState<ReorderDraft | null>(null);
  /** True while the whole active set is being read to open the mode. */
  const [entering, setEntering] = useState(false);
  /** True while "Salvar ordem" is in flight: every control of the mode is inert. */
  const [saving, setSaving] = useState(false);
  const headingId = useId();
  const helperId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Wrappers of the two `Button`s focus returns to: the primitive does not forward a ref, so focus
  // goes through these (the `HighlightEditSheet` idiom).
  const toggleRef = useRef<HTMLSpanElement>(null);
  const saveRef = useRef<HTMLSpanElement>(null);
  const focusAfter = useRef<FocusTarget | null>(null);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    if (target === 'heading') {
      headingRef.current?.focus();
      return;
    }
    const wrapper = target === 'toggle' ? toggleRef.current : saveRef.current;
    wrapper?.querySelector('button')?.focus();
  });

  // Members never get it, `Arquivadas` never gets it, and one community has no order to choose.
  const canReorder = canManage && status === 'active' && items.length > 1;

  const startReorder = async () => {
    if (entering) return;
    setEntering(true);
    let result: OrderableCommunitiesResult = { ok: false, code: 'generic' };
    try {
      result = await loadOrderableCommunitiesAction();
    } catch (error) {
      console.error('communities.order_load_failed', { error: String(error) });
    }
    setEntering(false);
    if (!result.ok) {
      // The toggle was disabled while it loaded, which dropped its focus: give it back.
      focusAfter.current = 'toggle';
      toast.show({
        tone: 'error',
        message:
          result.code === 'too_many'
            ? t('reorder.errors.tooMany', { limit: COMMUNITY_MAX_ORDER })
            : t('reorder.errors.load'),
      });
      return;
    }
    focusAfter.current = 'heading';
    setReorder({ original: result.items, draft: result.items });
  };

  /** The list's `onChange`: the new permutation, mapped back onto the draft's own rows. */
  const moveDraft = useCallback((ids: string[]) => {
    setReorder((current) => {
      if (current === null) return current;
      const byId = new Map(current.draft.map((community) => [community.id, community]));
      const draft = ids
        .map((id) => byId.get(id))
        .filter((community): community is CommunitySummary => community !== undefined);
      return draft.length === current.draft.length ? { ...current, draft } : current;
    });
  }, []);

  const closeReorder = () => {
    focusAfter.current = 'toggle';
    setReorder(null);
  };

  const saveOrder = async () => {
    if (reorder === null || saving) return;
    // Nothing moved: no request, no write, no revalidation — the mode simply closes.
    if (sameOrder(reorder.draft, reorder.original)) {
      closeReorder();
      return;
    }

    setSaving(true);
    let result: ReorderCommunitiesResult = { ok: false, code: 'generic' };
    try {
      result = await reorderCommunitiesAction(reorder.draft.map((community) => community.id));
    } catch (error) {
      console.error('communities.reorder_failed', { error: String(error) });
    }
    setSaving(false);

    if (result.ok) {
      // The server's answer IS the new first page: the list re-seeds from it, as a refresh would.
      setItems(result.items);
      setCursor(result.nextCursor);
      setFirstLoadFailed(false);
      setPageFailed(false);
      closeReorder();
      toast.show({ tone: 'success', message: t('toasts.reordered') });
      return;
    }
    if (result.code === 'order_stale') {
      // The draft was built on a set that no longer exists: close, say why, show the real list.
      closeReorder();
      toast.show({ tone: 'error', message: t('reorder.errors.stale') });
      await refresh();
      return;
    }
    // Anything else keeps the draft and the mode, so "Salvar ordem" can simply be tried again.
    focusAfter.current = 'save';
    toast.show({ tone: 'error', message: t('reorder.errors.save') });
  };

  // A LINK, not a `Button`: the shipped button is a `<button>` and the form is a route. The brand
  // styling is the button's, read through the tenant tokens exactly as `Button` reads them.
  const createCta = canManage ? (
    <a
      href="/comunidades/nova"
      className="inline-flex h-11 items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-colors hover:bg-button-hover hover:bg-(image:--button-image-hover) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
  } else if (items.length === 0 && status === 'archived') {
    // UI-D-51: nothing archived is a named, honest state with NO call to action — the Ativas chip
    // sits directly above it and the create control is in the title row.
    body = (
      <div className="px-4">
        <EmptyState
          variant="card"
          icon={Archive}
          data-testid="communities-empty-archived"
          title={t('emptyArchived.title')}
          body={t('emptyArchived.body')}
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
              // UI-D-50: decided per ROW from the row's own status, never from the list's.
              statusPill={
                community.status === 'archived' ? (
                  <StatusPill tone="neutral">{t('archived.pill')}</StatusPill>
                ) : undefined
              }
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

  // `list.region` names the LIST; `communities.region` names one community's post list on its own
  // page (UI-SPEC §Copywriting Contract). 05-04 moved this key so the spec's own name is free for the
  // surface the spec gives it to. The reorder mode keeps the same region: it is the same list.
  const region =
    status === 'archived'
      ? t('list.regionArchived', { tenant: tenantName })
      : t('list.region', { tenant: tenantName });

  if (reorder !== null) {
    // Outside `PullToRefresh` on purpose: a pull would re-read a list the mode is not showing.
    return (
      <section aria-label={region} data-communities-reordering className="flex flex-col pb-6">
        <div className="flex flex-col gap-3 px-4 pb-3">
          <div>
            <h2
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="text-base font-bold text-text focus:outline-none"
            >
              {t('reorder.title')}
            </h2>
            <p id={helperId} className="mt-1 text-xs font-normal text-text-tertiary">
              {t('reorder.helper')}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={saving}
              onClick={closeReorder}
              data-communities-reorder-cancel
            >
              {t('reorder.cancel')}
            </Button>
            <span ref={saveRef} className="contents">
              <Button
                size="sm"
                loading={saving}
                onClick={() => void saveOrder()}
                data-communities-reorder-save
              >
                {saving ? t('reorder.saving') : t('reorder.save')}
              </Button>
            </span>
          </div>
        </div>
        <div className="px-4">
          <CommunityReorderList
            items={reorder.draft}
            onChange={moveDraft}
            disabled={saving}
            labelledBy={headingId}
            describedBy={helperId}
            labels={{
              moveUp: (name) => t('reorder.moveUp', { community: name }),
              moveDown: (name) => t('reorder.moveDown', { community: name }),
              moved: (name, position, total) =>
                t('reorder.moved', { community: name, position, total }),
            }}
          />
        </div>
      </section>
    );
  }

  return (
    <PullToRefresh onRefresh={refresh}>
      <section aria-label={region} className="flex flex-col pb-6">
        {canReorder ? (
          // An outline control above the cards, right-aligned: the title row's brand control stays
          // the screen's one primary action (D-86), and this one changes how the list behaves.
          <div className="flex justify-end px-4 pb-3">
            <span ref={toggleRef} className="contents">
              <Button
                variant="outline"
                size="sm"
                loading={entering}
                onClick={() => void startReorder()}
                data-communities-reorder
              >
                {entering ? null : <ArrowUpDown aria-hidden size={14} className="shrink-0" />}
                {t('reorder.start')}
              </Button>
            </span>
          </div>
        ) : null}
        {body}
      </section>
    </PullToRefresh>
  );
}
