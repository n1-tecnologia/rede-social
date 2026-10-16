// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useWindowRefresh,
  WINDOW_REFRESH_GRACE_MS,
  WINDOW_REFRESH_MAX_MS,
  type WindowRefreshInput,
  windowRefreshDelay,
} from './useWindowRefresh';

/**
 * 08.5-09 — the live page's refresh timer (UI-D-436, D-432, T-08.5-32, planning decision 3).
 *
 * The claims a later edit could quietly break:
 *  1. The delay is the next window edge minus the SERVER's `serverNow` (plus the grace), so a wrong
 *     device clock cannot move it: the browser clock is never read.
 *  2. The edges are taken in order — `joinOpensAt`, then `startsAt`, then `endsAt` — and an edge AT
 *     `serverNow` already passed (the server's window is half-open).
 *  3. One wait is capped at 24 h; after the last edge nothing is scheduled.
 *  4. The hook calls `router.refresh()` exactly when the delay elapses, never before, and once.
 */

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const MIN = 60_000;
const START = Date.parse('2026-10-22T22:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

/** A 60-minute live starting at START, read by the server at `now`. */
function input(now: number): WindowRefreshInput {
  return {
    joinOpensAt: iso(START - 15 * MIN),
    startsAt: iso(START),
    endsAt: iso(START + 60 * MIN),
    serverNow: iso(now),
  };
}

describe('windowRefreshDelay (pure)', () => {
  it('before the window: waits for joinOpensAt − serverNow (+ grace)', () => {
    expect(windowRefreshDelay(input(START - 2 * 60 * MIN))).toBe(
      105 * MIN + WINDOW_REFRESH_GRACE_MS,
    );
  });

  it('inside the window before the start: waits for the start', () => {
    expect(windowRefreshDelay(input(START - 10 * MIN))).toBe(10 * MIN + WINDOW_REFRESH_GRACE_MS);
  });

  it('on air: waits for endsAt − serverNow', () => {
    expect(windowRefreshDelay(input(START + 20 * MIN))).toBe(40 * MIN + WINDOW_REFRESH_GRACE_MS);
  });

  it('an edge AT serverNow has passed: the next one is chosen', () => {
    expect(windowRefreshDelay(input(START - 15 * MIN))).toBe(15 * MIN + WINDOW_REFRESH_GRACE_MS);
  });

  it('without startsAt the edges are joinOpensAt and endsAt only', () => {
    const { startsAt: _drop, ...noStart } = input(START - 10 * MIN);
    expect(windowRefreshDelay(noStart)).toBe(70 * MIN + WINDOW_REFRESH_GRACE_MS);
  });

  it('caps one wait at 24 h (a live a week away)', () => {
    expect(windowRefreshDelay(input(START - 7 * 24 * 60 * MIN))).toBe(WINDOW_REFRESH_MAX_MS);
  });

  it('after the end, or AT it, nothing is scheduled', () => {
    expect(windowRefreshDelay(input(START + 60 * MIN))).toBeNull();
    expect(windowRefreshDelay(input(START + 3 * 60 * MIN))).toBeNull();
  });

  it('an unreadable serverNow schedules nothing', () => {
    expect(windowRefreshDelay({ ...input(START), serverNow: 'not a date' })).toBeNull();
  });

  it('reads no browser clock: a device clock days off changes nothing', () => {
    vi.useFakeTimers({ now: START + 10 * 24 * 60 * MIN });
    try {
      expect(windowRefreshDelay(input(START - 2 * 60 * MIN))).toBe(
        105 * MIN + WINDOW_REFRESH_GRACE_MS,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useWindowRefresh (fake timers)', () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('refreshes once, exactly at the window edge from the serverNow delta', () => {
    renderHook(() => useWindowRefresh(input(START - 20 * MIN)));
    advance(5 * MIN + WINDOW_REFRESH_GRACE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(24 * 60 * MIN);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('re-arms from the next answer: a new serverNow schedules the next edge (the end)', () => {
    const { rerender } = renderHook(({ at }) => useWindowRefresh(input(at)), {
      initialProps: { at: START + 1 * MIN },
    });
    advance(59 * MIN + WINDOW_REFRESH_GRACE_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender({ at: START + 60 * MIN + WINDOW_REFRESH_GRACE_MS });
    advance(24 * 60 * MIN);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('caps the wait at 24 h, then refreshes to re-arm', () => {
    renderHook(() => useWindowRefresh(input(START - 3 * 24 * 60 * MIN)));
    advance(WINDOW_REFRESH_MAX_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('nothing is scheduled after the end, or for a page that needs no timer (null)', () => {
    renderHook(() => useWindowRefresh(input(START + 2 * 60 * MIN)));
    renderHook(() => useWindowRefresh(null));
    advance(48 * 60 * MIN);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('an unmounted page cancels its timer', () => {
    const { unmount } = renderHook(() => useWindowRefresh(input(START - 20 * MIN)));
    unmount();
    advance(60 * MIN);
    expect(refresh).not.toHaveBeenCalled();
  });
});
