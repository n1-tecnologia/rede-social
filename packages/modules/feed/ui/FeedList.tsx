'use client';

import {
  Button,
  Card,
  EmptyState,
  InfiniteScroll,
  PullToRefresh,
  Skeleton,
  useToast,
} from '@tria/ui';
import { Newspaper, TriangleAlert } from 'lucide-react';
import { type ReactNode, useCallback, useState, useTransition } from 'react';
import { CommentSheet, type CommentSheetProps } from './CommentSheet';
import { ComposeFab } from './ComposeFab';
import type { CountTemplates } from './meta';
import {
  type LikeOutcome,
  PostCard,
  type PostCardMediaView,
  type PostCardView,
  type PostShareTarget,
} from './PostCard';
import { PostMenu, type PostMenuLabels, type PostMenuTarget } from './PostMenu';

/**
 * The D-55 home-slot widget: the feed is the main content of `/inicio`, below the branded welcome
 * and the D-02 nudge (UI-D-19), and it adds NO navigation tab.
 *
 * Presentational and props-only, the `ExampleWidget` posture: it fetches nothing, imports nothing
 * from the kernel server or db, reads no catalog, and every string arrives as a prop so the module
 * ships no language (PWA-03). Authorisation also arrives as a prop — `canPost` is the composed
 * `feed.post.create` permission computed server-side, never a role comparison here (FEED-08, R-P8).
 *
 * **Four states, and only four.** An unreadable first page renders the generic error card with a
 * retry; zero posts renders the feed's OWN empty card (UI-D-20 — `HomeSlots`' "Em breve" means
 * "no module contributed anything", which stops being true once a slot is registered, and two
 * different truths must not share one card); anything else renders the column. A LOAD-MORE failure
 * is the fourth and is deliberately not any of the other three: it renders an inline line plus a
 * retry AT the sentinel and keeps every card already on screen (the 03-05 rule).
 *
 * **Paging in both directions goes through the host's ONE fetch implementation** (D-58, Pitfall 9):
 * the sentinel appends with `onLoadMore(cursor)`, pull-to-refresh replaces with `onRefresh()`, and
 * neither is a second request path. The cursor is opaque here and is forwarded verbatim.
 */
export type FeedPageOutcome =
  | { ok: true; items: PostCardView[]; nextCursor: string | null }
  | { ok: false };

/**
 * Everything `CommentSheet` needs except which post it is open on and whether it is open at all —
 * those two are the LIST's state (04-07, D-59).
 *
 * ONE sheet for the whole column, not one per card. A sheet per card would mount a dialog, a focus
 * trap and a confirmation dialog for every post on screen, and paging the feed would multiply them.
 * The card raises "open comments for this id"; the list decides what is on screen.
 */
export type FeedCommentsProps = Omit<
  CommentSheetProps,
  'open' | 'onClose' | 'postId' | 'initialItems' | 'initialCursor' | 'onCountChange'
>;

/**
 * FEED-03's overflow menu, hosted the SAME way the comment sheet is (D-59's rule applied to a second
 * overlay): ONE `PostMenu` for the whole column, not one per card. A menu per card would mount a
 * dialog, a focus trap and a confirmation for every post on screen, and paging the feed would
 * multiply them. The card raises "open the menu for this id"; the list decides what is on screen.
 *
 * `onDelete` must REJECT on refusal — the confirmation's own error branch is what closes the dialog
 * without removing the card, and a promise that resolved on failure would take a post off the
 * member's screen while it still exists for everyone else (the 03-05 "no optimistic removal" rule).
 */
export type FeedPostMenuProps = {
  labels: PostMenuLabels;
  onDelete: (postId: string) => Promise<void>;
};

