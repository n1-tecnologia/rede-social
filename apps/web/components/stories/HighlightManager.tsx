'use client';

import { mediaAcceptFor } from '@rede-social/contracts/media';
import {
  STORY_HIGHLIGHT_MAX_ITEMS,
  STORY_HIGHLIGHT_MAX_PER_PLACE,
  STORY_HIGHLIGHT_MAX_TITLE,
} from '@rede-social/module-stories/contracts';
import {
  type HighlightEditItem,
  HighlightEditSheet,
  type HighlightEditStep,
  type HighlightManageItem,
  HighlightManageList,
  type HighlightMembershipRow,
  HighlightStoryThumb,
  HighlightTitleStep,
} from '@rede-social/module-stories/ui';
import {
  BottomSheet,
  Button,
  EmptyState,
  InfiniteScroll,
  Skeleton,
  useToast,
} from '@rede-social/ui';
import { Bookmark, ImagePlus, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addStoryToHighlightAction,
  createHighlightAction,
  deleteHighlightAction,
  type HighlightCurationCode,
  loadHighlightEditAction,
  removeStoryFromHighlightAction,
  renameHighlightAction,
  reorderHighlightsAction,
  setHighlightCoverAction,
} from '@/app/(app)/stories/highlight-actions';
import { loadMoreOwnStoriesAction } from '@/app/(app)/stories/story-actions';
import { useSignedUpload } from '@/components/media/useSignedUpload';
import type {
  HighlightEditStoryView,
  HighlightManageRowView,
  StoryHistoryItemView,
} from '@/lib/story-view';

/**
 * The client island BOTH manage routes host (D-109, UI-D-72..UI-D-76, UI-D-80): `/stories/destaques`
 * (Início) and `/comunidades/[communityId]/destaques`. The pages are thin server shells — they gate
 * on `stories.story.manage`, read the place's curator row and hand it here — and every curation act
 * of HIGHLIGHT-01 happens on this one screen:
 *
 * - **create** ("Novo destaque" → the shared title step → appended, toast, its edit sheet opens);
 * - **reorder** (drag by the handle, the keyboard, or the edit sheet's up/down — each ONE
 *   `PUT …/order` with the full permutation, optimistic, reverting to the last server order; an
 *   `order_stale` refreshes the screen and says so);
 * - **rename, re-cover, remove a story, add stories, delete** — in the edit sheet.
 *
 * **What this file must never grow** (review these before "simplifying"):
 *
 * 1. **No cover flow deletes an asset** (R-D-E). A replaced or cleared uploaded cover stays in
 *    Storage; there is no delete call anywhere in the cover path, so there is no warning to write.
 * 2. **"Adicionar stories" is the same toggle machine and the same two actions** the viewer's
 *    "Destacar" and "Seus stories" use (D-110). Its rows are the admin's history through the SAME
 *    pager `/stories/meus` uses, expired stories included.
 * 3. **The edit sheet renders OUTSIDE any form.** The title step and the name field are forms; a
 *    form nested in a form submits the outer one (the 05.2-08 lesson). This island has no outer form.
 * 4. **`?editar=` is honoured only for an id in THIS place's server-read list** (T-05.2-41): the page
 *    validates it against the list before it reaches `editTarget`, so a crafted id opens nothing.
 *
 * Words come from the `stories` catalog through `useTranslations` (the modules ship none, PWA-03),
 * and every write resolves a closed refusal code this file turns into one toast.
 */
export interface HighlightManagerProps {
  /** `communityId: null` is Início. */
  place: { communityId: string | null };
  /** "Início" or the community name — the title step's "Em {place}". */
  placeLabel: string;
  /** The place's CURATOR row (empty highlights included), in row order. */
  initialItems: HighlightManageRowView[];
  /** UI-D-80: an archived community keeps only the take-downs. */
  archived: boolean;
  /** A validated `?editar=` id that is in `initialItems`, or null. */
  editTarget: string | null;
  /** The empty-history CTA of the picker ("Publicar story"). */
  publishHref: string;
}

