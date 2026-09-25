'use client';

import { IconButton, useFocusTrap, useMediaQuery } from '@tria/ui';
import { Play, Volume2, VolumeX, X } from 'lucide-react';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { STORY_DURATION_MS } from '../contracts/index';
import { StoryProgressBars } from './StoryProgressBars';
import { useStoryClock } from './useStoryClock';

/**
 * The full-screen story viewer (STORY-02, UI-D-30..UI-D-34) — surface 2 of the five the design
 * prototype does not have, drawn by sketch 003 and approved before this file was written.
 *
 * It is the prototype's own reels pager with the AXIS FLIPPED: a story sequence runs horizontally
 * and a dismiss runs downward, so `LIMIAR = 60`, the `0.35` rubber band, the easing curve and the
 * `|k − i| ≤ 1` neighbour window are ported as VALUES (Pitfall 12 — never as imports; that
 * directory is gitignored and is not a package).
 *
 * **THREE THINGS A REVIEWER MUST NOT "FIX":**
 *
 * 1. **`DoubleTapHeart` is NOT mounted here, deliberately** (UI-D-31, Pitfall 7, A-5). A tap already
 *    means "advance", so the first tap of a double-tap would skip the story — the member would lose
 *    the story AND fail to like it, silently. Holding every advance for a ~300 ms disambiguation
 *    window is perceptible on the one gesture this screen exists for. Liking is the explicit 44×44
 *    heart the host puts in `actions`. The feed keeps double-tap because its card does not navigate.
 * 2. **There is no share control** (UI-D-32) — sharing is not in STORY-05 and the bottom row has
 *    exactly two actions.
 * 3. **The clock survives `prefers-reduced-motion`** (UI-D-30). Only the pager's TRANSITION
 *    collapses to an instant swap. Auto-advance is content pacing, not decoration; removing it
 *    would leave a viewer that does nothing on its own.
 *
 * **It ships no words (PWA-03) and resolves no route (MOD-02).** Every string is a `labels` prop,
 * the media is a node the HOST builds — the shipped video player binds an app-scoped server action
 * for its per-request playback token, which a module may not import — and the action row is handed
 * over whole.
 */

/** What the viewer hands the host's media renderer. The host reports; the viewer decides. */
export interface StoryMediaControls {
  /** True for the story being watched. Neighbours are mounted but must not play. */
  active: boolean;
  /** The single OR-ed pause boolean — the host pauses its own element on it. */
  paused: boolean;
  /** Starts `true`: iOS autoplays muted inline video and nothing else (Pitfall 6). */
  muted: boolean;
  /** The media can be shown. **The clock does not start until this fires** (UI loading/E03). */
  onLoad: () => void;
  /** The media cannot be shown: the error copy renders and the clock stays where it stopped. */
  onError: () => void;
  /** Video only. Arms the UI-D-34 autoplay check and counts as `onLoad`. */
  onCanPlay: () => void;
  /** Video only. Playback is really running, so the autoplay badge is not needed. */
  onPlaying: () => void;
  /** Video only. The asset's OWN time drives its segment — never a fixed timer. */
  onTimeUpdate: (currentSeconds: number, durationSeconds: number) => void;
}

export interface StoryViewerItem {
  id: string;
  mediaKind: 'image' | 'video';
  /** Empty renders NO caption node and the action row moves down (UI empty/E05). */
  caption: string;
  authorName: string;
  /** Server-formatted relative time (UI-D-14) — there is no clock in this render tree. */
  timeLabel: string;
  avatar: ReactNode;
  media: (controls: StoryMediaControls) => ReactNode;
  /** The host's like/comment row, built whole (the `LikeButton` lives in the app tier, MOD-02). */
  actions: ReactNode;
  /**
   * Called SYNCHRONOUSLY inside the play badge's click handler, so the host's `play()` still runs
   * inside the user gesture iOS requires. An effect after the fact would be one task too late.
   */
  onRequestPlay?: () => void;
}

export interface StoryViewerLabels {
  dialog: string;
  close: string;
  mute: string;
  unmute: string;
  previous: string;
  next: string;
  play: string;
  mediaError: string;
  retry: string;
  loadingGroup: string;
  groupError: string;
  /** Generated, bounded by the count, never member content (long-text/E04). */
  position: (group: string, current: number, total: number) => string;
}

