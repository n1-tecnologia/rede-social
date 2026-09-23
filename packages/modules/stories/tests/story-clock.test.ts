// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_DURATION_MS } from '../contracts/index';
import { type UseStoryClockOptions, useStoryClock } from '../ui/useStoryClock';

/**
 * UI-D-30's timing model, asserted under a clock the TEST owns.
 *
 * **Not one assertion in this file waits.** The hook takes its time source and its frame scheduler
 * as parameters, so `advance()` below moves time and delivers the frame it owes SYNCHRONOUSLY. A
 * suite that slept for 5 s to watch a story finish would be the slowest file in the repo and the
 * flakiest — and it would prove nothing a deterministic clock does not prove better.
 *
 * The three behaviours a later edit could silently break are the three a CSS animation cannot do,
 * which is the whole reason this hook exists rather than an `animation` with a duration:
 *
 *  1. **Resume continues from the STORED elapsed.** A declarative animation restarts, or needs
 *     `animation-play-state` and still cannot be scrubbed back to where the finger stopped it.
 *  2. **Completion fires exactly once.** The viewer advances on it; twice would skip a story.
 *  3. **A skip resets elapsed.** Moving to the next item — or back to the previous one — starts its
 *     segment at zero, never at the fraction the previous one had reached.
 */

afterEach(cleanup);

/**
 * The injected clock: a time value the test moves by hand, plus the single pending frame callback
 * the hook has asked for. `advance` is the only thing that makes time pass anywhere in this file.
 */
function manualClock() {
  let time = 0;
  let pending: ((timestamp: number) => void) | null = null;
  let handle = 0;

  return {
    now: () => time,
    requestFrame: (callback: (timestamp: number) => void) => {
      pending = callback;
      handle += 1;
      return handle;
    },
    cancelFrame: () => {
      pending = null;
    },
    /** Moves the clock forward and delivers the frame the hook is owed, in one synchronous step. */
    advance(ms: number) {
      time += ms;
      const callback = pending;
      pending = null;
      if (callback) act(() => callback(time));
    },
    /** True while the hook has a frame outstanding — i.e. while the clock is actually running. */
    get running() {
      return pending !== null;
    },
  };
}

type Clock = ReturnType<typeof manualClock>;

function options(
  clock: Clock,
  overrides: Partial<UseStoryClockOptions> = {},
): UseStoryClockOptions {
  return {
    durationMs: STORY_DURATION_MS,
    paused: false,
    itemKey: 'story-a',
    onComplete: () => {},
    now: clock.now,
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    ...overrides,
  };
}

describe('useStoryClock — one rAF loop over elapsed time (UI-D-30, R-P9)', () => {
  it('1. advancing the injected clock by half the duration reports progress 0.5', () => {
    const clock = manualClock();
    const { result } = renderHook(() => useStoryClock(options(clock)));

    // UI loading/E04: before the first frame the segment sits at exactly 0 — never an
    // indeterminate shimmer, which would read as progress that is not happening.
    expect(result.current.progress).toBe(0);

    clock.advance(STORY_DURATION_MS / 2);

    expect(result.current.progress).toBe(0.5);
    expect(result.current.elapsedMs).toBe(STORY_DURATION_MS / 2);
  });

  it('2. advancing past the duration reports 1 and fires the completion callback exactly ONCE', () => {
    const clock = manualClock();
    const onComplete = vi.fn();
    const { result } = renderHook(() => useStoryClock(options(clock, { onComplete })));

    clock.advance(STORY_DURATION_MS + 120);

    expect(result.current.progress).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // The loop has stopped: there is no frame outstanding, so time can keep moving without the
    // viewer being told to advance a second time.
    expect(clock.running).toBe(false);
    clock.advance(STORY_DURATION_MS);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('3. pausing freezes progress, and resuming continues from the STORED elapsed', () => {
    const clock = manualClock();
    const { result, rerender } = renderHook(
      (props: { paused: boolean }) => useStoryClock(options(clock, { paused: props.paused })),
      { initialProps: { paused: false } },
    );

    clock.advance(2000);
    expect(result.current.progress).toBeCloseTo(0.4, 10);

    // The hold gesture, an open comment sheet (05-07) and a backgrounded tab all arrive here as
    // this one boolean — which is why there is one mechanism rather than three.
    rerender({ paused: true });
    expect(clock.running).toBe(false);
    clock.advance(3000);
    expect(result.current.progress).toBeCloseTo(0.4, 10);
    expect(result.current.elapsedMs).toBe(2000);

    // Resume: 1 s more of REAL running time lands at 3 s of elapsed, not at 6 s. This is the
    // assertion a CSS animation cannot satisfy.
    rerender({ paused: false });
    clock.advance(1000);
    expect(result.current.elapsedMs).toBe(3000);
    expect(result.current.progress).toBeCloseTo(0.6, 10);
  });

  it('4. skipping to another item resets elapsed to zero — forwards AND backwards', () => {
    const clock = manualClock();
    const { result, rerender } = renderHook(
      (props: { itemKey: string }) => useStoryClock(options(clock, { itemKey: props.itemKey })),
      { initialProps: { itemKey: 'story-a' } },
    );

    clock.advance(3000);
    expect(result.current.elapsedMs).toBe(3000);

    rerender({ itemKey: 'story-b' });
    expect(result.current.progress).toBe(0);
    expect(result.current.elapsedMs).toBe(0);

    clock.advance(1000);
    expect(result.current.elapsedMs).toBe(1000);

    // Stepping BACK is the same reset: the previous story restarts rather than resuming where the
    // member left it, because a segment that resumed half-full would misreport its own position.
    rerender({ itemKey: 'story-a' });
    expect(result.current.elapsedMs).toBe(0);
  });

  it('5. restart() replays the CURRENT item from zero (previous-at-the-first-story)', () => {
    const clock = manualClock();
    const { result } = renderHook(() => useStoryClock(options(clock)));

    clock.advance(4000);
    expect(result.current.elapsedMs).toBe(4000);

    act(() => result.current.restart());
    expect(result.current.progress).toBe(0);
    expect(result.current.elapsedMs).toBe(0);

    clock.advance(500);
    expect(result.current.elapsedMs).toBe(500);
  });

  it('6. a duration that is not known yet never starts the loop (a video before canplay)', () => {
    const clock = manualClock();
    const onComplete = vi.fn();
    const { result } = renderHook(() =>
      useStoryClock(options(clock, { durationMs: 0, onComplete })),
    );

    expect(clock.running).toBe(false);
    clock.advance(10_000);
    expect(result.current.progress).toBe(0);
    expect(onComplete).not.toHaveBeenCalled();
  });
});