type EditState = {
  id: string;
  open: boolean;
  /** The edit read; null while it is in flight. */
  items: HighlightEditStoryView[] | null;
};

type PickerState = {
  rows: StoryHistoryItemView[];
  cursor: string | null;
  /** True once the first page has landed (so an empty history can say so). */
  loaded: boolean;
};

const ACCEPT = mediaAcceptFor('image', 'cover');
const PICKER_SKELETON = [0, 1, 2];

function toManageItem(row: HighlightManageRowView): HighlightManageItem {
  return { id: row.id, title: row.title, meta: row.meta, cover: row.cover };
}

function toEditItem(view: HighlightEditStoryView): HighlightEditItem {
  return {
    id: view.id,
    thumb: view.thumb,
    mediaKind: view.mediaKind,
    dateLabel: view.dateLabel,
    ...(view.status ? { status: view.status } : {}),
    isCover: view.isCover,
  };
}

/** The 56px picker row skeleton — the real thumb and text geometry (UI E08 loading). */
function PickerSkeleton() {
  return (
    <ul aria-hidden className="flex flex-col">
      {PICKER_SKELETON.map((key) => (
        <li key={key} className="flex min-h-14 items-center gap-3 px-2 py-2">
          <Skeleton className="h-12 w-8 shrink-0 rounded-md" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-6 w-10 shrink-0 rounded-full" />
        </li>
      ))}
    </ul>
  );
}

