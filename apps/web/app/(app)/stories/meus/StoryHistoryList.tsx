'use client';

import { CommunityPickerSheet } from '@tria/module-communities/ui';
import { type PinStoryCommunityRow, PinStorySheet, StoryHistoryRow } from '@tria/module-stories/ui';
import {
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  InfiniteScroll,
  Skeleton,
  useToast,
} from '@tria/ui';
import { CircleAlert, Eye, Pin, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useState, useTransition } from 'react';
import {
  deleteStoryAction,
  loadMoreOwnStoriesAction,
  loadStoryPinsAction,
  pinStoryAction,
  unpinStoryAction,
} from '@/app/(app)/stories/story-actions';
import type { StoryHistoryItemView } from '@/lib/story-view';

/**
 * The body of "Seus stories" (D-84, UI-D-40, UI-D-41) — the list, the row menu, the delete
 * confirmation and the pin sheet.
 *
 * **This file is where the two modules meet, and it is the only place they may.** `turbo boundaries`
 * denies a `module -> module` package edge (MOD-02), so `PinStorySheet` (stories) cannot import
 * `CommunityPickerSheet` (communities). `apps/web` may reach both, so the composition happens here:
 * the picker's list body is passed into the pin sheet as `renderList`, and the mapping from
 * `CommunitySummary` onto `PinStoryCommunityRow` happens once, on the page above. The identical
 * resolution `StoryViewerHost` reached for the comment sheet in 05-07.
 *
 * **Pagination is APPEND-NEVER-REPLACE** (the `MembersList` / `CommunityPosts` state machine): a
 * page that arrives never re-orders or replaces what is already rendered, and a failed page leaves
 * the loaded rows on screen with an inline retry — the 03-05 rule. `InfiniteScroll` renders exactly
 * one row skeleton at the real geometry while a page is in flight (UI loading/E08).
 *
 * **The delete removes the row LOCALLY as well as revalidating.** The action soft-deletes and
 * revalidates `/inicio` and this route, but the admin is standing on the list watching: leaving the
 * row until a refresh lands would read as a failure. It is removed only on a CONFIRMED success —
 * never optimistically — because a refusal that had already removed the row would be a lie.
 *
 * **The pin sheet's state is read when it OPENS, not with the page.** A story's pin set is small
 * and specific; fetching it for every row up front would be one request per story for a sheet the
 * admin opens on one of them. While it is in flight the sheet is not yet rendered, so there is no
 * state to be wrong about (UI loading/E09: the sheet opens with its list already rendered).
 */
export interface StoryHistoryListProps {
  initialItems: StoryHistoryItemView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all (UI E08/error). */
  initialError?: boolean;
  /** Every ACTIVE community, from the page's own read (UI partial/E09). */
  communities: PinStoryCommunityRow[];
  createCommunityHref: string;
  publishHref: string;
}

/** Six rows at the REAL 48×64 thumbnail geometry, so nothing jumps when content replaces them. */
const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

