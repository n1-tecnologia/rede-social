'use client';

import { DoubleTapHeart, IconButton, useMediaQuery } from '@rede-social/ui';
import { ChevronDown, ChevronUp, Loader2, Pause, Play } from 'lucide-react';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  REELS_MOUNT_RADIUS,
  REELS_RUBBER_BAND,
  REELS_SWIPE_THRESHOLD_PX,
  REELS_TAP_SLOP_PX,
  REELS_WHEEL_LOCK_MS,
  REELS_WHEEL_THRESHOLD_PX,
} from '../contracts/index';
import { ticksWindow } from './ticks';

/**
 * The Reels pager (REELS-05, UI-D-82, UI-D-86, UI-D-89, UI-D-95, UI-D-97) — the one gesture surface
 * of this phase that has no shipped owner (05.3 RESEARCH "Don't Hand-Roll").
 *
 * **An INDEX pager, not a scroller.** One absolutely positioned page per loaded post at
 * `top: k * 100%`; the whole stack moves by `translateY(calc(-index * 100% + drag))` and settles
 * with the prototype's 0.42 s curve. There is no scroll snapping and no native scroll: the index is
 * the truth, and it is the HOST's — this component holds nothing but the drag in flight.
 *
 * **The prototype's grammar, with the three fixes RESEARCH Pattern 6 found:**
 *
 * 1. The dominant axis decides at `REELS_SWIPE_THRESHOLD_PX`: vertical pages (up = next), horizontal
 *    steps the lane through `onLaneStep` (left = next), and one gesture never does both (D-117).
 *    Only a vertical drag follows the finger (the rubber band); a horizontal drag acts on release.
 * 2. `pointercancel` RESETS the drag and decides nothing. The prototype mapped cancel to up, so an
 *    OS-cancelled gesture (an edge swipe, a scroll takeover) could still change the video.
 * 3. The pager listens WITHOUT pointer capture. With capture, `pointerup` would be retargeted to the
 *    stack and the current page's `DoubleTapHeart` would never see it — no single tap, no double
 *    tap. The release and the cancel are instead heard in React's CAPTURE PHASE on the stack
 *    (`onPointerUpCapture`, `onPointerCancelCapture`, WR-01): a mouse has no implicit capture, so a
 *    drag that began on the media and is released over the rail or the caption (layers that stop
 *    the bubbling `pointerup`) still ends here and is decided by the dominant axis, instead of
 *    leaving the track following a mouse with no button held. The capture phase is not DOM pointer
 *    capture: the event still continues to its target, so `DoubleTapHeart` still sees every
 *    `pointerup`. `origin` is only set by a `pointerdown` that reached the stack (one that began on
 *    the media), so a press that began on the rail, the caption or the like button is unaffected.
 *    The gesture belongs to the PRIMARY pointer that started it (`origin.pointerId`): a
 *    non-primary pointerdown never starts or takes over a gesture, and every other pointer's move,
 *    release and cancel is ignored (WR-05), so a second finger tapping the rail or the caption never
 *    decides, cancels or steers the first finger's drag.
 *
 * **The WebKit rule (RESEARCH Pitfall 1).** Every index change — swipe, ↑/↓ key, wheel, desktop
 * button — runs through ONE `go(next)`, which calls `onActivate(next)` SYNCHRONOUSLY inside that
 * event handler and only then `onIndexChange(next)`. The host starts the next (already mounted)
 * video in `onActivate`, so a sound-on `play()` still runs inside the user's gesture; a `play()` in
 * an effect after the state change would be one task too late on iOS.
 *
 * **D-125: it never advances on its own.** There is no timer, media-end listener or idle path that
 * moves the index. The wheel lock below is a timestamp, not a scheduled move.
 *
 * **The tap surface (UI-D-86).** Each mounted page's media layer is wrapped in `DoubleTapHeart`
 * with `tapSlopPx`; on the CURRENT page it also gets `onDoubleTap` and `onSingleTap`, so a single
 * tap pauses once the shipped 300 ms window closes, a double tap likes and never pauses, and a
 * swipe is neither. The wrapper is rendered for neighbours too (inert, no handlers) so a page that
 * becomes current keeps its mounted video element instead of remounting it. The overlay (rail,
 * caption) and the `top` row (lanes, sound) sit in layers that stop pointer propagation, and the
 * badge, spinner and desktop buttons live outside the stack, so a tap on any of them never pauses.
 *
 * **Desktop (UI-D-95, D-132).** From `md` the pages sit in a centred 9:16 column with ↑/↓ buttons
 * 24 px outside its right edge. The column takes the stage's FULL height with square corners
 * (2026-10-09: the 24 px black margins above and below it are gone), and its 9:16 width is capped
 * by the room the buttons leave; ↑/↓ keys, Space and M act on the window unless a sheet is open
 * (`gesturesDisabled`) or focus is in a field, and Space is left to a focused button or link. The
 * wheel is a NATIVE non-passive listener (React's root wheel listener is passive, so its
 * `preventDefault` would be ignored): it accumulates to `REELS_WHEEL_THRESHOLD_PX`, moves exactly
 * one video and locks for `REELS_WHEEL_LOCK_MS`, so one inertial trackpad fling is one video.
 *
 * **It ships no words (PWA-03) and imports no other module (MOD-02).** Every string is a label; the
 * media, the overlay and the top row are built by the host in `apps/web`.
 */