export function HighlightManager({
  place,
  placeLabel,
  initialItems,
  archived,
  editTarget,
  publishHref,
}: HighlightManagerProps) {
  const t = useTranslations('stories');
  const tm = useTranslations('media');
  const toast = useToast();
  const router = useRouter();

  /* ── The list ────────────────────────────────────────────────────────────────────────────── */

  const [items, setItems] = useState(initialItems);
  /** The last order the SERVER confirmed — what a refused reorder puts back. */
  const confirmed = useRef(initialItems);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // A fresh server read (router.refresh after `order_stale`, a revalidation) re-seeds the list.
  const [seed, setSeed] = useState(initialItems);
  if (seed !== initialItems) {
    setSeed(initialItems);
    setItems(initialItems);
    confirmed.current = initialItems;
  }

  const manageItems = useMemo(() => items.map(toManageItem), [items]);

  const replaceRow = useCallback((row: HighlightManageRowView) => {
    setItems((current) => current.map((item) => (item.id === row.id ? row : item)));
    confirmed.current = confirmed.current.map((item) => (item.id === row.id ? row : item));
  }, []);

  const toastFor = useCallback(
    (code: HighlightCurationCode) => {
      const message =
        code === 'archived'
          ? t('highlights.errors.archived')
          : code === 'full'
            ? t('highlights.errors.full', { limit: STORY_HIGHLIGHT_MAX_ITEMS })
            : t('highlights.errors.generic');
      toast.show({ tone: 'error', message });
    },
    [t, toast],
  );

  /**
   * ONE reorder request with the full permutation (UI-D-73) — from a drop, a keypress or the edit
   * sheet's move buttons. Optimistic; a failure puts back the last server order with its toast, and
   * `order_stale` refreshes the screen so the admin sees the order the server really holds.
   */
  const reorder = useCallback(
    async (ids: string[]): Promise<boolean> => {
      const byId = new Map(itemsRef.current.map((item) => [item.id, item]));
      const next = ids.map((id) => byId.get(id)).filter((item) => item !== undefined);
      if (next.length !== ids.length) return false;
      setItems(next);

      const result = await reorderHighlightsAction(place, ids);
      if (result.ok) {
        confirmed.current = result.items;
        setItems(result.items);
        return true;
      }
      setItems(confirmed.current);
      if (result.code === 'order_stale') {
        toast.show({ tone: 'error', message: t('highlights.errors.orderStale') });
        router.refresh();
      } else {
        toast.show({ tone: 'error', message: t('highlights.errors.order') });
      }
      return false;
    },
    [place, router, t, toast],
  );

  /* ── The edit sheet ──────────────────────────────────────────────────────────────────────── */

  /** Outlives the close (`open: false`) so the sheet's exit animation keeps its content. */
  const [edit, setEdit] = useState<EditState | null>(null);
  /** The id the latest edit read was issued for — a late answer for another highlight is dropped. */
  const reading = useRef<string | null>(null);
  /** True when a picker toggle changed memberships since the last edit read. */
  const membershipDirty = useRef(false);
  /** The picker's history pages — the same for every highlight, so kept across edit sheets. */
  const [picker, setPicker] = useState<PickerState | null>(null);
  const pickerLoading = useRef(false);

  const readEdit = useCallback(
    async (id: string, { closeOnFailure }: { closeOnFailure: boolean }) => {
      reading.current = id;
      let result: Awaited<ReturnType<typeof loadHighlightEditAction>> = { ok: false };
      try {
        result = await loadHighlightEditAction(id);
      } catch (error) {
        console.error('stories.highlight_edit_read_failed', { error: String(error) });
      }
      if (reading.current !== id) return;
      if (!result.ok) {
        toast.show({ tone: 'error', message: t('history.errors.generic') });
        if (closeOnFailure) setEdit((state) => (state ? { ...state, open: false } : state));
        return;
      }
      replaceRow(result.highlight);
      setEdit((state) => (state && state.id === id ? { ...state, items: result.items } : state));
    },
    [replaceRow, t, toast],
  );

  const openEdit = useCallback(
    (id: string) => {
      membershipDirty.current = false;
      setEdit({ id, open: true, items: null });
      void readEdit(id, { closeOnFailure: true });
    },
    [readEdit],
  );

  const closeEdit = useCallback(() => {
    setEdit((state) => (state ? { ...state, open: false } : state));
    // The row's count and cover follow what the picker changed.
    if (membershipDirty.current && edit) {
      membershipDirty.current = false;
      void readEdit(edit.id, { closeOnFailure: false });
    }
  }, [edit, readEdit]);

  // `?editar={id}` on arrival opens that highlight's edit sheet (UI-D-63b) — once, and the param is
  // dropped from the address so a refresh does not reopen it.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || editTarget === null) return;
    arrived.current = true;
    openEdit(editTarget);
    window.history.replaceState(null, '', window.location.pathname);
  }, [editTarget, openEdit]);

  const current = edit ? items.find((item) => item.id === edit.id) : undefined;
  const position = current ? items.indexOf(current) + 1 : 0;

  const editViews = edit?.items ?? null;
  const editItems = useMemo(
    () => (editViews === null ? null : editViews.map(toEditItem)),
    [editViews],
  );
  const removeLabels = useMemo(
    () => new Map((editViews ?? []).map((view) => [view.id, view.removeLabel])),
    [editViews],
  );

  const rename = async (title: string): Promise<boolean> => {
    if (!current) return false;
    const result = await renameHighlightAction(current.id, title, place);
    if (!result.ok) {
      toastFor(result.code);
      return false;
    }
    replaceRow(result.highlight);
    toast.show({ tone: 'success', message: t('highlights.toasts.renamed') });
    return true;
  };

  const move = (delta: -1 | 1) => {
    if (!current) return;
    const ids = itemsRef.current.map((item) => item.id);
    const from = ids.indexOf(current.id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(from, 1);
    ids.splice(to, 0, current.id);
    void reorder(ids);
  };

  const removeStory = async (storyId: string): Promise<boolean> => {
    if (!current) return false;
    const result = await removeStoryFromHighlightAction(storyId, current.id, {
      communityId: place.communityId,
      revalidate: true,
    });
    if (!result.ok) {
      toastFor(result.code);
      return false;
    }
    toast.show({ tone: 'success', message: t('highlights.toasts.removed') });
    // The count, the cover and the "Capa" pill may all have moved: re-read the one highlight.
    void readEdit(current.id, { closeOnFailure: false });
    return true;
  };

  const setCover = async (
    cover: { storyId: string } | { assetId: string } | null,
  ): Promise<boolean> => {
    if (!current) return false;
    const result = await setHighlightCoverAction(current.id, cover, place);
    if (!result.ok) {
      toastFor(result.code);
      return false;
    }
    replaceRow(result.highlight);
    toast.show({ tone: 'success', message: t('highlights.toasts.coverChanged') });
    void readEdit(current.id, { closeOnFailure: false });
    return true;
  };

  const removeHighlight = async (): Promise<boolean> => {
    if (!current) return false;
    const id = current.id;
    const result = await deleteHighlightAction(id, place);
    if (!result.ok) {
      // UI E06 error: the dialog closes, the toast fires, and the highlight stays.
      toastFor(result.code);
      return false;
    }
    setEdit((state) => (state ? { ...state, open: false } : state));
    setItems((list) => list.filter((item) => item.id !== id));
    confirmed.current = confirmed.current.filter((item) => item.id !== id);
    toast.show({ tone: 'success', message: t('highlights.toasts.deleted') });
    return true;
  };

  /* ── The cover upload (UI-D-75): the Phase 3 machine, purpose `cover`, image only ─────────── */

  const fileRef = useRef<HTMLInputElement>(null);
  /** Read inside the upload's completion, which may land after a re-render. */
  const setCoverRef = useRef(setCover);
  setCoverRef.current = setCover;
  const upload = useSignedUpload({
    kind: 'image',
    purpose: 'cover',
    // No upload toast: the cover write's own "Capa atualizada." is the confirmation.
    successKey: null,
    onCompleted: async (asset) => {
      // An asset not `ready` yet answers the bare 404 → the generic toast, and the admin retries
      // (the `CommunityForm` cover posture). Nothing here ever deletes an asset (R-D-E).
      await setCoverRef.current({ assetId: asset.id });
    },
  });
  const uploading = upload.state === 'preparing' || upload.state === 'progress';

  const uploadTile = (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        aria-label={t('highlights.cover.upload')}
        disabled={uploading}
        onClick={() => fileRef.current?.click()}
        className="block shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
      >
        <span className="block rounded-full border-2 border-dashed border-border-secondary p-0.5">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-bg-tertiary text-text-secondary">
            <ImagePlus aria-hidden size={20} />
          </span>
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload.pick(file);
        }}
      />
      {upload.state === 'progress' ? (
        <div className="flex w-16 flex-col gap-1">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={upload.progress}
            className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-200 ease-linear"
              style={{ width: `${upload.progress}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-xs tabular-nums text-text-tertiary">
            {tm('progress', { percent: upload.progress })}
          </span>
        </div>
      ) : null}
      {upload.error ? (
        <p role="alert" className="max-w-48 text-xs font-normal text-danger">
          {upload.error}
        </p>
      ) : null}
    </div>
  );

  /* ── "Adicionar stories" (UI-D-76): the history, through the "Seus stories" pager ─────────── */

  const loadPickerPage = useCallback(
    async (cursor: string | undefined) => {
      if (pickerLoading.current) return;
      pickerLoading.current = true;
      try {
        const page = await loadMoreOwnStoriesAction(cursor);
        if (!page.ok) {
          toast.show({ tone: 'error', message: t('history.errors.generic') });
          setPicker((state) => (state ? { ...state, loaded: true, cursor: null } : state));
          return;
        }
        // APPEND: a page that arrives never re-orders what is already listed.
        setPicker((state) => ({
          rows: [...(state?.rows ?? []), ...page.items],
          cursor: page.nextCursor,
          loaded: true,
        }));
      } catch (error) {
        console.error('stories.highlight_picker_failed', { error: String(error) });
        setPicker((state) => (state ? { ...state, loaded: true, cursor: null } : state));
      } finally {
        pickerLoading.current = false;
      }
    },
    [t, toast],
  );

  const onStepChange = (step: HighlightEditStep) => {
    if (step === 'picker' && picker === null) {
      setPicker({ rows: [], cursor: null, loaded: false });
      void loadPickerPage(undefined);
    }
    if (step === 'main' && membershipDirty.current && edit) {
      membershipDirty.current = false;
      void readEdit(edit.id, { closeOnFailure: false });
    }
  };

  const pickerRows = useMemo<HighlightMembershipRow[]>(
    () =>
      (picker?.rows ?? []).map((row) => ({
        id: row.id,
        title: row.date,
        leading: (
          <HighlightStoryThumb
            thumb={{ assetId: row.thumbnailAssetId, variantWidths: row.thumbnailVariantWidths }}
          />
        ),
        meta: (
          <span className={row.captionMuted ? 'text-text-tertiary' : undefined}>{row.caption}</span>
        ),
      })),
    [picker?.rows],
  );
  // The switches are ON for the stories already in this highlight — the edit read's ids. The array
  // identity changes only with a new edit read, which is what re-seeds the toggle machine.
  const pickerSelectedIds = useMemo(
    () => (editViews === null ? null : editViews.map((view) => view.id)),
    [editViews],
  );

  const togglePicker = async (storyId: string, next: boolean): Promise<boolean> => {
    if (!current) return false;
    const target = { communityId: place.communityId, revalidate: true };
    const result = next
      ? await addStoryToHighlightAction(storyId, current.id, target)
      : await removeStoryFromHighlightAction(storyId, current.id, target);
    if (!result.ok) {
      toastFor(result.code);
      return false;
    }
    membershipDirty.current = true;
    toast.show({
      tone: 'success',
      message: next ? t('highlights.toasts.added') : t('highlights.toasts.removed'),
    });
    return true;
  };

  const pickerFooter =
    picker === null || !picker.loaded ? (
      <PickerSkeleton />
    ) : (
      <InfiniteScroll
        hasMore={picker.cursor !== null}
        onLoadMore={() => loadPickerPage(picker.cursor ?? undefined)}
        skeleton={<PickerSkeleton />}
      />
    );

  const pickerEmpty =
    picker?.loaded && picker.rows.length === 0 ? (
      <div className="flex flex-col items-start gap-2 py-4">
        <p className="text-sm font-normal text-text-secondary">{t('highlights.picker.empty')}</p>
        <a
          href={publishHref}
          className="rounded text-sm font-bold text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          {t('history.empty.cta')}
        </a>
      </div>
    ) : null;

  /* ── Create (UI-D-72) ────────────────────────────────────────────────────────────────────── */

  const [creating, setCreating] = useState(false);

  const create = async (title: string): Promise<boolean> => {
    const result = await createHighlightAction(place, title);
    if (!result.ok) {
      // UI E05 error: the step stays open, title kept. A place already holding
      // STORY_HIGHLIGHT_MAX_PER_PLACE is the PLACE-cap copy (review WR-03: "Tente novamente" can never
      // succeed there); `archived` its own copy; anything else the generic one. `toastFor('full')`
      // stays the ITEM cap, which is what the add-story paths mean by `full`.
      if (result.code === 'full') {
        toast.show({
          tone: 'error',
          message: t('highlights.errors.placeFull', { limit: STORY_HIGHLIGHT_MAX_PER_PLACE }),
        });
      } else {
        toastFor(result.code === 'archived' ? 'archived' : 'generic');
      }
      return false;
    }
    setItems((list) => [...list, result.highlight]);
    confirmed.current = [...confirmed.current, result.highlight];
    toast.show({ tone: 'success', message: t('highlights.toasts.created') });
    setCreating(false);
    // The next step in every case: add stories and a cover.
    openEdit(result.highlight.id);
    return true;
  };

  const createButton = (
    <Button
      type="button"
      variant="brand"
      size="md"
      onClick={() => setCreating(true)}
      className="w-full sm:w-auto"
    >
      <Plus aria-hidden size={16} />
      {t('highlights.manage.create')}
    </Button>
  );

  /* ── Render ──────────────────────────────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {items.length === 0 ? (
        <EmptyState
          variant="card"
          icon={Bookmark}
          title={t('highlights.empty.title')}
          body={
            place.communityId === null
              ? t('highlights.empty.bodyHome')
              : t('highlights.empty.bodyCommunity')
          }
          action={archived ? undefined : createButton}
        />
      ) : (
        <>
          {archived ? null : <div>{createButton}</div>}
          <HighlightManageList
            items={manageItems}
            archived={archived}
            onReorder={reorder}
            onOpen={openEdit}
            labels={{
              region: t('highlights.manage.region'),
              helper: t('highlights.manage.helper'),
              dragHint: t('highlights.manage.dragHint'),
              drag: (title) => t('highlights.manage.drag', { title }),
              edit: (title) => t('highlights.manage.edit', { title }),
              moved: (title, at, total) =>
                t('highlights.manage.moved', { title, position: at, total }),
            }}
          />
        </>
      )}

      <BottomSheet
        open={creating}
        onClose={() => setCreating(false)}
        title={t('highlights.create.title')}
      >
        {creating ? (
          <HighlightTitleStep
            placeLine={t('highlights.create.place', { place: placeLabel })}
            label={t('highlights.create.label')}
            placeholder={t('highlights.create.placeholder')}
            counter={(count, limit) => t('highlights.create.counter', { count, limit })}
            limit={STORY_HIGHLIGHT_MAX_TITLE}
            submitLabel={t('highlights.create.submit')}
            submittingLabel={t('highlights.create.submitting')}
            emptyError={t('highlights.errors.titleEmpty')}
            onSubmit={create}
          />
        ) : null}
      </BottomSheet>

      {edit && current ? (
        <HighlightEditSheet
          open={edit.open}
          onClose={closeEdit}
          highlight={{
            id: current.id,
            title: current.title,
            cover: current.cover,
            coverChosen: current.coverChosen,
            position,
            total: items.length,
            archived,
          }}
          items={editItems}
          onRename={rename}
          onMove={move}
          onRemove={removeStory}
          onCover={(cover) => setCover(cover)}
          onDelete={removeHighlight}
          uploadTile={uploadTile}
          pickerRows={pickerRows}
          pickerSelectedIds={pickerSelectedIds}
          onPickerToggle={togglePicker}
          pickerFooter={pickerFooter}
          pickerEmpty={pickerEmpty}
          onStepChange={onStepChange}
          labels={{
            title: t('highlights.edit.title'),
            cover: t('highlights.edit.cover'),
            changeCover: t('highlights.edit.changeCover'),
            name: t('highlights.edit.name'),
            saveName: t('highlights.edit.saveName'),
            savingName: t('highlights.edit.savingName'),
            counter: (count, limit) => t('highlights.create.counter', { count, limit }),
            limit: STORY_HIGHLIGHT_MAX_TITLE,
            position: (at, total) => t('highlights.edit.position', { position: at, total }),
            moveUp: t('highlights.edit.moveUp'),
            moveDown: t('highlights.edit.moveDown'),
            stories: t('highlights.edit.stories'),
            coverPill: t('highlights.edit.coverPill'),
            remove: (item) =>
              removeLabels.get(item.id) ?? t('highlights.edit.remove', { date: item.dateLabel }),
            addStories: t('highlights.edit.addStories'),
            delete: t('highlights.edit.delete'),
            emptyTitle: t('highlights.edit.emptyTitle'),
            emptyBody: t('highlights.edit.emptyBody'),
            archivedNote: t('highlights.edit.archivedNote'),
            back: t('highlights.create.back'),
            coverTitle: t('highlights.cover.title'),
            coverOption: (item) =>
              item.isCover
                ? `${t('highlights.cover.option', { date: item.dateLabel })} ${t('highlights.cover.current')}`
                : t('highlights.cover.option', { date: item.dateLabel }),
            auto: t('highlights.cover.auto'),
            autoHelper: t('highlights.cover.autoHelper'),
            noImages: t('highlights.cover.noImages'),
            pickerTitle: t('highlights.picker.title'),
            pickerHelper: t('highlights.picker.helper'),
            pickerRow: (row) => t('highlights.picker.row', { date: row.title }),
            confirmDelete: {
              title: t('highlights.confirmDelete.title'),
              body: t('highlights.confirmDelete.body', { title: current.title }),
              confirm: t('highlights.confirmDelete.confirm'),
              cancel: t('highlights.confirmDelete.cancel'),
            },
          }}
        />
      ) : null}
    </div>
  );
}