/**
 * 05.2-05 RED SHIM — deliberately INERT. The grouped props are accepted so the rewritten tests can
 * render, but only `groups[initialGroup]` is played and no group behaviour exists yet. The GREEN
 * commit replaces this whole block.
 */
export interface StoryViewerGroup {
  key: string;
  items: readonly StoryViewerItem[] | null;
  failed?: boolean;
  header: { name: string; avatar: ReactNode };
}

export interface StoryViewerProps {
  /**
   * FROZEN for the life of the viewing session. A story that expires — or that an admin deletes —
   * mid-view plays out its own segment and is absent only from the NEXT strip read; nothing is ever
   * removed under the member's finger (UI partial/E04).
   */
  groups: readonly StoryViewerGroup[];
  initialGroup?: number;
  initialIndex?: number;
  onNeedGroup?: (group: number) => void;
  onRetryGroup?: (group: number) => void;
  onSegmentShown?: (storyId: string) => void;
  labels: StoryViewerLabels;
  onClose: () => void;
  /**
   * 05-07 feeds the open comment sheet in here — the SAME boolean the hold gesture writes, so
   * "hold to pause" and "the sheet is open" are one mechanism rather than two that can disagree.
   */
  externallyPaused?: boolean;
  /**
   * A node rendered INSIDE the dialog, above everything else — 05-07's `CommentSheet`.
   *
   * It is INJECTED rather than imported for the reason the action row is: `CommentSheet` lives in
   * `@tria/module-feed` and `turbo boundaries` denies a `module -> module` package edge (MOD-02),
   * so the composition happens in `apps/web`, which may reach both. 05-06 resolved the identical
   * edge for `LikeButton` the same way.
   *
   * It is a CHILD of the dialog root rather than a sibling, and that placement is load-bearing
   * twice over. The root's focus trap enumerates its own descendants, so a sheet rendered outside
   * it would have focus yanked back out from under it; and the sheet's own Escape handler calls
   * `stopPropagation` on the panel, which only shields the viewer's `onKeyDown` when the viewer is
   * an ANCESTOR. It sits outside the gesture stage, so a tap inside the sheet is never a tap on a
   * story.
   */
  overlay?: ReactNode;
  /** Injected by the unit test; defaults to the browser's own timer and frame scheduler. */
  now?: () => number;
  requestFrame?: (callback: (timestamp: number) => void) => number;
  cancelFrame?: (handle: number) => void;
  /** UI-D-34's window between "can play" and "is playing". */
  autoplayCheckMs?: number;
}

/** The prototype's drag threshold (`LIMIAR`), for BOTH axes — one number, one feel. */
const DRAG_THRESHOLD_PX = 60;
/** The prototype's rubber band: the stack follows the finger at a fraction of the distance. */
const RUBBER_BAND = 0.35;
/** The prototype's settle. Collapsed to an instant swap under reduced motion. */
const PAGER_TRANSITION = 'transform 0.42s cubic-bezier(0.2, 0.715, 0.205, 0.99)';
/** A release later than this is a HOLD, not a tap. */
const TAP_MAX_MS = 200;
/** A release further than this is a DRAG, not a tap. */
const TAP_MAX_PX = 10;
/** Left third = previous, right two-thirds = next: the larger target matches the dominant direction. */
const PREVIOUS_ZONE = 1 / 3;
/** The prototype's two-stop veil (UI-D-33), kept verbatim so the ink reads over any photograph. */
const VEIL =
  'linear-gradient(180deg, rgba(0,0,0,0.5), transparent 22%, transparent 52%, rgba(0,0,0,0.72))';
/**
 * Above the shell's `z-50` BottomNav and below `ConfirmDialog` / `BottomSheet` at `z-[55]`, the
 * rung 05-05's publish frame already had to claim. The UI-SPEC says `z-50`; the nav really does
 * intercept there (a measured e2e failure, not a hypothesis), and a comment sheet must still open
 * over the viewer in 05-07.
 */
const VIEWER_Z = 'z-[52]';

type MediaState = 'loading' | 'ready' | 'error';