/** What the pager needs to know about a post: its identity and the name the live region reads. */
export interface ReelsPagerItem {
  id: string;
  authorName: string;
}

export interface ReelsPagerLabels {
  /** "Reproduzir vídeo" — the play badge and the paused state of the page's pause control. */
  play: string;
  /** "Pausar vídeo" — the page's pause control while playing. */
  pause: string;
  /** "Vídeo anterior" — the desktop ↑ button. */
  previous: string;
  /** "Próximo vídeo" — the desktop ↓ button. */
  next: string;
  /** The RAW template "Vídeo {current}, de {author}", filled here for the live region. */
  position: string;
}

export interface ReelsPagerProps {
  /** The active lane's loaded posts, newest first; one page per item. */
  items: readonly ReelsPagerItem[];
  /** The host-owned current page. */
  index: number;
  /** More pages exist behind the keyset cursor: ↓ at the last loaded page asks for them. */
  hasMore: boolean;
  /** Called FIRST, synchronously inside the gesture, with the page about to become current. */
  onActivate: (next: number) => void;
  /** Called right after `onActivate`, in the same handler: the host moves `index`. */
  onIndexChange: (next: number) => void;
  /** An upward move at the last loaded page while `hasMore` (the rubber band plays; nothing moves). */
  onEndReached: () => void;
  /** A horizontal swipe; omitted when there is one lane (D-120), and the swipe then does nothing. */
  onLaneStep?: (delta: 1 | -1) => void;
  /** The page's video; called only for pages within `REELS_MOUNT_RADIUS` of `index`. */
  renderMedia: (item: ReelsPagerItem, state: { current: boolean }) => ReactNode;
  /** The page's rail and caption; rendered for mounted pages, in a layer that stops pointers. */
  renderOverlay: (item: ReelsPagerItem, state: { current: boolean }) => ReactNode;
  /** The lane row and the sound button, above the stack, in a layer that stops pointers. */
  top: ReactNode;
  /** The viewer's pause state: names the page's pause control. */
  paused: boolean;
  /** "Not playing, tap to play" — paused or autoplay-blocked (UI-D-86). */
  showPlayBadge: boolean;
  /** Buffering past the host's delay (UI-D-92). */
  showSpinner: boolean;
  onTogglePause: () => void;
  /** The host decides like-only (D-128); the pager only guarantees it never also pauses. */
  onDoubleTap: () => void;
  onToggleSound: () => void;
  /** A sheet is open: gestures, keys and the wheel do nothing (UI-D-90). */
  gesturesDisabled: boolean;
  /** Changes on a lane change: the next frame jumps without the slide transition. */
  instantKey: string;
  /** The lane tab panel's id (each tab's `aria-controls`). */
  panelId?: string;
  /** The active tab's id. */
  labelledBy?: string;
  labels: ReelsPagerLabels;
}

/** The prototype's settle, collapsed to an instant swap under reduced motion. */
const PAGER_TRANSITION = 'transform 0.42s cubic-bezier(0.2, 0.715, 0.205, 0.99)';
/** The prototype's two-stop veil (UI-D-82), the one the story viewer ships (UI-D-33). */
const VEIL =
  'linear-gradient(180deg, rgba(0,0,0,0.5), transparent 22%, transparent 52%, rgba(0,0,0,0.72))';
/** Line and page wheel deltas (`deltaMode` 1 and 2) in CSS pixels. */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 800;
/** The white focus ring every control over video carries (UI-D-97). */
const RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white';

type Drag = { active: boolean; dx: number; dy: number };
const IDLE: Drag = { active: false, dx: 0, dy: 0 };

