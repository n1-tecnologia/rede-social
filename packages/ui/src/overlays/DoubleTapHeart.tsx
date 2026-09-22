'use client';

import { Heart } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../cn';
import { useMediaQuery } from '../hooks/useMediaQuery';

export interface DoubleTapHeartProps {
  children: ReactNode;
  /** Omitted, the wrapper is inert: children render unchanged and no burst is ever mounted. */
  onDoubleTap?: () => void;
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
 */
export function DoubleTapHeart({ children, onDoubleTap, className }: DoubleTapHeartProps) {
  const [burstId, setBurstId] = useState<number | null>(null);
  const lastTapAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handlePointerUp = useCallback(() => {
    if (!onDoubleTap) return;
    const now = Date.now();
    if (now - lastTapAt.current < DOUBLE_TAP_WINDOW_MS) {
      onDoubleTap();
      setBurstId(now);
      // reset, so a third tap starts a fresh window instead of chaining a second like
      lastTapAt.current = 0;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setBurstId(null), BURST_LIFE_MS);
      return;
    }
    lastTapAt.current = now;
  }, [onDoubleTap]);

  return (
    // A gesture surface over its own interactive children — it adds no role and no tab stop, because
    // the keyboard/AT path to the same action is the LikeButton beside it (UI-SPEC UI-D-07).
    <div className={cn('relative select-none', className)} onPointerUp={handlePointerUp}>
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
