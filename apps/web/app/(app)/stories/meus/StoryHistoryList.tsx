'use client';

import { STORY_HIGHLIGHT_MAX_ITEMS } from '@rede-social/module-stories/contracts';
import {
  HighlightSheet,
  type HighlightSheetPlace,
  StoryHistoryRow,
} from '@rede-social/module-stories/ui';
import {
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  InfiniteScroll,
  Skeleton,
  useToast,
} from '@rede-social/ui';
import { Bookmark, CircleAlert, Eye, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useRef, useState, useTransition } from 'react';
import {
  addStoryToHighlightAction,
  loadHighlightSheetAction,
  removeStoryFromHighlightAction,
} from '@/app/(app)/stories/highlight-actions';
import { deleteStoryAction, loadMoreOwnStoriesAction } from '@/app/(app)/stories/story-actions';
import type { HighlightPlaceView, StoryHistoryItemView } from '@/lib/story-view';

/**
 * The body of "Seus stories" (D-84, UI-D-40, UI-D-77) — the list, the row menu, the delete
 * confirmation and the highlight sheet (D-110 route 2).
 *
 * **"Destacar" opens the SAME sheet the viewer opens** (plan 06): `HighlightSheet` in checklist mode,
 * fed by the same `loadHighlightSheetAction`, toggled by the same two actions. It works on ANY story
 * in the history, an expired one included — that is what replaced "Fixar em comunidades": an admin
 * keeps an expired story visible by putting it into a highlight from here.
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
 * **The sheet's state is read when it OPENS, not with the page** (UI E12 loading). A story's
 * memberships are small and specific; fetching them for every row up front would be one request per
 * story for a sheet the admin opens on one of them. While the read is in flight nothing is rendered,
 * so there is no state to be wrong about; a failed read opens nothing and fires the generic toast.
 *
 * **The row's "Em # destaques" follows each CONFIRMED toggle** (UI-D-77): the toggle's answer
 * carries the story's `highlightCount` after the write, and the row is replaced from THAT number —
 * never a local +1/−1 — so it cannot drift from the server. A reverted toggle changes nothing;
 * reaching 0 removes the indicator. Toggles pass `revalidate: true`: this is a list screen, not an
 * open viewer, so the place the highlight lives (`/inicio` or `/comunidades/{id}`) is re-rendered for
 * the admin's next visit.
 */
export interface StoryHistoryListProps {
  initialItems: StoryHistoryItemView[];
  initialCursor: string | null;
  /** `true` when the server could not read the first page at all (UI E08/error). */
  initialError?: boolean;
  publishHref: string;
}

/**
 * The sheet's target and its server-composed read. It OUTLIVES the close (`open: false`) so the
 * sheet's exit animation keeps its rows instead of flashing the empty state — the viewer's rule.
 */
