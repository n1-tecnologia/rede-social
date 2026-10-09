'use client';

import { Heart } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../cn';
import { useMediaQuery } from '../hooks/useMediaQuery';

export interface DoubleTapHeartProps {
  children: ReactNode;
  /** Omitted, the wrapper is inert: children render unchanged and no burst is ever mounted. */
  onDoubleTap?: () => void;
  /**
   * OPT-IN (UI-D-86). Fires once when the double-tap window closes with no second tap, so a surface
   * can give a single tap its own meaning (Reels: pause) without a double tap ever triggering it —
   * the second tap cancels the pending single tap. Omitted, no single-tap timer is ever scheduled.
   */
  onSingleTap?: () => void;
  /**
   * OPT-IN (UI-D-86). A pointerup farther than this many CSS pixels from its own pointerdown is NO
   * tap: it neither counts toward a double tap nor schedules a single tap, and it resets the window
   * (cancelling a pending single tap). This is what stops two quick swipes from reading as a like.
   * Omitted, the wrapper registers no pointerdown listener and measures nothing (unless it holds).
   */
  tapSlopPx?: number;
  /**
   * OPT-IN (2026-10-09). A main-button press that stays within the slop (`tapSlopPx`, or 10 px) for
   * `holdMs` is a HOLD: this fires once, so a video can pause on that frame while it is held, the
   * story viewer's gesture. A hold forgets the tap before it (a pending single tap, the double-tap
   * window). Omitted together with `onHoldEnd`, no hold is ever timed.
   */
  onHoldStart?: () => void;
  /**
   * The hold ended: its pointer was released, the browser cancelled it (a scroll taking over), or a
   * mouse left the surface. Its release is NO tap: no single tap, no double tap, no burst.
   */
  onHoldEnd?: () => void;
  /** How long a still press lasts before it is a hold; the story viewer's 200 ms by default. */
  holdMs?: number;
  className?: string;
}

/** Two taps closer together than this read as one double tap. */
const DOUBLE_TAP_WINDOW_MS = 300;
/** A still press longer than this is a hold, not a tap (the story viewer's `TAP_MAX_MS`). */
const HOLD_MS = 200;
/** How far a press may drift and still become a hold, when the caller gives no `tapSlopPx`. */
const HOLD_SLOP_PX = 10;
/** How long the burst stays on screen before its exit begins. */
const BURST_LIFE_MS = 900;
const BURST_SPRING = { type: 'spring', damping: 8, stiffness: 200 } as const;
const BURST_FADE = { duration: 0.4, ease: 'easeOut' } as const;

/**
 * Double-tap-to-like wrapper over arbitrary media. Two constraints it exists to hold:
 *
 *  - The burst overlay is `pointer-events-none` and `aria-hidden`, so it can never swallow an
 *    activation meant for the child underneath and never reaches the accessibility tree — the like
 *    control's accessible name lives on the `LikeButton` beside it, not here.
 *  - Under `prefers-reduced-motion: reduce` the burst still renders (the user must see that the tap
 *    registered) but at full scale, fading on opacity alone.
 *
 * **The opt-in props (`onSingleTap`, `tapSlopPx`, and since 2026-10-09 the hold) exist for the
 * video surfaces (the Reels page, UI-D-86, and the feed's `FeedVideo`) and are opt-in on purpose
 * (D-124).** A caller that passes none — the feed's photos in `PostMedia` — runs exactly the path
 * it always ran: one `pointerup` listener, no `pointerdown` listener, no timer of any kind.
 *
 * **The hold** belongs to the pointer that started it: a second finger never starts, ends or
 * steers it, and a second finger that lands while the first is still deciding makes no hold at
 * all. A press that drifts past the slop before `holdMs` is a scroll or a swipe and never holds;
 * once held, the hold lasts until its own release, cancel or (for a mouse) the pointer leaving.
 *
 * **No ancestor may call `setPointerCapture`.** With capture, `pointerup` is retargeted to the
 * capturing element and this wrapper's own `onPointerUp` never runs, so neither the double tap nor
 * the single tap would ever fire (05.3 RESEARCH Pattern 6). Gesture surfaces above it listen
 * without capturing.
 */
