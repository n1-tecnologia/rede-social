'use client';

import { MediaImage } from '@rede-social/core/ui';
import {
  BottomSheet,
  Button,
  ConfirmDialog,
  EmptyState,
  IconButton,
  Input,
  Skeleton,
  StatusPill,
} from '@rede-social/ui';
import {
  Bookmark,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { HighlightMembershipList, type HighlightMembershipRow } from './HighlightSheet';
import { StoryMonogram } from './StoryCircle';

/**
 * UI-D-74 — the edit sheet of ONE highlight, with its two body steps: the cover step (UI-D-75) and
 * "Adicionar stories" (UI-D-76). One `BottomSheet`, three bodies that swap inside it; focus moves to
 * each step's heading on the way in and back to the control that opened it on "Voltar".
 *
 * Presentational and props-only, the `HighlightSheet` posture: it ships no words (PWA-03) and makes
 * no request of its own. Every write is a host callback that resolves whether it landed, and the
 * upload tile and the picker's load-more node are the host's (they own `useSignedUpload` and the
 * keyset pager), so this file has zero media and zero paging code.
 *
 * **THE RULES THIS FILE OWNS — a reviewer must not "simplify" them away:**
 *
 * 1. **The NAME is the only control that does not write on its own.** Every other control is one
 *    immediate write; the name has an explicit "Salvar nome", enabled only by a trimmed, non-empty,
 *    CHANGED value, so a half-typed title never reaches members.
 * 2. **Removing a story has NO confirm** (UI-D-78): it is reversible and the story itself is
 *    untouched (R-D-F). It is optimistic, and a refusal puts the row back. Deleting the HIGHLIGHT is
 *    the one irreversible act, and the only one behind a `ConfirmDialog tone="danger"`.
 * 3. **"Adicionar stories" is the SAME toggle machine** as the viewer's "Destacar" and "Seus stories"
 *    (D-110): `HighlightMembershipList`, with story rows instead of highlight rows. A forked
 *    add/remove would drift on the revert or in-flight rule the first time either changed.
 * 4. **Only IMAGE stories are cover options** (D-101): a video story never becomes a circle in the
 *    cover step; a video-only highlight shows the upload tile and the "no images" note.
 * 5. **An archived community keeps only the take-downs** (UI-D-80, R-D-F): no cover, name, position
 *    or "Adicionar stories" — remove and delete stay, because the API allows exactly those.
 *
 * `items === null` is the edit read still in flight: skeleton rows at the 56px geometry, so the sheet
 * never shows an empty state for a highlight whose stories are simply not loaded yet.
 */

export interface HighlightEditCover {
  assetId: string;
  variantWidths: readonly number[];
}

/** The highlight as the sheet draws it. `position` is 1-based; `total` is the place's count. */
export interface HighlightEditHighlight {
  id: string;
  title: string;
  /** The server-resolved cover (R-D-D), or null for the monogram. */
  cover: HighlightEditCover | null;
  /** True when the cover is an explicit choice — only then is "Usar capa automática" offered. */
  coverChosen: boolean;
  position: number;
  total: number;
  archived: boolean;
}

/** One story of the highlight, oldest first by publish time (D-103), as the host composed it. */
export interface HighlightEditItem {
  id: string;
  thumb: { assetId: string | null; variantWidths: readonly number[] };
  mediaKind: 'image' | 'video';
  /** Server-formatted, short ("12 mar"). */
  dateLabel: string;
  /** Phase 3's media pill when the media is not `ready` (R-D-H: curators see every live item). */
  status?: { tone: 'warning' | 'danger'; label: string };
  /** The story the server currently resolves as the highlight's cover. */
  isCover: boolean;
}

export type HighlightEditStep = 'main' | 'cover' | 'picker';

export interface HighlightEditSheetLabels {
  title: string;
  cover: string;
  changeCover: string;
  name: string;
  saveName: string;
  savingName: string;
  counter: (count: number, limit: number) => string;
  /** `STORY_HIGHLIGHT_MAX_TITLE`, passed by the host from `contracts` — never typed here. */
  limit: number;
  position: (position: number, total: number) => string;
  moveUp: string;
  moveDown: string;
  stories: string;
  coverPill: string;
  /** "Remover do destaque o story de {date}". */
  remove: (item: HighlightEditItem) => string;
  addStories: string;
  delete: string;
  emptyTitle: string;
  emptyBody: string;
  archivedNote: string;
  back: string;
  coverTitle: string;
  /** "Usar o story de {date} como capa" — plus "Capa atual" for the current one. */
  coverOption: (item: HighlightEditItem) => string;
  auto: string;
  autoHelper: string;
  noImages: string;
  pickerTitle: string;
  pickerHelper: string;
  /** The picker switch's name — "Adicionar ao destaque o story de {date}". */
  pickerRow: (row: HighlightMembershipRow) => string;
  confirmDelete: { title: string; body: string; confirm: string; cancel: string };
}

export interface HighlightEditSheetProps {
  open: boolean;
  /**
   * Any identity works: `BottomSheet`'s focus trap reads it through a ref and arms once per
   * opening, so a new callback on every render no longer moves the focus.
   */
  onClose: () => void;
  highlight: HighlightEditHighlight;
  /** The highlight's stories; `null` while the edit read is in flight. */
  items: readonly HighlightEditItem[] | null;
  /** Receives the TRIMMED title. Resolves `false` to keep the typed value for a retry. */
  onRename: (title: string) => Promise<boolean>;
  /** The touch screen reader's reorder: one place up (-1) or down (1). */
  onMove: (delta: -1 | 1) => void;
  /** Optimistic: the row goes now and comes back on `false`. */
  onRemove: (storyId: string) => Promise<boolean>;
  /** A story frame, or `null` for automatic. A landed choice returns to the main step. */
  onCover: (cover: { storyId: string } | null) => Promise<boolean>;
  /** Resolves `true` when the highlight is gone; the host closes the sheet. */
  onDelete: () => Promise<boolean>;
  /** The host's `useSignedUpload` tile ("Enviar imagem" + progress) — first in the cover step. */
  uploadTile: ReactNode;
  /** The admin's story history as membership rows, newest first (UI-D-76). */
  pickerRows: readonly HighlightMembershipRow[];
  /** The ids of the stories already in this highlight; `null` while unknown (switches disabled). */
  pickerSelectedIds: readonly string[] | null;
  onPickerToggle: (storyId: string, next: boolean) => Promise<boolean>;
  /** The host's `InfiniteScroll` sentinel (and its skeleton rows). */
  pickerFooter?: ReactNode;
  /** Rendered instead of the rows when the history is known to be empty. */
  pickerEmpty?: ReactNode;
  /** Tells the host which body is showing (it loads the picker on entry and refreshes on return). */
  onStepChange?: (step: HighlightEditStep) => void;
  labels: HighlightEditSheetLabels;
}

/** The 64px preview / option disc: the cover, else the monogram. The ring is always neutral. */
function CoverDisc({ cover, title }: { cover: HighlightEditCover | null; title: string }) {
  return (
    <span className="block shrink-0 rounded-full border-2 border-border p-0.5">
      {cover === null ? (
        <StoryMonogram text={title} size={64} />
      ) : (
        <span className="block h-16 w-16 overflow-hidden rounded-full bg-bg-tertiary">
          <MediaImage
            assetId={cover.assetId}
            widths={cover.variantWidths}
            alt=""
            sizes="64px"
            ratio=""
            className="h-full w-full"
          />
        </span>
      )}
    </span>
  );
}

/** The 32×48 story thumb of a row (UI-D-74, UI-D-76). */
export function HighlightStoryThumb({
  thumb,
}: {
  thumb: { assetId: string | null; variantWidths: readonly number[] };
}) {
  if (thumb.assetId === null) {
    return <span aria-hidden className="block h-12 w-8 shrink-0 rounded-md bg-bg-tertiary" />;
  }
  return (
    <span className="block h-12 w-8 shrink-0 overflow-hidden rounded-md bg-bg-tertiary">
      <MediaImage
        assetId={thumb.assetId}
        widths={thumb.variantWidths}
        alt=""
        sizes="32px"
        ratio=""
        className="h-full w-full"
      />
    </span>
  );
}

/** A body step's header: the ghost "Voltar" and the step's own heading, which takes focus. */
function StepHeader({
  back,
  heading,
  onBack,
}: {
  back: string;
  heading: string;
  onBack: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="-ml-2 text-text-secondary"
        >
          <ChevronLeft aria-hidden size={20} />
          {back}
        </Button>
      </div>
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="text-base font-bold text-text focus:outline-none"
      >
        {heading}
      </h3>
    </div>
  );
}

export function HighlightEditSheet({
  open,
  onClose,
  highlight,
  items,
  onRename,
  onMove,
  onRemove,
  onCover,
  onDelete,
  uploadTile,
  pickerRows,
  pickerSelectedIds,
  onPickerToggle,
  pickerFooter,
  pickerEmpty,
  onStepChange,
  labels,
}: HighlightEditSheetProps) {
  const nameId = useId();
  const [step, setStepState] = useState<HighlightEditStep>('main');
  const [confirming, setConfirming] = useState(false);
  /** The main-step control focus returns to after "Voltar". */
  const returnTo = useRef<'cover' | 'picker' | null>(null);
  /** Wrappers of the two openers: `Button` does not forward a ref, so focus goes through these. */
  const changeCoverRef = useRef<HTMLDivElement>(null);
  const addStoriesRef = useRef<HTMLDivElement>(null);

  const setStep = (next: HighlightEditStep) => {
    setStepState(next);
    onStepChange?.(next);
  };

  // Another highlight, or a closed sheet, always starts on the main step with the stored title.
  const [target, setTarget] = useState({ id: highlight.id, open });
  const [name, setName] = useState(highlight.title);
  const [savedTitle, setSavedTitle] = useState(highlight.title);
  if (target.id !== highlight.id || target.open !== open) {
    setTarget({ id: highlight.id, open });
    setStepState('main');
    setName(highlight.title);
    setSavedTitle(highlight.title);
  } else if (savedTitle !== highlight.title) {
    // The host confirmed a rename (or another tab did): the field follows the stored title.
    setSavedTitle(highlight.title);
    setName(highlight.title);
  }

  // An uploaded cover landing while the cover step is open returns to the main step, exactly like a
  // chosen story frame does — the admin sees the new cover in the preview.
  const coverKey = `${highlight.coverChosen}:${highlight.cover?.assetId ?? ''}`;
  const [seenCover, setSeenCover] = useState(coverKey);
  if (seenCover !== coverKey) {
    setSeenCover(coverKey);
    if (step === 'cover') {
      returnTo.current = 'cover';
      setStepState('main');
    }
  }

  // Optimistic removals, reset whenever the host hands a fresh read.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [itemsSeed, setItemsSeed] = useState(items);
  if (itemsSeed !== items) {
    setItemsSeed(items);
    setRemoved(new Set());
  }

  const [savingName, setSavingName] = useState(false);
  const renaming = useRef(false);

  useEffect(() => {
    if (step !== 'main' || returnTo.current === null) return;
    const wrapper = returnTo.current === 'cover' ? changeCoverRef.current : addStoriesRef.current;
    returnTo.current = null;
    wrapper?.querySelector('button')?.focus({ preventScroll: true });
  }, [step]);

  const back = (from: 'cover' | 'picker') => {
    returnTo.current = from;
    setStep('main');
  };

  const trimmed = name.trim();
  const canSave = trimmed !== '' && trimmed !== highlight.title && !savingName;

  async function saveName() {
    if (!canSave || renaming.current) return;
    renaming.current = true;
    setSavingName(true);
    try {
      await onRename(trimmed);
    } catch {
      // The host owns the failure toast; the typed name simply stays for a retry.
    } finally {
      renaming.current = false;
      setSavingName(false);
    }
  }

  /**
   * 08-02 (WINDOWS #70): the removal is optimistic, so the tapped "Remover" control unmounts in the
   * same render and the browser drops focus to `<body>`. The sheet's focus trap listens for Escape on
   * its panel only, so until the host's follow-up re-read happened to re-arm the trap (one server
   * round trip later) Escape did nothing. Focus stays inside the sheet instead: on "Adicionar
   * stories", or the panel itself when that control is absent. A layout effect, so it lands before
   * the next paint and before any key can reach `<body>`.
   */
  const keepFocusInSheet = useRef(false);
  /** The main step's root — its dialog ancestor is the fallback focus target. */
  const mainRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!keepFocusInSheet.current || removed.size === 0) return;
    keepFocusInSheet.current = false;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const target =
      addStoriesRef.current?.querySelector('button') ??
      mainRef.current?.closest<HTMLElement>('[role="dialog"]');
    target?.focus({ preventScroll: true });
  }, [removed]);

  const remove = (storyId: string) => {
    keepFocusInSheet.current = true;
    setRemoved((current) => new Set(current).add(storyId));
    const restore = () =>
      setRemoved((current) => {
        const next = new Set(current);
        next.delete(storyId);
        return next;
      });
    void onRemove(storyId)
      .then((ok) => {
        if (!ok) restore();
      })
      .catch(restore);
  };

  const chooseCover = (cover: { storyId: string } | null) => {
    void onCover(cover)
      .then((ok) => {
        if (ok) back('cover');
      })
      .catch(() => {});
  };

  const visible = items === null ? null : items.filter((item) => !removed.has(item.id));
  const imageItems = (items ?? []).filter((item) => item.mediaKind === 'image');
  const { archived } = highlight;

  const main = (
    <div ref={mainRef} className="flex flex-col gap-6">
      {archived ? (
        <p className="text-sm font-normal text-text-secondary">{labels.archivedNote}</p>
      ) : (
        <>
          {/* (1) Cover */}
          <section className="flex items-center gap-4">
            <CoverDisc cover={highlight.cover} title={highlight.title} />
            <div className="flex min-w-0 flex-col gap-2">
              <p className="text-xs font-bold text-text-tertiary">{labels.cover}</p>
              <div ref={changeCoverRef}>
                <Button type="button" variant="outline" size="md" onClick={() => setStep('cover')}>
                  {labels.changeCover}
                </Button>
              </div>
            </div>
          </section>

          {/* (2) Name — the one control with an explicit save (rule 1). */}
          <form
            noValidate
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <div className="flex flex-col gap-1">
              <Input
                id={nameId}
                label={labels.name}
                value={name}
                maxLength={labels.limit}
                autoComplete="off"
                enterKeyHint="done"
                onChange={(event) => setName(event.target.value.slice(0, labels.limit))}
              />
              <div className="flex h-4 justify-end">
                <span className="text-xs font-normal tabular-nums text-text-tertiary">
                  {labels.counter(name.length, labels.limit)}
                </span>
              </div>
            </div>
            <div>
              <Button
                type="submit"
                variant="brand"
                size="md"
                loading={savingName}
                disabled={!canSave}
              >
                {savingName ? labels.savingName : labels.saveName}
              </Button>
            </div>
          </form>

          {/* (3) Position — the touch screen reader's reorder (UI-D-73). */}
          <section className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-sm font-normal text-text">
              {labels.position(highlight.position, highlight.total)}
            </p>
            <IconButton
              icon={ChevronUp}
              label={labels.moveUp}
              size={20}
              disabled={highlight.position <= 1}
              onClick={() => onMove(-1)}
              className="shrink-0"
            />
            <IconButton
              icon={ChevronDown}
              label={labels.moveDown}
              size={20}
              disabled={highlight.position >= highlight.total}
              onClick={() => onMove(1)}
              className="shrink-0"
            />
          </section>
        </>
      )}

      {/* (4) Stories */}
      <section className="flex flex-col gap-2">
        <p className="text-xs font-bold text-text-tertiary">{labels.stories}</p>
        {visible === null ? (
          <ul className="flex flex-col">
            {[0, 1, 2].map((key) => (
              <li key={key} className="flex min-h-14 items-center gap-3">
                <Skeleton className="h-12 w-8 shrink-0 rounded-md" />
                <Skeleton className="h-4 flex-1" />
              </li>
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <EmptyState
            variant="plain"
            icon={Bookmark}
            title={labels.emptyTitle}
            body={labels.emptyBody}
            action={
              archived ? undefined : (
                <div ref={addStoriesRef}>
                  <Button type="button" variant="brand" size="md" onClick={() => setStep('picker')}>
                    <Plus aria-hidden size={16} />
                    {labels.addStories}
                  </Button>
                </div>
              )
            }
          />
        ) : (
          <>
            <ul className="flex flex-col">
              {visible.map((item) => (
                <li key={item.id} className="flex min-h-14 items-center gap-3 py-1">
                  <HighlightStoryThumb thumb={item.thumb} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm font-normal text-text">{item.dateLabel}</span>
                    {item.status || item.isCover ? (
                      <span className="flex min-w-0 items-center gap-1 truncate">
                        {item.status ? (
                          <StatusPill tone={item.status.tone}>{item.status.label}</StatusPill>
                        ) : null}
                        {item.isCover ? (
                          <StatusPill tone="neutral">{labels.coverPill}</StatusPill>
                        ) : null}
                      </span>
                    ) : null}
                  </span>
                  <IconButton
                    icon={X}
                    label={labels.remove(item)}
                    size={20}
                    onClick={() => remove(item.id)}
                    className="shrink-0"
                  />
                </li>
              ))}
            </ul>
            {archived ? null : (
              <div ref={addStoriesRef}>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  fullWidth
                  onClick={() => setStep('picker')}
                >
                  <Plus aria-hidden size={16} />
                  {labels.addStories}
                </Button>
              </div>
            )}
          </>
        )}
      </section>

      {/* (5) Delete — the one irreversible act, behind a confirm (rule 2). */}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => setConfirming(true)}
          className="-ml-2 text-danger"
        >
          <Trash2 aria-hidden size={18} />
          {labels.delete}
        </Button>
      </div>
    </div>
  );

  const coverStep = (
    <div className="flex flex-col gap-4">
      <StepHeader back={labels.back} heading={labels.coverTitle} onBack={() => back('cover')} />
      <div className="flex flex-wrap gap-4">
        {uploadTile}
        {imageItems.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-label={labels.coverOption(item)}
            onClick={() => chooseCover({ storyId: item.id })}
            className="relative block shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <CoverDisc
              cover={item.thumb.assetId === null ? null : (item.thumb as HighlightEditCover)}
              title={highlight.title}
            />
            {item.isCover ? (
              <span
                aria-hidden
                className="absolute right-0 bottom-0 grid h-6 w-6 place-items-center rounded-full bg-brand text-on-brand"
              >
                <Check size={16} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {imageItems.length === 0 ? (
        <p className="text-sm font-normal text-text-secondary">{labels.noImages}</p>
      ) : null}
      {highlight.coverChosen ? (
        <div className="flex flex-col gap-1">
          <div>
            <Button type="button" variant="ghost" size="md" onClick={() => chooseCover(null)}>
              {labels.auto}
            </Button>
          </div>
          <p className="text-xs font-normal text-text-tertiary">{labels.autoHelper}</p>
        </div>
      ) : null}
    </div>
  );

  const pickerStep = (
    <div className="flex flex-col gap-2">
      <StepHeader back={labels.back} heading={labels.pickerTitle} onBack={() => back('picker')} />
      <p className="text-xs font-normal text-text-tertiary">{labels.pickerHelper}</p>
      {pickerRows.length === 0 && pickerEmpty ? (
        pickerEmpty
      ) : (
        <HighlightMembershipList
          rows={pickerRows}
          selectedIds={pickerSelectedIds}
          onToggle={onPickerToggle}
          rowLabel={labels.pickerRow}
        />
      )}
      {pickerFooter}
    </div>
  );

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title={labels.title}>
        {step === 'cover' && !archived
          ? coverStep
          : step === 'picker' && !archived
            ? pickerStep
            : main}
      </BottomSheet>
      <ConfirmDialog
        open={open && confirming}
        tone="danger"
        icon={Trash2}
        title={labels.confirmDelete.title}
        body={labels.confirmDelete.body}
        confirmLabel={labels.confirmDelete.confirm}
        cancelLabel={labels.confirmDelete.cancel}
        onConfirm={async () => {
          await onDelete();
        }}
        onError={() => {}}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