type HighlightSheetState = {
  storyId: string;
  places: HighlightPlaceView[];
  selectedIds: string[];
  open: boolean;
};

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
  icon: typeof Bookmark;
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
  /** The highlight sheet (D-110 route 2); null until the first "Destacar" read resolves. */
  const [sheet, setSheet] = useState<HighlightSheetState | null>(null);
  /** A second "Destacar" while a read is in flight is a no-op. */
  const sheetReading = useRef(false);

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

  const openHighlightSheet = useCallback(
    async (story: StoryHistoryItemView) => {
      setMenuStory(null);
      if (sheetReading.current) return;
      sheetReading.current = true;
      let opened = false;
      try {
        const result = await loadHighlightSheetAction(story.id);
        if (result.ok) {
          setSheet({
            storyId: story.id,
            places: result.places,
            selectedIds: result.selectedIds,
            open: true,
          });
          opened = true;
        }
      } catch {
        // The same answer as `{ ok: false }`.
      } finally {
        sheetReading.current = false;
      }
      // Nothing opens: a sheet whose switches described a state nobody verified would be worse
      // than the toast, because the admin would act on it (UI E12 error).
      if (!opened) failToast();
    },
    [failToast],
  );

  // Stable by habit: `BottomSheet`'s focus trap reads `onClose` through a ref and arms once per
  // opening, so a new identity would no longer move the focus.
  const closeHighlightSheet = useCallback(() => {
    setSheet((current) => (current ? { ...current, open: false } : current));
  }, []);

  /** The row's indicator from the SERVER's count after a confirmed write (UI-D-77); 0 removes it. */
  const applyHighlightCount = useCallback(
    (storyId: string, count: number) => {
      setItems((previous) =>
        previous.map((entry) => {
          if (entry.id !== storyId) return entry;
          const { highlighted: _dropped, ...rest } = entry;
          return count > 0
            ? { ...rest, highlighted: { count, label: t('history.highlighted', { count }) } }
            : rest;
        }),
      );
    },
    [t],
  );

  const sheetStoryId = sheet?.storyId ?? null;

  /**
   * ONE toggle, ONE request (UI-D-67). It resolves `true`/`false` rather than throwing, because the
   * sheet's machine reverts its switch on `false` — and the toast is fired HERE, where the words
   * live, rather than inside a module that ships none.
   */
  const toggleHighlight = useCallback(
    async (highlightId: string, next: boolean, place: HighlightSheetPlace): Promise<boolean> => {
      if (sheetStoryId === null) return false;
      const write = next ? addStoryToHighlightAction : removeStoryFromHighlightAction;
      let result: Awaited<ReturnType<typeof write>>;
      try {
        result = await write(sheetStoryId, highlightId, {
          communityId: place.communityId,
          revalidate: true,
        });
      } catch {
        result = { ok: false, code: 'generic' };
      }
      if (result.ok) {
        applyHighlightCount(sheetStoryId, result.highlightCount);
        toast.show({
          tone: 'success',
          message: t(next ? 'highlights.toasts.added' : 'highlights.toasts.removed'),
        });
        return true;
      }
      toast.show({
        tone: 'error',
        message:
          result.code === 'archived'
            ? t('highlights.errors.archived')
            : result.code === 'full'
              ? t('highlights.errors.full', { limit: STORY_HIGHLIGHT_MAX_ITEMS })
              : t('highlights.errors.generic'),
      });
      // `false` is what makes the sheet's machine REVERT the switch; the row's count is untouched.
      return false;
    },
    [sheetStoryId, applyHighlightCount, toast, t],
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
              className="inline-flex h-11 items-center justify-center rounded-xl bg-button bg-(image:--button-image) px-5 text-sm font-bold text-on-button transition-opacity hover:opacity-90"
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
                  highlighted={story.highlighted}
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

      {/* UI-D-77's row menu: "Destacar" · "Ver story" · "Excluir story", the destructive one last. */}
      <BottomSheet
        open={menuStory !== null}
        onClose={() => setMenuStory(null)}
        title={t('history.menu.title')}
      >
        <div className="flex flex-col gap-1">
          <MenuRow
            icon={Bookmark}
            label={t('history.menu.highlight')}
            onClick={() => {
              if (menuStory) void openHighlightSheet(menuStory);
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

      {/* UI-D-67's checklist, the SAME component and read the viewer uses (D-110 route 2). */}
      {sheet ? (
        <HighlightSheet
          mode="checklist"
          open={sheet.open}
          onClose={closeHighlightSheet}
          title={t('highlights.sheet.title')}
          helper={t('highlights.sheet.helper')}
          places={sheet.places}
          selectedIds={sheet.selectedIds}
          rowLabel={(row, place) =>
            t('highlights.sheet.row', { title: row.title, place: place.label })
          }
          onToggle={toggleHighlight}
          empty={
            // UI-D-67 empty: no highlight anywhere. Curation has ONE door (D-109), so the CTA
            // leaves for the manage screen rather than creating inline.
            <div className="flex flex-col items-start gap-2 py-4">
              <p className="text-sm font-normal text-text-secondary">
                {t('highlights.sheet.emptyTitle')}
              </p>
              <p className="text-sm font-normal text-text-tertiary">
                {t('highlights.sheet.emptyBody')}
              </p>
              <a
                href="/stories/destaques"
                className="rounded text-sm font-bold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {t('highlights.sheet.emptyCta')}
              </a>
            </div>
          }
        />
      ) : null}
    </div>
  );
}

export { HistorySkeleton };
