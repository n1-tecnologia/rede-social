'use client';

import { MediaImage } from '@rede-social/core/ui';
import { useFocusTrap } from '@rede-social/ui';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useEffect, useRef } from 'react';

/**
 * The event's photo viewer (2026-10-03, the REINE prototype's lightbox): one photo at a time over
 * black, the counter ("3 de 12") and the close button at the top, previous / next at the sides.
 * There is no lightbox elsewhere in the codebase to reuse; this is the story viewer's frame (the
 * `z-[52]` rung, `data-shell-hide="chrome"`, the safe-area offsets) without its clock.
 *
 * - **A modal dialog.** `role="dialog"` + `aria-modal`, named by the host ("Fotos do evento …"),
 *   with the SAME focus contract every overlay of the app uses (`useFocusTrap`): focus moves in,
 *   Tab cycles inside, Escape closes, and focus returns to the tile that opened it.
 * - **Three ways to move**, all through `onIndexChange`: the two buttons, the arrow keys, and a
 *   horizontal swipe of at least `SWIPE_THRESHOLD_PX` that is more horizontal than vertical. The
 *   ends are hard stops (no wrap), except that at the last LOADED photo, while the host has more
 *   (`hasMore`), "next" asks it for them (`onEndReached`).
 * - **The photo is never cropped** (`fit="contain"`): `sizes="100vw"`, so the browser picks the
 *   ladder rung for the screen, and the box is keyed by photo, so a failure never sticks to the
 *   next one.
 * - **Rendered inline, never portaled** (the overlay rule of `ProfileNudgeDialog`: the tenant's
 *   `--brand-*` and the shell-hide `:has()` rules live on `[data-brand-root]`), so it sits inside
 *   whatever the host is in, a `PullToRefresh` included. Two things keep the page out of it: the
 *   root takes no browser panning (`touch-action: none`, the story viewer's choice), so a vertical
 *   drag never scrolls the page behind; and its touches stop at its root (native listeners, which
 *   run before an ancestor's), so a drag on a photo is never a pull-to-refresh. Its own gestures
 *   are pointer events and clicks, which a stopped TOUCH event leaves alone.
 *
 * Presentational and props-only: it fetches nothing and **ships no words** (PWA-03). The counter
 * arrives finished (the host formats it) and is announced politely as it changes.
 */
export interface EventPhotoViewerItem {
  id: string;
  assetId: string;
  variantWidths: readonly number[];
  /** The photo's alternative text, composed by the host ("Foto 3 do evento …"). */
  alt: string;
}

export interface EventPhotoViewerLabels {
  /** The dialog's accessible name. */
  dialog: string;
  close: string;
  previous: string;
  next: string;
  /** The finished counter for the CURRENT photo ("3 de 12"). */
  counter: string;
}

export interface EventPhotoViewerProps {
  photos: readonly EventPhotoViewerItem[];
  index: number;
  labels: EventPhotoViewerLabels;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /** More photos exist after the last one loaded: "next" stays live there and asks the host. */
  hasMore?: boolean;
  onEndReached?: () => void;
}

/** A drag shorter than this is a tap, never a page turn. */
export const SWIPE_THRESHOLD_PX = 50;

/** The round side buttons, 44px, on a translucent ground that reads over any photo. */
const SIDE_BUTTON =
  'absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/40 text-white transition-colors hover:bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:pointer-events-none disabled:opacity-0';

export function EventPhotoViewer({
  photos,
  index,
  labels,
  onIndexChange,
  onClose,
  hasMore = false,
  onEndReached,
}: EventPhotoViewerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  useFocusTrap(ref, true, onClose);

  // A host's pull-to-refresh listens for touches on an ANCESTOR, natively: a touch inside the
  // viewer stops here, before it gets there (see the docblock).
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const stop = (event: TouchEvent) => event.stopPropagation();
    const types = ['touchstart', 'touchmove', 'touchend'] as const;
    for (const type of types) root.addEventListener(type, stop, { passive: true });
    return () => {
      for (const type of types) root.removeEventListener(type, stop);
    };
  }, []);

  const photo = photos[index];
  const atEnd = index >= photos.length - 1;
  const canPrevious = index > 0;
  const canNext = !atEnd || (hasMore && onEndReached !== undefined);

  const previous = () => {
    if (canPrevious) onIndexChange(index - 1);
  };
  const next = () => {
    if (!atEnd) onIndexChange(index + 1);
    else if (hasMore) onEndReached?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      previous();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      next();
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    swipe.current = { x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from) return;
    const dx = event.clientX - from.x;
    const dy = event.clientY - from.y;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) next();
    else previous();
  };

  if (!photo) return null;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      tabIndex={-1}
      // The shell hides its TopBar and BottomNav while this is mounted (the story viewer's
      // declaration): neither may sit over the counter or the close button.
      data-shell-hide="chrome"
      data-testid="event-photo-viewer"
      data-index={index}
      onKeyDown={onKeyDown}
      className="fixed inset-0 z-[52] bg-black text-white outline-none select-none"
      style={{ touchAction: 'none' }}
    >
      <div
        data-testid="event-photo-stage"
        className="absolute inset-0 flex items-center justify-center"
        style={{
          paddingTop: 'calc(var(--safe-top) + 4rem)',
          paddingBottom: 'calc(var(--safe-bottom) + 4rem)',
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        <MediaImage
          key={photo.id}
          assetId={photo.assetId}
          widths={photo.variantWidths}
          alt={photo.alt}
          sizes="100vw"
          eager
          fit="contain"
          ratio=""
          className="h-full w-full bg-transparent"
        />
      </div>

      <div
        className="absolute right-0 left-0 flex items-center justify-between gap-3 px-4"
        style={{ top: 'calc(var(--safe-top) + 0.75rem)' }}
      >
        <p
          aria-live="polite"
          data-testid="event-photo-counter"
          className="min-w-0 truncate text-sm font-bold tabular-nums"
        >
          {labels.counter}
        </p>
        <button
          type="button"
          aria-label={labels.close}
          data-testid="event-photo-close"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X aria-hidden size={22} />
        </button>
      </div>

      <button
        type="button"
        aria-label={labels.previous}
        data-testid="event-photo-previous"
        disabled={!canPrevious}
        onClick={previous}
        className={`${SIDE_BUTTON} left-2`}
      >
        <ChevronLeft aria-hidden size={24} />
      </button>
      <button
        type="button"
        aria-label={labels.next}
        data-testid="event-photo-next"
        disabled={!canNext}
        onClick={next}
        className={`${SIDE_BUTTON} right-2`}
      >
        <ChevronRight aria-hidden size={24} />
      </button>
    </div>
  );
}