function HistorySkeleton({ rows = SKELETON_ROWS }: { rows?: number[] }) {
  return (
    <div aria-busy data-testid="story-history-skeleton" className="flex flex-col">
      {rows.map((index) => (
        <div key={index} className="flex min-h-14 items-center gap-3 px-4 py-3">
          <Skeleton variant="rect" className="h-16 w-12 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="text" width="60%" className="h-3.5" />
            <Skeleton variant="text" width="40%" className="h-3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One 44px-minimum sheet row — the `PostMenu` shape, which is the product's one menu geometry. */
function MenuRow({
  icon: Icon,
  label,
  destructive,
  onClick,
  href,
}: {
  icon: typeof Pin;
  label: string;
  destructive?: boolean;
  onClick?: () => void;
  href?: string;
}): ReactNode {
  const shape = [
    'flex min-h-[44px] w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-bold',
    'transition-colors hover:bg-bg-hover active:bg-bg-tertiary',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
    destructive ? 'text-danger' : 'text-text',
  ].join(' ');

  const inner = (
    <>
      <Icon aria-hidden size={20} className={destructive ? undefined : 'text-text-secondary'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={shape}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={shape}>
      {inner}
    </button>
  );
}

export function StoryHistoryList({
  initialItems,
  initialCursor,
  initialError,
  communities,
  createCommunityHref,
  publishHref,
}: StoryHistoryListProps) {
  const t = useTranslations('stories');
  const toast = useToast();

  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [failed, setFailed] = useState(Boolean(initialError));
  const [, startLoadMore] = useTransition();

  /** Which story the row menu is open on. Null closes it; the sheet stays mounted to animate out. */
  const [menuStory, setMenuStory] = useState<StoryHistoryItemView | null>(null);
  const [confirmStory, setConfirmStory] = useState<StoryHistoryItemView | null>(null);
  /** The pin sheet's target and its server-read initial state, resolved together when it opens. */
  const [pinTarget, setPinTarget] = useState<{ id: string; pinned: string[] } | null>(null);

  const loadMore = useCallback(() => {
    if (!cursor) return;
    const from = cursor;
    startLoadMore(async () => {
      try {
        const page = await loadMoreOwnStoriesAction(from);
        if (!page.ok) {
          setFailed(true);
          return;
        }
        setFailed(false);
        // APPEND: the rows already on screen keep their order and their DOM position.
        setItems((previous) => [...previous, ...page.items]);
        setCursor(page.nextCursor);
      } catch (error) {
        console.error('stories.history.load_more_failed', { error: String(error) });
        setFailed(true);
      }
    });
  }, [cursor]);

  const failToast = useCallback(() => {
    toast.show({ tone: 'error', message: t('history.errors.generic') });
  }, [toast, t]);

  const openPinSheet = useCallback(
    async (story: StoryHistoryItemView) => {
      setMenuStory(null);
      const pinned = await loadStoryPinsAction(story.id);
      if (pinned === null) {
        // Nothing opens: a sheet whose switches described a state nobody verified would be worse
        // than the toast, because the admin would act on it.
        failToast();
        return;
      }
      setPinTarget({ id: story.id, pinned });
    },
    [failToast],
  );

  /**
   * ONE toggle, ONE request (UI-D-41). It resolves `true`/`false` rather than throwing, because
   * `PinStorySheet` reverts its switch on `false` — and the toast is fired HERE, where the words
   * live, rather than inside a module that ships none.
   */
  const togglePin = useCallback(
    async (communityId: string, next: boolean): Promise<boolean> => {
      if (!pinTarget) return false;
      const ok = next
        ? await pinStoryAction(pinTarget.id, communityId)
        : await unpinStoryAction(pinTarget.id, communityId);
      if (!ok) {
        failToast();
        return false;
      }
      toast.show({ tone: 'success', message: t(next ? 'pin.pinned' : 'pin.unpinned') });
      return true;
    },
    [pinTarget, failToast, toast, t],
  );

  const confirmDelete = useCallback(async () => {
    const story = confirmStory;
    if (!story) return;
    const result = await deleteStoryAction(story.id);
    if (!result.ok) {
      // UI E08/error: the dialog closes and the generic toast fires — no inline message on a
      // destructive confirmation, and the row stays because nothing was removed.
      failToast();
      return;
    }
    setItems((previous) => previous.filter((entry) => entry.id !== story.id));
    toast.show({ tone: 'success', message: t('history.toasts.deleted') });
  }, [confirmStory, failToast, toast, t]);

  const errorState = (
    <EmptyState
      variant="card"
      icon={CircleAlert}
      title={t('history.errors.title')}
      body={t('history.errors.body')}
      action={
        <Button
          variant="outline"
          onClick={() => {
            setFailed(false);
            loadMore();
          }}
        >
          {t('history.errors.retry')}
        </Button>
      }
    />
  );

  let body: ReactNode;
  if (failed && items.length === 0) {
    body = <div className="px-4 pt-4">{errorState}</div>;
  } else if (items.length === 0) {
    // UI empty/E08: the screen is also an entry point, so its empty state carries the publish CTA
    // — the same shape D-77 gave the community list.
    body = (
      <div className="px-4 pt-4">
        <EmptyState
          variant="card"
          icon={Sparkles}
          title={t('history.empty.title')}
          body={t('history.empty.body')}
          action={
            <a
              href={publishHref}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand px-5 text-sm font-bold text-on-brand transition-opacity hover:opacity-90"
            >
              {t('history.empty.cta')}
            </a>
          }
        />
      </div>
    );
  } else {
    body = (
      <>
        <Card className="rounded-none bg-transparent shadow-none md:rounded-xl md:bg-card md:shadow-[0_1px_3px_rgba(22,35,59,.06)]">
          <ul aria-label={t('history.region')} className="flex flex-col">
            {items.map((story, index) => (
              <li
                key={story.id}
                className={index === items.length - 1 ? undefined : 'border-b border-divider'}
              >
                <StoryHistoryRow
                  thumbnailAssetId={story.thumbnailAssetId}
                  thumbnailVariantWidths={story.thumbnailVariantWidths}
                  thumbnailAlt={story.thumbnailAlt}
                  caption={story.caption}
                  captionMuted={story.captionMuted}
                  meta={story.meta}
                  note={story.note}
                  status={story.status}
                  pinned={story.pinned}
                  actionLabel={story.actionLabel}
                  onOpen={() => setMenuStory(story)}
                />
              </li>
            ))}
          </ul>
        </Card>

        {failed ? <div className="mt-4 px-4">{errorState}</div> : null}

        {!failed ? (
          <InfiniteScroll
            hasMore={cursor !== null}
            onLoadMore={loadMore}
            skeleton={<HistorySkeleton rows={[0]} />}
          />
        ) : null}
      </>
    );
  }

  return (
    <div className="flex flex-col pb-6">
      {body}

      {/* UI-D-40's row menu: three actions, the destructive one last. */}
      <BottomSheet
        open={menuStory !== null}
        onClose={() => setMenuStory(null)}
        title={t('history.menu.title')}
      >
        <div className="flex flex-col gap-1">
          <MenuRow
            icon={Pin}
            label={t('history.menu.pin')}
            onClick={() => {
              if (menuStory) void openPinSheet(menuStory);
            }}
          />
          <MenuRow
            icon={Eye}
            label={t('history.menu.view')}
            href={menuStory?.viewHref ?? undefined}
          />
          <MenuRow
            icon={Trash2}
            label={t('history.menu.delete')}
            destructive
            onClick={() => {
              setConfirmStory(menuStory);
              setMenuStory(null);
            }}
          />
        </div>
      </BottomSheet>

      {/* The confirmation quotes NOTHING (the `PostMenu` rule): all four strings are fixed catalog
          values, so no caption and no community name can reach a 300px panel. */}
      <ConfirmDialog
        open={confirmStory !== null}
        title={t('history.confirmDelete.title')}
        body={t('history.confirmDelete.body')}
        confirmLabel={t('history.confirmDelete.confirm')}
        cancelLabel={t('history.confirmDelete.cancel')}
        tone="danger"
        onConfirm={confirmDelete}
        onClose={() => setConfirmStory(null)}
        onError={failToast}
      />

      {/* UI-D-41. The picker's list body is INJECTED here because this is the one tier that may
          import both modules — see this file's docblock. */}
      <PinStorySheet
        open={pinTarget !== null}
        onClose={() => setPinTarget(null)}
        title={t('pin.title')}
        helper={t('pin.helper')}
        rows={communities}
        pinnedCommunityIds={pinTarget?.pinned ?? []}
        rowLabel={(row) => t('pin.row', { community: row.name })}
        onToggle={togglePin}
        empty={
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <p className="text-sm font-normal text-text-secondary">{t('pin.empty')}</p>
            <a href={createCommunityHref} className="text-sm font-bold text-brand">
              {t('pin.create')}
            </a>
          </div>
        }
        renderList={CommunityPickerSheet}
      />
    </div>
  );
}

export { HistorySkeleton };