export type FeedListLabels = {
  /** Accessible name of the widget's region. */
  region: string;
  /** The caption's "more" toggle. */
  more: string;
  /** `aria-roledescription` of the gallery strip (UI-SPEC Gallery). */
  carousel: string;
  /** The GENERIC message a failed attachment download raises as a toast (UI-D-23). */
  attachmentError: string;
  /** The three action labels plus the overflow control's, all `aria-label`s. */
  like: string;
  unlike: string;
  comment: string;
  share: string;
  moreOptions: string;
  /** The meta row's count templates and the edited marker (UI-D-15, UI-D-21). */
  likes: CountTemplates;
  comments: CountTemplates;
  edited: string;
  emptyTitle: string;
  /** Shown to a member: the community's posts will appear here. */
  emptyBody: string;
  /** Shown to someone who may publish: be the first. */
  emptyBodyAuthor: string;
  emptyCta: string;
  errorTitle: string;
  errorBody: string;
  errorRetry: string;
  /** Inline at the sentinel when one PAGE fails; the loaded cards stay exactly where they are. */
  loadMoreError: string;
  loadMoreRetry: string;
  /** The desktop header row's compose control (UI-D-17 — there is no floating control on desktop). */
  createCta: string;
  /** Accessible name of the MOBILE floating control (UI-D-17); same words, different surface. */
  createFab: string;
  /** The one toast a failed like or a failed refresh raises; never an inline message (UI-SPEC E09). */
  genericError: string;
};

export type FeedListProps = {
  /** The page the SERVER rendered; the list is seeded from it and owns every page after it. */
  initialItems: PostCardView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all (UI-SPEC E1/error). */
  initialError?: boolean;
  canPost: boolean;
  captionTruncateAt: number;
  /** Rendered as the empty-state CTA and the desktop header control once the composer route exists. */
  createHref?: string;
  /** BCP-47 tag from the host: the module formats numbers for it but ships no words (PWA-03). */
  locale: string;
  labels: FeedListLabels;
  onLoadMore: (cursor: string) => Promise<FeedPageOutcome>;
  onRefresh: () => Promise<FeedPageOutcome>;
  onLike: (postId: string) => Promise<LikeOutcome>;
  onUnlike: (postId: string) => Promise<LikeOutcome>;
  /**
   * D-59's sheet. Present → the card's comment control and its meta comment count open the SHARED
   * sheet over the feed; absent → 04-06's seam stays inert and `onOpenComments` (if the host passes
   * one) still fires, which is what `/post/[id]` uses to navigate instead.
   */
  comments?: FeedCommentsProps;
  onOpenComments?: (postId: string) => void;
  /**
   * FEED-07. Fires with the post AND the url the server already composed for it, so this widget
   * never has to look one up and can never hand out a different link than 04-09's "copiar link"
   * row. The four-outcome branch table lives at the host's composition point, not in here.
   */
  onShare?: (target: PostShareTarget) => void;
  /**
   * FEED-03's "…" menu. Present → the overflow control opens the SHARED sheet over the feed and the
   * list removes a deleted card from its own column; absent → 04-06's seam stays inert and
   * `onMore` (if the host passes one) still fires, which is what `/post/[id]` uses instead.
   */
  menu?: FeedPostMenuProps;
  onMore?: (postId: string) => void;
  /**
   * Per-item media override (04-04's injection point).
   *
   * The DEFAULT is `item.media`, which the host already built on the server — including the
   * already-created `VideoPlayer` element, which survives both boundaries an item crosses (a server
   * component's props and a server action's return value). The hook exists for a host that has to
   * build a media node on the CLIENT side instead; a host that does not pass it gets the server's
   * node unchanged.
   */
  renderMedia?: (item: PostCardView) => PostCardMediaView;
};

/** The geometry of a real card: circle + two meta lines, a ratio box, two caption lines. */
export function FeedCardSkeleton() {
  return (
    <Card aria-hidden className="flex flex-col gap-4 overflow-hidden p-4">
      <div className="flex items-center gap-3">
        <Skeleton variant="circle" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton variant="text" width="40%" className="h-3.5" />
          <Skeleton variant="text" width="20%" className="h-3" />
        </div>
      </div>
      <Skeleton variant="rect" height={240} className="rounded-xl" />
      <div className="flex flex-col gap-2">
        <Skeleton variant="text" width="30%" className="h-3.5" />
        <Skeleton variant="text" width="80%" className="h-3.5" />
      </div>
    </Card>
  );
}