/** A layer whose descendants' pointers must never reach the stack's gestures or the tap surface. */
function stopPointer(event: ReactPointerEvent) {
  event.stopPropagation();
}
const STOP_POINTER = {
  onPointerDown: stopPointer,
  onPointerMove: stopPointer,
  onPointerUp: stopPointer,
  onPointerCancel: stopPointer,
};

/** Focus is where the viewer types: every key belongs to the field. */
function inField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.closest('input, textarea, select, [contenteditable]') !== null;
}

/** Focus is on a control whose own activation key Space (or Enter) is. */
function onControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest('button, a[href], [role="button"], [role="tab"], summary') !== null;
}

/**
 * A wheel over something that can still scroll in that direction (the expanded caption) scrolls it
 * natively and never pages the video.
 */
function scrollsNatively(target: EventTarget | null, deltaY: number, root: HTMLElement): boolean {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== root) {
    if (node.scrollHeight > node.clientHeight) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') {
        const room =
          deltaY > 0 ? node.scrollTop + node.clientHeight < node.scrollHeight : node.scrollTop > 0;
        if (room) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

export function ReelsPager({
  items,
  index,
  hasMore,
  onActivate,
  onIndexChange,
  onEndReached,
  onLaneStep,
  renderMedia,
  renderOverlay,
  top,
  paused,
  showPlayBadge,
  showSpinner,
  onTogglePause,
  onDoubleTap,
  onToggleSound,
  gesturesDisabled,
  instantKey,
  panelId,
  labelledBy,
  labels,
}: ReelsPagerProps) {
  const [drag, setDrag] = useState<Drag>(IDLE);
  const origin = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const wheel = useRef({ acc: 0, lockedUntil: 0 });
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  /**
   * The ONE navigation every input shares: nothing before the first page, `onEndReached` past the
   * last loaded page while more exist, nothing at the true end — and otherwise `onActivate` then
   * `onIndexChange`, synchronously, in the caller's event handler.
   */
  const go = (next: number) => {
    if (next < 0) return;
    if (next > items.length - 1) {
      if (hasMore && next === items.length) onEndReached();
      return;
    }
    if (next === index) return;
    onActivate(next);
    onIndexChange(next);
  };

  /** The window listeners read the latest render through this ref instead of re-registering. */
  const latest = useRef({ go, index, gesturesDisabled, onTogglePause, onToggleSound });
  latest.current = { go, index, gesturesDisabled, onTogglePause, onToggleSound };

  /* ── One frame without the slide after a lane change (UI-D-84) ───────────────────────────────── */

  const [settledKey, setSettledKey] = useState(instantKey);
  const instant = settledKey !== instantKey;
  useEffect(() => {
    if (!instant) return;
    // Two frames: the first paints the jump with the transition off, the second restores it, so
    // the stack never animates through N pages back to the top of the new lane.
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setSettledKey(instantKey));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [instant, instantKey]);

  /* ── Keyboard (D-132, UI-D-95) ───────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const state = latest.current;
      if (state.gesturesDisabled || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (inField(event.target)) return;
      switch (event.key) {
        case 'ArrowDown':
        case 'ArrowUp': {
          event.preventDefault();
          // A held key auto-repeats many times a second: one press is one video (T-05.3-13).
          if (event.repeat) return;
          state.go(state.index + (event.key === 'ArrowDown' ? 1 : -1));
          return;
        }
        case ' ':
        case 'Spacebar': {
          // Space is also the activation key: on a focused control it belongs to that control.
          if (onControl(event.target)) return;
          event.preventDefault();
          state.onTogglePause();
          return;
        }
        case 'm':
        case 'M': {
          state.onToggleSound();
          return;
        }
        default:
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /* ── The locked wheel (D-132, UI-D-95) ───────────────────────────────────────────────────────── */

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      const state = latest.current;
      if (state.gesturesDisabled) return;
      const deltaY =
        event.deltaMode === 1
          ? event.deltaY * WHEEL_LINE_PX
          : event.deltaMode === 2
            ? event.deltaY * WHEEL_PAGE_PX
            : event.deltaY;
      if (deltaY === 0 || scrollsNatively(event.target, deltaY, root)) return;
      event.preventDefault();
      const now = Date.now();
      if (now < wheel.current.lockedUntil) {
        // inertia inside the lock is swallowed, and never carried over into the next move
        wheel.current.acc = 0;
        return;
      }
      wheel.current.acc += deltaY;
      if (Math.abs(wheel.current.acc) < REELS_WHEEL_THRESHOLD_PX) return;
      const direction = wheel.current.acc > 0 ? 1 : -1;
      wheel.current = { acc: 0, lockedUntil: now + REELS_WHEEL_LOCK_MS };
      state.go(state.index + direction);
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  /* ── Pointer gestures (UI-D-82, D-117) ───────────────────────────────────────────────────────── */

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (gesturesDisabled) return;
    // WR-05: a second finger never starts or takes over a gesture.
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // A PRIMARY pointerdown always (re)starts the gesture: a new primary pointer exists only when no
    // other pointer of its type is active, so an origin still held here is stale (its release never
    // reached the stack) and overwriting it self-heals instead of locking the pager.
    origin.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    setDrag({ active: true, dx: 0, dy: 0 });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (!start || event.pointerId !== start.pointerId) return;
    setDrag({ active: true, dx: event.clientX - start.x, dy: event.clientY - start.y });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    // Another pointer's release is not this gesture's end (WR-05): keep the drag, re-render nothing.
    if (!start || event.pointerId !== start.pointerId) return;
    origin.current = null;
    setDrag(IDLE);
    if (gesturesDisabled) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // The DOMINANT axis decides, so one gesture never both pages and steps the lane (D-117).
    if (Math.abs(dy) > Math.abs(dx)) {
      if (dy <= -REELS_SWIPE_THRESHOLD_PX) go(index + 1);
      else if (dy >= REELS_SWIPE_THRESHOLD_PX) go(index - 1);
      return;
    }
    if (dx <= -REELS_SWIPE_THRESHOLD_PX) onLaneStep?.(1);
    else if (dx >= REELS_SWIPE_THRESHOLD_PX) onLaneStep?.(-1);
  };

  /**
   * A cancelled gesture resets and decides NOTHING (the prototype's cancel-as-up is fixed here).
   * Another pointer's cancel leaves this gesture running (WR-05).
   */
  const onPointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (start && event.pointerId !== start.pointerId) return;
    origin.current = null;
    setDrag(IDLE);
  };

  /** A mouse released outside the stack never reports its pointerup here: treat the exit as a cancel. */
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = origin.current;
    if (start && event.pointerType === 'mouse' && event.pointerId === start.pointerId) {
      onPointerCancel(event);
    }
  };

  /* ── Render ──────────────────────────────────────────────────────────────────────────────────── */

  const followsFinger = drag.active && Math.abs(drag.dy) > Math.abs(drag.dx);
  const offset = followsFinger ? drag.dy * REELS_RUBBER_BAND : 0;
  const transition = drag.active || reduceMotion || instant ? 'none' : PAGER_TRANSITION;

  const current = items[index];
  // Function replacements, so a `$` pattern in a display name is announced literally (WR-03).
  const position = current
    ? labels.position
        .replace('{current}', () => String(index + 1))
        .replace('{author}', () => current.authorName)
    : '';
  const ticks = ticksWindow(index, items.length, hasMore);
  const atStart = index <= 0;
  const atTrueEnd = index >= items.length - 1 && !hasMore;
  // With a lane row the stack is the active tab's panel (UI-D-97); with one lane it is no panel.
  const panelProps =
    panelId !== undefined || labelledBy !== undefined
      ? ({ role: 'tabpanel', id: panelId, 'aria-labelledby': labelledBy } as const)
      : {};

  return (
    <div
      ref={rootRef}
      data-testid="reels-pager"
      className="absolute inset-0 md:flex md:justify-center"
    >
      {/* The column box: full-bleed on mobile, the centred 9:16 column from md (UI-D-95), the
          full height of the stage with square corners (2026-10-09: no black margins). */}
      <div
        data-testid="reels-column"
        className="relative h-full w-full md:aspect-[9/16] md:h-[var(--screen-h)] md:w-auto md:max-w-[calc(100%-160px)]"
      >
        <div data-testid="reels-clip" className="absolute inset-0 overflow-hidden bg-black">
          <div
            data-testid="reels-stack"
            {...panelProps}
            className="absolute inset-0 cursor-grab select-none active:cursor-grabbing"
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUpCapture={onPointerUp}
            onPointerCancelCapture={onPointerCancel}
            onPointerLeave={onPointerLeave}
          >
            <div
              data-testid="reels-track"
              className="absolute inset-0"
              style={{
                transform: `translateY(calc(${-index * 100}% + ${offset}px))`,
                transition,
              }}
            >
              {items.map((item, k) => {
                const isCurrent = k === index;
                const mounted = Math.abs(k - index) <= REELS_MOUNT_RADIUS;
                return (
                  <div
                    key={item.id}
                    data-reel-page={k}
                    inert={isCurrent ? undefined : true}
                    aria-hidden={isCurrent ? undefined : true}
                    className="absolute inset-x-0 h-full overflow-hidden bg-black"
                    style={{ top: `${k * 100}%` }}
                  >
                    {mounted ? (
                      <>
                        {/* WCAG 2.2.2: pause without a gesture. The first focusable in the page;
                            visible as the centre badge only while it has focus. */}
                        {isCurrent ? (
                          <button
                            type="button"
                            aria-label={paused ? labels.play : labels.pause}
                            onClick={onTogglePause}
                            className={`sr-only focus:not-sr-only focus:absolute focus:top-1/2 focus:left-1/2 focus:z-[4] focus:grid focus:h-14 focus:w-14 focus:-translate-x-1/2 focus:-translate-y-1/2 focus:place-items-center focus:rounded-full focus:bg-black/60 focus:text-white ${RING}`}
                          >
                            {paused ? (
                              <Play size={24} aria-hidden className="fill-current" />
                            ) : (
                              <Pause size={24} aria-hidden className="fill-current" />
                            )}
                          </button>
                        ) : null}
                        <DoubleTapHeart
                          className="absolute inset-0"
                          onDoubleTap={isCurrent ? onDoubleTap : undefined}
                          onSingleTap={isCurrent ? onTogglePause : undefined}
                          tapSlopPx={REELS_TAP_SLOP_PX}
                        >
                          <div className="absolute inset-0">
                            {renderMedia(item, { current: isCurrent })}
                          </div>
                        </DoubleTapHeart>
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0"
                          style={{ background: VEIL }}
                        />
                        <div
                          className="pointer-events-none absolute inset-0 z-[3] *:pointer-events-auto"
                          {...STOP_POINTER}
                        >
                          {renderOverlay(item, { current: isCurrent })}
                        </div>
                      </>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          {/* The lane row and the sound button: they do not slide with the pages. */}
          <div
            className="pointer-events-none absolute inset-0 z-[3] *:pointer-events-auto"
            {...STOP_POINTER}
          >
            {top}
          </div>

          {showSpinner ? (
            <div
              data-testid="reels-spinner"
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-1/2 z-[2] -translate-x-1/2 -translate-y-1/2"
            >
              <Loader2
                size={24}
                className="animate-spin text-white/70 motion-reduce:animate-none"
              />
            </div>
          ) : null}

          {showPlayBadge ? (
            // A sibling of the tap surface, occupying only its own box: one tap resumes, and the
            // area around it stays a live swipe and tap surface.
            <button
              type="button"
              data-testid="reels-play-badge"
              aria-label={labels.play}
              onClick={onTogglePause}
              className={`absolute top-1/2 left-1/2 z-[3] grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white ${RING}`}
            >
              <Play size={24} aria-hidden className="fill-current" />
            </button>
          ) : null}

          {ticks.length > 0 ? (
            <div
              data-testid="reels-ticks"
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-[3px] z-[3] flex -translate-y-1/2 flex-col gap-1"
            >
              {ticks.map((tick) => (
                <span
                  key={tick.k}
                  data-tick={tick.k}
                  data-active={tick.active ? 'true' : 'false'}
                  className={`block w-[3px] rounded-sm transition-[height,background-color] duration-300 motion-reduce:transition-none ${
                    tick.active
                      ? 'h-4 bg-white'
                      : tick.faint
                        ? 'h-1.5 bg-white/20'
                        : 'h-1.5 bg-white/40'
                  }`}
                />
              ))}
            </div>
          ) : null}

          {/* Exactly one polite region: the position is announced once per page change. */}
          <span data-testid="reels-position" aria-live="polite" className="sr-only">
            {position}
          </span>
        </div>

        {/* Desktop ↑/↓, 24 px outside the column's right edge, vertically centred (UI-D-95). */}
        <div className="absolute top-1/2 left-[calc(100%+24px)] hidden -translate-y-1/2 flex-col gap-4 md:flex">
          <IconButton
            icon={ChevronUp}
            size={20}
            label={labels.previous}
            disabled={atStart}
            onClick={() => go(index - 1)}
            className="rounded-full bg-white/10 text-white hover:bg-white/20 active:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-0 disabled:opacity-40"
          />
          <IconButton
            icon={ChevronDown}
            size={20}
            label={labels.next}
            disabled={atTrueEnd}
            onClick={() => go(index + 1)}
            className="rounded-full bg-white/10 text-white hover:bg-white/20 active:bg-white/20 focus-visible:ring-white focus-visible:ring-offset-0 disabled:opacity-40"
          />
        </div>
      </div>
    </div>
  );
}
