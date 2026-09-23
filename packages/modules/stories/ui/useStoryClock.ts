'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The story clock (UI-D-30, R-P9) — ONE frame loop over ELAPSED TIME for the whole sequence.
 *
 * **Why this is JavaScript and not a CSS animation.** The three things this viewer must do are
 * exactly the three a declarative animation cannot express:
 *
 *  1. **Pause** — a hold, an open comment sheet (05-07) or a backgrounded tab.
 *  2. **Resume from where it stopped** — and this is the one that decides it. A CSS `animation`
 *     restarts from its own start; the `paused` play state freezes it but the value can never be
 *     SCRUBBED back to the stored elapsed after the tree re-renders, so a resumed bar would either
 *     replay five seconds the member already watched or jump to the end.
 *  3. **Skip** — moving to another story must reset the fill to zero on the frame it happens.
 *
 * A fixed tick is the other tempting shape and is worse than both: it desynchronises from the
 * compositor, it keeps firing while the tab is in the background, and it cannot follow a video that
 * stalls. The loop below asks the browser for the next frame and derives progress from the clock,
 * so a dropped frame costs accuracy in nothing at all.
 *
 * **Everything time-shaped is INJECTABLE.** `now`, `requestFrame` and `cancelFrame` default to the
 * browser's high-resolution timer and its frame scheduler; the unit test hands in a clock it moves
 * by hand, which is what makes `story-clock.test.ts` deterministic and instant.
 *
 * **One clock for the sequence, not one per segment.** `StoryProgressBars` renders N segments from
 * ONE `(index, progress)` pair; N independent clocks would be N chances to disagree about which
 * story is playing.
 */

export type StoryClockNow = () => number;
export type StoryClockRequestFrame = (callback: (timestamp: number) => void) => number;
export type StoryClockCancelFrame = (handle: number) => void;

export interface UseStoryClockOptions {
  /**
   * How long the CURRENT item runs. `STORY_DURATION_MS` for an image; for a video it is the asset's
   * own length. **Zero or less never starts the loop** — that is a video whose duration the player
   * has not reported yet, and a bar that filled over an unknown duration would be a lie.
   */
  durationMs: number;
  /** The single OR-ed boolean: the hold gesture, an external flag and document visibility. */
  paused: boolean;
  /** The current item's identity. A CHANGE is a skip: elapsed resets to zero, forwards or back. */
  itemKey: string | number;
  /** Fired EXACTLY once per item, when elapsed reaches the duration. The viewer advances on it. */
  onComplete: () => void;
  now?: StoryClockNow;
  requestFrame?: StoryClockRequestFrame;
  cancelFrame?: StoryClockCancelFrame;
}

export interface StoryClock {
  /** `0..1`. Before the first frame it is exactly 0, never an indeterminate value (UI loading/E04). */
  progress: number;
  elapsedMs: number;
  /** Replays the CURRENT item from zero — "previous" at the first story (D-78's boundary). */
  restart: () => void;
}

const defaultNow: StoryClockNow = () =>
  typeof performance === 'undefined' ? Date.now() : performance.now();

const defaultRequestFrame: StoryClockRequestFrame = (callback) => requestAnimationFrame(callback);

const defaultCancelFrame: StoryClockCancelFrame = (handle) => cancelAnimationFrame(handle);

export function useStoryClock({
  durationMs,
  paused,
  itemKey,
  onComplete,
  now = defaultNow,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame,
}: UseStoryClockOptions): StoryClock {
  const [tick, setTick] = useState({ progress: 0, elapsedMs: 0 });

  /**
   * Elapsed lives in a REF, not in state: it is what the next resume reads to recompute its start
   * offset, and reading it from state inside the frame callback would read the value the loop was
   * created with rather than the current one.
   */
  const elapsedRef = useRef(0);
  const completedRef = useRef(false);

  /** Bumped by `restart()`. A separate key from `itemKey`, because the item has NOT changed. */
  const [restartKey, setRestartKey] = useState(0);

  /**
   * Reset on a skip, during render — React's documented alternative to an effect, and the same
   * shape `useOptimisticLike` uses. An effect would paint the previous story's fill for one frame.
   */
  const [seen, setSeen] = useState({ itemKey, restartKey });
  if (seen.itemKey !== itemKey || seen.restartKey !== restartKey) {
    setSeen({ itemKey, restartKey });
    elapsedRef.current = 0;
    completedRef.current = false;
    setTick({ progress: 0, elapsedMs: 0 });
  }

  /**
   * The completion callback is read through a ref so a host that passes a fresh arrow every render
   * does not tear the loop down and rebuild it sixty times a second.
   */
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  /**
   * `itemKey` and `restartKey` are dependencies that the BODY never reads, and Biome is right that
   * this is unusual — but removing them is the bug. Both mean "the elapsed you were measuring from
   * has been zeroed during render", and only re-running the effect recomputes `start`. With a stale
   * `start`, the very next frame would measure elapsed from before the skip and complete the new
   * story instantly.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: see the note above — both keys re-arm the loop
  useEffect(() => {
    if (paused || completedRef.current || durationMs <= 0) return;

    // The resume offset: "the clock started `elapsed` ago". This single line is the whole reason
    // the hook exists — it is what a declarative animation cannot be told.
    const start = now() - elapsedRef.current;
    let handle = 0;

    const frame = (timestamp: number) => {
      const elapsed = timestamp - start;
      if (elapsed >= durationMs) {
        elapsedRef.current = durationMs;
        completedRef.current = true;
        setTick({ progress: 1, elapsedMs: durationMs });
        // No further frame is requested: the loop is over, so `onComplete` cannot fire twice even
        // if the host keeps the same item mounted.
        completeRef.current();
        return;
      }
      elapsedRef.current = elapsed;
      setTick({ progress: elapsed / durationMs, elapsedMs: elapsed });
      handle = requestFrame(frame);
    };

    handle = requestFrame(frame);
    return () => cancelFrame(handle);
  }, [paused, durationMs, itemKey, restartKey, now, requestFrame, cancelFrame]);

  const restart = useCallback(() => setRestartKey((value) => value + 1), []);

  return { progress: tick.progress, elapsedMs: tick.elapsedMs, restart };
}