/**
 * The card as it should render RIGHT NOW: the host's media override if there is one, and the post's
 * comment count moved by however far the sheet has moved it since the server sent this page.
 *
 * Returns the ORIGINAL object when neither applies, so an untouched card keeps its identity and
 * React skips it — a fresh object per render would re-render every card in the column on every
 * keystroke in the sheet.
 */
function commentCountApplied(
  post: PostCardView,
  renderMedia: ((item: PostCardView) => PostCardMediaView) | undefined,
  delta: number,
): PostCardView {
  if (!renderMedia && delta === 0) return post;
  return {
    ...post,
    ...(renderMedia ? { media: renderMedia(post) } : {}),
    // Never below zero: a delete that races a refresh must not print a negative count.
    commentCount: Math.max(0, post.commentCount + delta),
  };
}

const SKELETON_CARDS = [0, 1, 2];

/**
 * Three cards, shared with the home slot's own loading boundary so the first paint and the skeleton
 * have the SAME geometry and the swap to content does not shift the page (UI-SPEC E1/loading).
 */
export function FeedListSkeleton() {
  return (
    <div aria-busy data-testid="feed-skeleton" className="flex flex-col gap-3">
      {SKELETON_CARDS.map((index) => (
        <FeedCardSkeleton key={index} />
      ))}
    </div>
  );
}

