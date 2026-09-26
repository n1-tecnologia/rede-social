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
   * Omitted, the wrapper registers no pointerdown listener and measures nothing.
   */
  tapSlopPx?: number;
  className?: string;
}

/** Two taps closer together than this read as one double tap. */
const DOUBLE_TAP_WINDOW_MS = 300;
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
 * **The two opt-in props (`onSingleTap`, `tapSlopPx`) exist for the Reels page (UI-D-86) and are
 * opt-in on purpose (D-124).** A caller that passes neither — the feed's `PostMedia` — runs exactly
 * the path it always ran: one `pointerup` listener, no `pointerdown` listener, no single-tap timer.
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
  className,
}: DoubleTapHeartProps) {
  const [burstId, setBurstId] = useState<number | null>(null);
  const lastTapAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** The pending single tap (only ever set when `onSingleTap` is given). */
  const singleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Where the current pointer went down (only ever set when `tapSlopPx` is given). */
  const downAt = useRef<{ x: number; y: number } | null>(null);
  /** The latest `onSingleTap`, read when the window closes rather than when the tap happened. */
  const singleTapRef = useRef(onSingleTap);
  singleTapRef.current = onSingleTap;
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (singleTimer.current) clearTimeout(singleTimer.current);
    },
    [],
  );

  const cancelSingleTap = useCallback(() => {
    if (singleTimer.current) {
      clearTimeout(singleTimer.current);
      singleTimer.current = undefined;
    }
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    downAt.current = { x: event.clientX, y: event.clientY };
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
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
    [onDoubleTap, onSingleTap, tapSlopPx, cancelSingleTap],
  );

  return (
    // A gesture surface over its own interactive children — it adds no role and no tab stop, because
    // the keyboard/AT path to the same action is the LikeButton beside it (UI-SPEC UI-D-07).
    <div
      className={cn('relative select-none', className)}
      onPointerDown={tapSlopPx !== undefined ? handlePointerDown : undefined}
      onPointerUp={handlePointerUp}
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
