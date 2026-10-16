import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgressReporter, PROGRESS_TICK_MS, wholePosition } from './progress-reporter';

/**
 * 08.5-08 — the lesson player's progress cadence (D-427, UI-D-433, R-Pitfall 10, T-08.5-12): at most
 * one tick per 15-second window while playing, a pause and the end at once, integer positions only.
 * The clock is the fake timers' `Date.now`, so the windows are exact.
 */

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

function reporter() {
  const send = vi.fn();
  const r = createProgressReporter({ send, now: () => Date.now() });
  return { send, r };
}

describe('createProgressReporter (D-427, UI-D-433)', () => {
  it('the window is 15 seconds', () => {
    expect(PROGRESS_TICK_MS).toBe(15000);
  });

  it('ten ticks inside 15 s send once (the first)', () => {
    const { send, r } = reporter();
    for (let second = 0; second < 10; second += 1) {
      r.onProgress(second, 'tick');
      vi.advanceTimersByTime(1000);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(0, 'tick');
  });

  it('a tick sends again only once the window has passed, with the latest position', () => {
    const { send, r } = reporter();
    r.onProgress(1, 'tick');
    vi.advanceTimersByTime(PROGRESS_TICK_MS - 1);
    r.onProgress(15, 'tick');
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    r.onProgress(16, 'tick');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(16, 'tick');
  });

  it('a pause sends at once, even right after a tick', () => {
    const { send, r } = reporter();
    r.onProgress(3, 'tick');
    vi.advanceTimersByTime(2000);
    r.onProgress(5, 'pause');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(5, 'pause');
  });

  it('ended sends at once, even right after a pause', () => {
    const { send, r } = reporter();
    r.onProgress(98, 'pause');
    r.onProgress(100, 'ended');
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(100, 'ended');
  });

  it('a pause opens a new window: the next tick inside it is dropped', () => {
    const { send, r } = reporter();
    r.onProgress(10, 'pause');
    vi.advanceTimersByTime(5000);
    r.onProgress(11, 'tick');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('positions leave as integers ≥ 0, and the last one seen is kept for the beacon', () => {
    const { send, r } = reporter();
    expect(r.lastPosition()).toBeNull();
    r.onProgress(42.9, 'tick');
    expect(send).toHaveBeenLastCalledWith(42, 'tick');
    r.onProgress(50.4, 'tick'); // dropped by the window…
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.lastPosition()).toBe(50); // …but the beacon still sends the latest place
    r.onProgress(-3, 'pause');
    expect(send).toHaveBeenLastCalledWith(0, 'pause');
    r.onProgress(Number.NaN, 'ended');
    expect(send).toHaveBeenLastCalledWith(0, 'ended');
  });

  it('wholePosition floors and refuses NaN, Infinity and negatives', () => {
    expect(wholePosition(12.7)).toBe(12);
    expect(wholePosition(-1)).toBe(0);
    expect(wholePosition(Number.NaN)).toBe(0);
    expect(wholePosition(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