export function DoubleTapHeart({
  children,
  onDoubleTap,
  onSingleTap,
  tapSlopPx,
  onHoldStart,
  onHoldEnd,
  holdMs = HOLD_MS,
  className,
}: DoubleTapHeartProps) {
  const [burstId, setBurstId] = useState<number | null>(null);
  const lastTapAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The pending single tap (only ever set when `onSingleTap` is given). */
  const singleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Where the current pointer went down (only ever set while the press listeners are on). */
  const downAt = useRef<{ x: number; y: number } | null>(null);
  /** The latest `onSingleTap`, read when the window closes rather than when the tap happened. */
  const singleTapRef = useRef(onSingleTap);
  singleTapRef.current = onSingleTap;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  /** The hold is opted into (the callbacks are read through refs, like `onSingleTap`). */
  const holds = onHoldStart !== undefined || onHoldEnd !== undefined;
  /**
   * The press listeners. Kept while only the slop is given (a Reels neighbour), so a press that
   * began while its page was current still ends here.
   */
  const measures = tapSlopPx !== undefined || holds;
  const holdStartRef = useRef(onHoldStart);
  holdStartRef.current = onHoldStart;
  const holdEndRef = useRef(onHoldEnd);
  holdEndRef.current = onHoldEnd;
  /** The press that may become (or is) a hold: its pointer and where it went down. */
  const press = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  /** The pending hold (only ever set when a hold callback is given). */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** `onHoldStart` ran and the hold has not ended yet. */
  const holding = useRef(false);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (singleTimer.current) clearTimeout(singleTimer.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
      // A surface that goes away mid-hold still ends it, so nothing stays paused behind it.
      if (holding.current) {
        holding.current = false;
        holdEndRef.current?.();
      }
    },
    [],
  );

  const cancelSingleTap = useCallback(() => {
    if (singleTimer.current) {
      clearTimeout(singleTimer.current);
      singleTimer.current = undefined;
    }
  }, []);

  const cancelHoldTimer = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = undefined;
    }
  }, []);

  /** Ends the press. True when it had become a hold, whose end is then reported. */
  const endPress = useCallback((): boolean => {
    cancelHoldTimer();
    press.current = null;
    if (!holding.current) return false;
    holding.current = false;
    holdEndRef.current?.();
    return true;
  }, [cancelHoldTimer]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      downAt.current = { x: event.clientX, y: event.clientY };
      if (!holds || event.button !== 0 || holding.current) return;
      if (press.current) {
        // A second finger while the first is still deciding: a multi-touch gesture is no hold.
        cancelHoldTimer();
        press.current = null;
        return;
      }
      press.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
      holdTimer.current = setTimeout(() => {
        holdTimer.current = undefined;
        if (!press.current) return;
        holding.current = true;
        // A hold is no tap, and it forgets the tap before it.
        cancelSingleTap();
        lastTapAt.current = 0;
        holdStartRef.current?.();
      }, holdMs);
    },
    [holds, holdMs, cancelHoldTimer, cancelSingleTap],
  );

  /** A press that drifts past the slop before it held is a scroll or a swipe: it never holds. */
  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const origin = press.current;
      if (!origin || holding.current || event.pointerId !== origin.pointerId) return;
      const travelled = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
      if (travelled > (tapSlopPx ?? HOLD_SLOP_PX)) {
        cancelHoldTimer();
        press.current = null;
      }
    },
    [tapSlopPx, cancelHoldTimer],
  );

  /** The browser took the pointer (a scroll, a system gesture): a hold ends, a pending one drops. */
  const handlePointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (press.current?.pointerId !== event.pointerId) return;
      endPress();
    },
    [endPress],
  );

  /** A mouse has no implicit capture: released outside, its pointerup never comes back here. */
  const handlePointerLeave = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType !== 'mouse' || press.current?.pointerId !== event.pointerId) return;
      endPress();
    },
    [endPress],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (press.current?.pointerId === event.pointerId) {
        if (endPress()) {
          // The release of a hold is swallowed: no single tap, no double tap, no burst.
          downAt.current = null;
          return;
        }
      } else if (holding.current) {
        // Another finger lifting during a hold is no tap either.
        return;
      }
      if (!onDoubleTap && !onSingleTap) return;
      if (tapSlopPx !== undefined) {
        const origin = downAt.current;
        downAt.current = null;
        if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > tapSlopPx) {
          // A pointer that travelled is a swipe, not a tap: it never pairs into a double tap and it
          // forgets the tap before it, pending single tap included.
          lastTapAt.current = 0;
          cancelSingleTap();
          return;
        }
      }
      const now = Date.now();
      if (now - lastTapAt.current < DOUBLE_TAP_WINDOW_MS) {
        // the second tap: the pending single tap is cancelled, so a double tap never also pauses
        cancelSingleTap();
        // reset, so a third tap starts a fresh window instead of chaining a second like
        lastTapAt.current = 0;
        if (!onDoubleTap) return;
        onDoubleTap();
        setBurstId(now);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setBurstId(null), BURST_LIFE_MS);
        return;
      }
      lastTapAt.current = now;
      if (onSingleTap) {
        cancelSingleTap();
        singleTimer.current = setTimeout(() => {
          singleTimer.current = undefined;
          lastTapAt.current = 0;
          singleTapRef.current?.();
        }, DOUBLE_TAP_WINDOW_MS);
      }
    },
    [onDoubleTap, onSingleTap, tapSlopPx, cancelSingleTap, endPress],
  );

  return (
    // A gesture surface over its own interactive children — it adds no role and no tab stop, because
    // the keyboard/AT path to the same action is the LikeButton beside it (UI-SPEC UI-D-07).
    <div
      className={cn('relative select-none', className)}
      onPointerDown={measures ? handlePointerDown : undefined}
      onPointerMove={measures ? handlePointerMove : undefined}
      onPointerUp={handlePointerUp}
      onPointerCancel={measures ? handlePointerCancel : undefined}
      onPointerLeave={measures ? handlePointerLeave : undefined}
    >
      {children}

      <AnimatePresence>
        {burstId !== null ? (
          <motion.div
            key={burstId}
            aria-hidden
            data-double-tap-burst={reduceMotion ? 'opacity' : 'spring'}
            initial={reduceMotion ? { opacity: 0 } : { scale: 0, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { scale: 1, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { scale: 1.3, opacity: 0 }}
            transition={
              reduceMotion ? { opacity: BURST_FADE } : { scale: BURST_SPRING, opacity: BURST_FADE }
            }
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <Heart
              size={80}
              className="text-like fill-like drop-shadow-[0_0_20px_color-mix(in_oklch,var(--color-like),transparent_40%)]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