export function StoryViewer({
  groups,
  initialGroup = 0,
  initialIndex = 0,
  labels,
  onClose,
  externallyPaused = false,
  overlay,
  now,
  requestFrame,
  cancelFrame,
  autoplayCheckMs = 400,
}: StoryViewerProps) {
  // RED SHIM: the initial group alone, as a flat sequence.
  const items = groups[initialGroup]?.items ?? [];
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0)),
  );
  const [drag, setDrag] = useState({ active: false, dx: 0, dy: 0 });
  const [holding, setHolding] = useState(false);
  const [keyboardPaused, setKeyboardPaused] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(false);
  const [muted, setMuted] = useState(true);
  const [mediaState, setMediaState] = useState<Record<string, MediaState>>({});
  const [canPlay, setCanPlay] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState<Record<string, boolean>>({});
  const [blocked, setBlocked] = useState<Record<string, boolean>>({});
  const [videoProgress, setVideoProgress] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState<Record<string, number>>({});
  const [playAttempt, setPlayAttempt] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const current = items[index];
  const currentId = current?.id ?? '';
  const isVideo = current?.mediaKind === 'video';
  const currentState: MediaState = mediaState[currentId] ?? 'loading';
  const autoplayBlocked = blocked[currentId] === true;

  /**
   * ONE boolean, three sources plus the two the surface owns: the hold gesture, the host's external
   * flag (05-07's comment sheet), document visibility — so backgrounding the PWA never burns a
   * story — the space key, and an expanded caption, because reading is the reason to stop.
   * A video that will not start joins them (UI-D-34): the bar must never fill over a frozen frame.
   */
  const paused =
    holding ||
    externallyPaused ||
    documentHidden ||
    keyboardPaused ||
    captionExpanded ||
    autoplayBlocked;

  const goTo = useCallback((next: number) => setIndex(next), []);

  const goNext = useCallback(() => {
    // D-78: the END CLOSES. A single-publisher strip on a loop traps the member in three stories.
    if (index >= items.length - 1) {
      onClose();
      return;
    }
    goTo(index + 1);
  }, [goTo, index, items.length, onClose]);

  const clock = useStoryClock({
    durationMs: STORY_DURATION_MS,
    // The clock waits for the media (a slow image must not burn five seconds invisibly), and never
    // drives a VIDEO — a video's own time does, so a stall desynchronises nothing.
    paused: paused || currentState !== 'ready' || isVideo,
    itemKey: currentId,
    onComplete: goNext,
    now,
    requestFrame,
    cancelFrame,
  });

  const goPrevious = useCallback(() => {
    // …and the START RESTARTS. There is nothing before the first story to go back to.
    if (index === 0) {
      clock.restart();
      return;
    }
    goTo(index - 1);
  }, [clock, goTo, index]);

  /** White status-bar ink over the media, REMOVED on unmount — the prototype's own hook. */
  useEffect(() => {
    const root = document.documentElement;
    // The CSS keyword rather than the prototype's hex: UI-03 allows colour literals in the token
    // file alone, and `white` is the same colour with none of the drift.
    root.style.setProperty('--statusbar-ink', 'white');
    return () => {
      root.style.removeProperty('--statusbar-ink');
    };
  }, []);

  /** Backgrounding the app pauses the sequence instead of spending it (T-05-38). */
  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  /** A skip closes an expanded caption; otherwise the next story would open already paused. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the reset is keyed on the INDEX change
  useEffect(() => {
    setCaptionExpanded(false);
  }, [index]);

  useFocusTrap(rootRef, true, onClose);

  /**
   * Focus lands on CLOSE, not on the first tab stop. `useFocusTrap` moves it to the first focusable
   * descendant — the previous-story zone — and the UI-SPEC asks for the exit. Declared AFTER the
   * trap so this effect runs second and wins.
   */
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-story-close]')
      ?.focus({ preventScroll: true });
  }, []);

  /**
   * UI-D-34. "Did not start" is a STATE: `canplay` arms a short check, and if playback has not
   * begun by then the clock STAYS PAUSED and the badge renders. One tap starts both.
   */
  useEffect(() => {
    const video = current?.mediaKind === 'video' ? current : null;
    if (!video) return;
    if (!canPlay[video.id] || playing[video.id]) return;
    const timer = setTimeout(() => {
      setBlocked((state) => ({ ...state, [video.id]: true }));
    }, autoplayCheckMs);
    return () => clearTimeout(timer);
  }, [current, canPlay, playing, autoplayCheckMs]);

  /* ── The media controls ────────────────────────────────────────────────────────────────────────
   *
   * These used to be a render-time factory, and that factory was the root cause of GAP 2: it handed
   * every media child brand-new `onLoad`/`onError` functions on every pass, and a child that takes
   * a report callback as an effect dependency (`MediaImage` did) then re-arms its effect on every
   * pass — a loop that ran a verifier probe to a JavaScript heap out-of-memory. `MediaImage` is
   * fixed at its own end too, but a component that destabilises its children is a defect waiting
   * for the next consumer to rediscover, so it is fixed at BOTH ends.
   *
   * The structure is two memos over a live ref:
   *   1. the ref carries the only two VOLATILE things the handlers need (the current index and the
   *      current `goNext`), so no handler has to close over them;
   *   2. the handler map is memoised over `[items]` alone — each handler closes over its own story
   *      id and its own position, both fixed for a given array, and every state write is already a
   *      functional updater, so nothing else needs capturing. The identities therefore live as long
   *      as the sequence does;
   *   3. the control-object map is memoised over the four things that legitimately change it. A
   *      mute toggle SHOULD hand the video bridge a new object; a keystroke should not.
   */
  const liveRef = useRef({ index, goNext });
  liveRef.current = { index, goNext };

  const mediaHandlers = useMemo(() => {
    const map = new Map<string, Omit<StoryMediaControls, 'active' | 'paused' | 'muted'>>();
    items.forEach((item, k) => {
      map.set(item.id, {
        onLoad: () => setMediaState((state) => ({ ...state, [item.id]: 'ready' })),
        onError: () => setMediaState((state) => ({ ...state, [item.id]: 'error' })),
        onCanPlay: () => {
          setMediaState((state) => ({ ...state, [item.id]: 'ready' }));
          setCanPlay((state) => ({ ...state, [item.id]: true }));
        },
        onPlaying: () => {
          setPlaying((state) => ({ ...state, [item.id]: true }));
          setBlocked((state) => ({ ...state, [item.id]: false }));
        },
        onTimeUpdate: (currentSeconds: number, durationSeconds: number) => {
          if (durationSeconds <= 0) return;
          const ratio = currentSeconds / durationSeconds;
          setVideoProgress((state) => ({ ...state, [item.id]: ratio }));
          // The live ref rather than a render closure: same rule, read at call time.
          if (ratio >= 1 && k === liveRef.current.index) liveRef.current.goNext();
        },
      });
    });
    return map;
  }, [items]);

  const mediaControls = useMemo(() => {
    const map = new Map<string, StoryMediaControls>();
    items.forEach((item, k) => {
      const handlers = mediaHandlers.get(item.id);
      if (!handlers) return;
      map.set(item.id, {
        active: k === index,
        paused: paused || k !== index,
        muted,
        ...handlers,
      });
    });
    return map;
  }, [items, index, paused, muted, mediaHandlers]);

  /* ── Gestures ──────────────────────────────────────────────────────────────────────────────── */

  const clockNow =
    now ?? (() => (typeof performance === 'undefined' ? Date.now() : performance.now()));
  const press = useRef<{ x: number; y: number; t: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    press.current = { x: event.clientX, y: event.clientY, t: clockNow() };
    setDrag({ active: true, dx: 0, dy: 0 });
    // Hold-to-pause starts on PRESS. A tap pauses for the few milliseconds it lasts, which is free.
    setHolding(true);
    const target = event.currentTarget;
    if (typeof target.setPointerCapture === 'function') {
      try {
        target.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a nicety (it keeps a fast drag attached); its absence changes nothing.
      }
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    if (!start) return;
    setDrag({ active: true, dx: event.clientX - start.x, dy: event.clientY - start.y });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = press.current;
    press.current = null;
    setDrag({ active: false, dx: 0, dy: 0 });
    setHolding(false);
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = clockNow() - start.t;

    // A TAP: short and still. Anything else was a hold (already handled by the pause above) or a
    // drag — and a hold that moved nowhere must not also advance the story.
    if (elapsed <= TAP_MAX_MS && Math.abs(dx) <= TAP_MAX_PX && Math.abs(dy) <= TAP_MAX_PX) {
      const box = stageRef.current?.getBoundingClientRect();
      const width =
        box && box.width > 0 ? box.width : typeof window === 'undefined' ? 0 : window.innerWidth;
      const left = box && box.width > 0 ? box.left : 0;
      const zone = width > 0 ? (event.clientX - left) / width : 1;
      if (zone < PREVIOUS_ZONE) goPrevious();
      else goNext();
      return;
    }

    // The DOMINANT AXIS decides, so one gesture never both moves through the sequence AND dismisses.
    if (Math.abs(dx) > Math.abs(dy)) {
      if (dx <= -DRAG_THRESHOLD_PX) goNext();
      else if (dx >= DRAG_THRESHOLD_PX) goPrevious();
      return;
    }
    // Down dismisses; UP is deliberately inert — there is nothing above a story.
    if (dy >= DRAG_THRESHOLD_PX) onClose();
  };

  const onPointerCancel = () => {
    press.current = null;
    setDrag({ active: false, dx: 0, dy: 0 });
    setHolding(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrevious();
      return;
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      // Space is also the activation key: while a control has focus it belongs to that control.
      const target = event.target as HTMLElement | null;
      if (target && target !== event.currentTarget && target.closest('button, a, input, textarea'))
        return;
      event.preventDefault();
      setKeyboardPaused((value) => !value);
    }
  };

  /* ── Render ────────────────────────────────────────────────────────────────────────────────── */

  const horizontal = Math.abs(drag.dx) > Math.abs(drag.dy);
  const offsetX = drag.active && horizontal ? drag.dx * RUBBER_BAND : 0;
  const offsetY = drag.active && !horizontal && drag.dy > 0 ? drag.dy * RUBBER_BAND : 0;

  const progress = isVideo ? (videoProgress[currentId] ?? 0) : clock.progress;
  const positionLabel = useMemo(
    () => labels.position(groups[initialGroup]?.header.name ?? '', index + 1, items.length),
    [labels, index, items.length, groups, initialGroup],
  );

  return (
    // `touchAction: 'none'` is what stops the browser stealing the drag and turning a swipe into a
    // scroll or a back-navigation — the single most important style in this file.
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      tabIndex={-1}
      data-story-index={index}
      data-paused={paused ? 'true' : 'false'}
      onKeyDown={onKeyDown}
      className={`fixed inset-0 ${VIEWER_Z} overflow-hidden bg-black text-white select-none`}
      style={{ touchAction: 'none' }}
    >
      <div
        ref={stageRef}
        data-testid="story-stage"
        className="absolute inset-0"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          data-testid="story-pager"
          className="absolute inset-0"
          style={{
            transform: `translate(calc(${-index * 100}% + ${offsetX}px), ${offsetY}px)`,
            transition: drag.active || reduceMotion ? 'none' : PAGER_TRANSITION,
          }}
        >
          {items.map((item, k) => (
            <div
              key={item.id}
              className="absolute inset-y-0 w-full"
              style={{ left: `${k * 100}%` }}
            >
              {/* The neighbour window IS the pre-buffer: the next story has already decoded when
                  the swipe lands, so a pager frame is never an empty box. */}
              {Math.abs(k - index) <= 1 ? (
                <div
                  className="absolute inset-0 grid place-items-center"
                  key={attempt[item.id] ?? 0}
                >
                  {(() => {
                    const controls = mediaControls.get(item.id);
                    return controls ? item.media(controls) : null;
                  })()}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <span
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: VEIL }}
        />

        {/* The tap zones carry the two directions' accessible NAMES and are reachable by keyboard.
            They are `pointer-events-none` so a real tap lands on the stage above, where the same
            zone maths runs alongside the hold and drag detection — one gesture pipeline, not two. */}
        <div className="pointer-events-none absolute inset-0 flex">
          <button
            type="button"
            aria-label={labels.previous}
            onClick={goPrevious}
            className="h-full basis-1/3 focus-visible:outline-none"
          />
          <button
            type="button"
            aria-label={labels.next}
            onClick={goNext}
            className="h-full basis-2/3 focus-visible:outline-none"
          />
        </div>
      </div>

      {/* ── OUTSIDE the stage, deliberately (CR-04) ─────────────────────────────────────────────
          Both controls below used to live INSIDE the div above, the one that owns
          `onPointerDown`/`onPointerMove`/`onPointerUp`. A tap on either therefore also ran the
          stage's tap-zone maths and advanced the story: the member pressed "play" and lost the
          story instead. The viewer must not mount two different meanings on the same tap.

          The isolation is STRUCTURAL rather than propagational — a control that is not in the
          subtree carrying the handlers cannot bubble into them, and there is no propagation-halting
          call anywhere in this file for a later edit to delete by accident. They keep their `z-[4]`, which sits above
          the stage in the same stacking context the header row (`z-[3]`) already uses.

          COVERAGE, stated accurately: `story-viewer.test.tsx` cases 12a-12c pin the structural half
          — the badge and the retry are siblings of the stage, and a tap on either does not advance.
          The HIT-TESTING half (a tap on the error COPY falling through to the stage via
          `pointer-events-none`) is asserted by NO automated test: happy-dom does not hit-test, and
          no browser-level spec in this repo drives these controls. It is carried as an open human
          check in the phase's verification pack (WR-09). */}

      {isVideo && autoplayBlocked ? (
        // The badge occupies only its own box, so the area around it stays tappable by the stage.
        <button
          type="button"
          data-testid="story-autoplay-badge"
          aria-label={labels.play}
          onClick={() => {
            setBlocked((state) => ({ ...state, [currentId]: false }));
            setPlayAttempt((value) => value + 1);
            // Synchronously inside the gesture: iOS grants playback to the handler, not to a
            // later effect.
            current?.onRequestPlay?.();
          }}
          className="absolute top-1/2 left-1/2 z-[4] grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white"
          data-play-attempt={playAttempt}
        >
          <Play size={24} aria-hidden className="fill-current" />
        </button>
      ) : null}

      {currentState === 'error' ? (
        // `absolute inset-0` as a SIBLING of the stage would swallow every tap on the whole screen,
        // and the member could no longer advance past a failed story. So: the container is
        // transparent to hit-testing and only the control that needs a tap of its own takes one —
        // the same two-part idiom the veil and the tap-zone row use above, for the same reason.
        <div
          data-testid="story-media-error"
          className="pointer-events-none absolute inset-0 z-[4] flex flex-col items-center justify-center gap-3 px-8 text-center"
        >
          <p className="text-sm">{labels.mediaError}</p>
          <button
            type="button"
            onClick={() =>
              setAttempt((state) => {
                setMediaState((media) => ({ ...media, [currentId]: 'loading' }));
                return { ...state, [currentId]: (state[currentId] ?? 0) + 1 };
              })
            }
            className="pointer-events-auto text-sm font-bold underline"
          >
            {labels.retry}
          </button>
        </div>
      ) : null}

      <StoryProgressBars items={items} index={index} progress={progress} />

      {/* Exactly ONE polite region for the whole viewer: the bars are silent, so the position is
          announced once per story rather than sixty times a second. */}
      <span aria-live="polite" data-testid="story-position" className="sr-only">
        {positionLabel}
      </span>

      <div
        className="absolute right-0 left-0 z-[3] flex items-center gap-2.5 px-4"
        style={{ top: 'calc(var(--safe-top) + 24px)' }}
      >
        {current?.avatar}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{current?.authorName}</span>
          <span className="block text-xs text-white/75">{current?.timeLabel}</span>
        </span>
        <IconButton
          icon={muted ? VolumeX : Volume2}
          size={20}
          label={muted ? labels.unmute : labels.mute}
          onClick={() => setMuted((value) => !value)}
          className="bg-black/35 text-white"
        />
        <IconButton
          data-story-close=""
          icon={X}
          size={20}
          label={labels.close}
          onClick={onClose}
          className="text-white"
        />
      </div>

      <div
        className="absolute right-0 left-0 z-[3] px-4"
        style={{ bottom: 'calc(var(--safe-bottom) + 12px)' }}
      >
        {current && current.caption !== '' ? (
          // Collapsed it is three lines; expanded it scrolls INSIDE its own block, so a long
          // caption can never push the action row off the screen (UI overflow/E05).
          <button
            type="button"
            data-testid="story-caption"
            onClick={() => setCaptionExpanded((value) => !value)}
            className={`block w-full text-left text-base leading-relaxed drop-shadow-[0_1px_3px_rgba(0,0,0,0.6)] ${
              captionExpanded ? 'max-h-[40vh] overflow-y-auto' : 'line-clamp-3'
            }`}
          >
            {current.caption}
          </button>
        ) : null}
        <div className="-ml-2.5 mt-2 flex items-center gap-1">{current?.actions}</div>
      </div>

      {/* Last, so it paints over the veil, the caption and the action row; `BottomSheet` is
          `fixed inset-0 z-[55]`, a rung above this dialog's own `z-[52]`. */}
      {overlay}
    </div>
  );
}