export function FeedList({
  initialItems,
  initialCursor,
  initialError,
  canPost,
  captionTruncateAt,
  createHref,
  locale,
  labels,
  onLoadMore,
  onRefresh,
  onLike,
  onUnlike,
  comments,
  onOpenComments,
  onShare,
  menu,
  onMore,
  renderMedia,
}: FeedListProps) {
  const toast = useToast();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [firstLoadFailed, setFirstLoadFailed] = useState(Boolean(initialError));
  const [pageFailed, setPageFailed] = useState(false);
  const [, startTransition] = useTransition();

  /** Which post the shared sheet is open on, and how far each post's count has moved since. */
  const [commentsOpenFor, setCommentsOpenFor] = useState<string | null>(null);
  /** Which post the shared OVERFLOW menu is open on (04-09) — one sheet for the whole column. */
  const [menuTarget, setMenuTarget] = useState<PostMenuTarget | null>(null);
  const [countDeltas, setCountDeltas] = useState<Record<string, number>>({});

  // The SERVER sent a different first page (a navigation, not a refresh): re-seed rather than merge.
  // Adjusting state during render is React's documented alternative to an effect.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    setCursor(initialCursor);
    setFirstLoadFailed(Boolean(initialError));
    setPageFailed(false);
    // The server's counts are authoritative again, so every locally tracked delta is stale.
    setCountDeltas({});
  }

  const failToast = useCallback(() => {
    toast.show({ tone: 'error', message: labels.genericError });
  }, [toast, labels.genericError]);

  /**
   * Page 1 again. Replaces the list; the cards never become skeletons (UI-SPEC E1/loading).
   *
   * A REJECTION and a refusal are the same outcome here: a server action that never reaches the
   * server rejects, and treating that as anything other than "this refresh failed" would leave the
   * member with a pull that silently did nothing.
   */
  const refresh = useCallback(async () => {
    let page: FeedPageOutcome = { ok: false };
    try {
      page = await onRefresh();
    } catch (error) {
      console.error('feed.refresh_failed', { error: String(error) });
    }
    if (!page.ok) {
      failToast();
      return;
    }
    setItems(page.items);
    setCursor(page.nextCursor);
    setFirstLoadFailed(false);
    setPageFailed(false);
    setCountDeltas({});
  }, [onRefresh, failToast]);

  /** APPEND: every card already on screen keeps its order and its DOM position. */
  const loadMore = useCallback(async () => {
    if (!cursor) return;
    const from = cursor;
    let page: FeedPageOutcome = { ok: false };
    try {
      page = await onLoadMore(from);
    } catch (error) {
      // The sentinel hook swallows a rejection so it cannot reach render; if this did not catch it
      // too, a dead network would spin the sentinel forever with no retry ever offered.
      console.error('feed.load_more_failed', { error: String(error) });
    }
    if (!page.ok) {
      setPageFailed(true);
      return;
    }
    setPageFailed(false);
    setItems((previous) => [...previous, ...page.items]);
    setCursor(page.nextCursor);
  }, [cursor, onLoadMore]);

  /**
   * The retry RE-ARMS the sentinel rather than fetching itself. The retry control renders AT the
   * sentinel, so the sentinel is on screen; re-enabling it rebuilds the observer, which fires
   * immediately for a target already intersecting. Calling `loadMore()` here as well would load two
   * pages for one tap — the sentinel's page and this one — which is exactly the duplicate the
   * one-page-in-flight guard exists to prevent.
   */
  const retryPage = useCallback(() => {
    setPageFailed(false);
  }, []);

  const retryFirst = useCallback(() => {
    startTransition(() => {
      void refresh();
    });
  }, [refresh]);

  /**
   * The comment control's destination. With a sheet configured it opens over the feed WITHOUT
   * navigating away (D-59); without one, the host's own handler runs — which is how a surface that
   * would rather route to `/post/[id]` opts out.
   */
  const openComments = useCallback(
    (postId: string) => {
      if (comments) setCommentsOpenFor(postId);
      onOpenComments?.(postId);
    },
    [comments, onOpenComments],
  );

  /**
   * The overflow control's destination (04-09). With a menu configured it opens the SHARED sheet
   * over the feed carrying everything the row set depends on — the share url the action row already
   * uses, the API's own `canManage`, and the host-built edit route — so the menu can never resolve
   * a different link than the `Send` glyph beside it. Without one, the host's own handler runs.
   */
  const openMenu = useCallback(
    (postId: string) => {
      if (menu) {
        const post = items.find((row) => row.id === postId);
        if (post) {
          setMenuTarget({
            postId: post.id,
            shareUrl: post.shareUrl,
            canManage: post.canManage,
            editHref: post.editHref,
          });
        }
      }
      onMore?.(postId);
    },
    [menu, items, onMore],
  );

  /**
   * The card leaves the column only on a CONFIRMED delete (the 03-05 "no optimistic removal" rule):
   * a refusal re-throws, the confirmation's error branch closes the dialog, and the post stays
   * exactly where it is rather than disappearing from one member's screen while it still exists for
   * everyone else. The toasts are the host's — `onDelete` raises them either way.
   */
  const deletePost = useCallback(
    async (postId: string) => {
      if (!menu) return;
      await menu.onDelete(postId);
      setItems((previous) => previous.filter((row) => row.id !== postId));
    },
    [menu],
  );

  /**
   * The card's meta count follows the sheet (E09/partial): the DELTA is tracked per post and added
   * to the server's value at render. Rewriting `items` instead would fight the next refresh, which
   * legitimately replaces the whole list with the server's authoritative counts — at which point
   * the delta is stale by construction and is cleared with it.
   */
  const bumpCount = useCallback((postId: string, delta: number) => {
    setCountDeltas((previous) => ({ ...previous, [postId]: (previous[postId] ?? 0) + delta }));
  }, []);

  // A LINK, not a `Button`: the shipped button is a `<button>` and the composer is a route (04-09).
  // The brand styling is the button's, read through the tenant tokens exactly as `Button` reads them.
  const createCta =
    canPost && createHref ? (
      <a
        href={createHref}
        className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-bold text-on-brand transition-colors hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {labels.createCta}
      </a>
    ) : null;

  /**
   * True exactly when the empty card's own "Criar publicação" button is rendered — the one case the
   * mobile FAB stands down for (UI-SPEC §Visual Anchors, "Empty feed"): two brand fills in one
   * viewport, one of them floating over the other, is the collision UI-D-17 rules out.
   */
  const emptyCtaOnScreen = createCta !== null && items.length === 0 && !firstLoadFailed;

  let body: ReactNode;
  if (firstLoadFailed && items.length === 0) {
    body = (
      <EmptyState
        variant="card"
        icon={TriangleAlert}
        title={labels.errorTitle}
        body={labels.errorBody}
        action={
          <Button variant="outline" onClick={retryFirst}>
            {labels.errorRetry}
          </Button>
        }
      />
    );
  } else if (items.length === 0) {
    // UI-D-20: the feed's OWN empty, with the author variant carrying the create CTA.
    body = (
      <EmptyState
        variant="card"
        icon={Newspaper}
        title={labels.emptyTitle}
        body={canPost ? labels.emptyBodyAuthor : labels.emptyBody}
        action={createCta ?? undefined}
      />
    );
  } else {
    body = (
      <>
        <div className="flex flex-col gap-3">
          {items.map((post) => (
            <PostCard
              key={post.id}
              post={commentCountApplied(post, renderMedia, countDeltas[post.id] ?? 0)}
              captionTruncateAt={captionTruncateAt}
              locale={locale}
              labels={{
                more: labels.more,
                like: labels.like,
                unlike: labels.unlike,
                comment: labels.comment,
                share: labels.share,
                moreOptions: labels.moreOptions,
                likes: labels.likes,
                comments: labels.comments,
                edited: labels.edited,
                media: { carousel: labels.carousel, attachmentError: labels.attachmentError },
              }}
              onLike={onLike}
              onUnlike={onUnlike}
              onLikeError={failToast}
              onOpenComments={comments || onOpenComments ? openComments : undefined}
              onShare={onShare}
              // The control renders only when the menu it opens would actually carry a row: a member
              // on a shell with no share url has nothing to copy and nothing to manage, and a
              // control that opens an empty sheet is a promise the card cannot keep (04-06's rule).
              onMore={(menu && (post.canManage || post.shareUrl)) || onMore ? openMenu : undefined}
            />
          ))}
        </div>

        {/* The sentinel stands down while a page is refused, so a failed page cannot spin: the
            member asks for the retry explicitly (T-04-41). */}
        <InfiniteScroll
          hasMore={cursor !== null}
          enabled={!pageFailed}
          onLoadMore={loadMore}
          skeleton={<FeedCardSkeleton />}
          className="mt-3"
        />

        {pageFailed ? (
          <div
            data-feed-page-error
            className="mt-3 flex flex-col items-center gap-3 px-4 text-center"
          >
            <p className="text-sm font-normal text-danger">{labels.loadMoreError}</p>
            <Button variant="outline" onClick={retryPage}>
              {labels.loadMoreRetry}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section aria-label={labels.region} className="flex flex-col">
      {/* Desktop only (UI-D-17): a floating control over a centred column next to a rail has no
          rationale, and it would collide with the desktop toast anchor. The mobile FAB is 04-09's. */}
      {createCta ? <div className="mb-3 hidden justify-end md:flex">{createCta}</div> : null}

      <PullToRefresh onRefresh={refresh}>{body}</PullToRefresh>

      {/* ONE sheet for the column (D-59). It stays mounted with `open=false` so `AnimatePresence`
          can play its exit and `BottomSheet` can return focus to the control that opened it. */}
      {/* UI-D-17: the MOBILE create control. It is suppressed while the empty-state CTA is on screen
          so the card's own brand button stays the single brand fill in the viewport, and it renders
          nothing at all on desktop (`md:hidden` inside the component) or without the permission. */}
      {createHref ? (
        <ComposeFab
          href={createHref}
          label={labels.createFab}
          visible={canPost && !emptyCtaOnScreen}
        />
      ) : null}

      {/* ONE menu for the column (04-09), mounted like the sheet so its exit animation can play. */}
      {menu ? (
        <PostMenu
          open={menuTarget !== null}
          target={menuTarget}
          onClose={() => setMenuTarget(null)}
          onSharePost={onShare}
          onDelete={deletePost}
          labels={menu.labels}
        />
      ) : null}

      {comments ? (
        <CommentSheet
          {...comments}
          open={commentsOpenFor !== null}
          onClose={() => setCommentsOpenFor(null)}
          postId={commentsOpenFor ?? ''}
          onCountChange={(delta) => {
            if (commentsOpenFor) bumpCount(commentsOpenFor, delta);
          }}
        />
      ) : null}
    </section>
  );
}
