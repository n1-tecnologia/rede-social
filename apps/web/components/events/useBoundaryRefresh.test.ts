// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BOUNDARY_HORIZON_MS,
  BOUNDARY_MARGIN_MS,
  BOUNDARY_RETRY_DELAYS_MS,
  useBoundaryRefresh,
} from './useBoundaryRefresh';

/**
 * Phase 10.2-11 (D-788, D-789, OPEN-10, EP-24, EP-25, T-10.2-01, T-10.2-06) - the boundary refresh that
 * follows the server clock when a seed is given and arms for a page opened days before the boundary.
 * Without a seed it behaves as shipped (UI-D-203, 06 review WR-03). Everything runs on fake timers.
 */

const refresh = vi.fn();
const router = { refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const SEED = '2026-11-13T12:00:00.000Z';
const SEED_MS = Date.parse(SEED);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  refresh.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('useBoundaryRefresh without a seed (as shipped)', () => {
  it('refreshes once just after the next boundary within 24 h, and not one step before', () => {
    vi.setSystemTime(SEED_MS);
    renderHook(() => useBoundaryRefresh([iso(SEED_MS + 30 * MINUTE)], 'p0'));
    advance(30 * MINUTE + BOUNDARY_MARGIN_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('retries after 2, 5, 15 and 30 s while the phase is unchanged, and stops after five', () => {
    expect(BOUNDARY_RETRY_DELAYS_MS).toEqual([2_000, 5_000, 15_000, 30_000]);
    vi.setSystemTime(SEED_MS);
    renderHook(() => useBoundaryRefresh([iso(SEED_MS + 10 * MINUTE)], 'p0'));
    advance(10 * MINUTE + BOUNDARY_MARGIN_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    advance(5_000);
    expect(refresh).toHaveBeenCalledTimes(3);
    advance(15_000);
    expect(refresh).toHaveBeenCalledTimes(4);
    advance(30_000);
    expect(refresh).toHaveBeenCalledTimes(5);
    advance(HOUR);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it('a changed phase cancels the chain and re-arms for the next boundary', () => {
    vi.setSystemTime(SEED_MS);
    const boundaries = [iso(SEED_MS + 10 * MINUTE), iso(SEED_MS + 70 * MINUTE)];
    const view = renderHook(({ phase }) => useBoundaryRefresh(boundaries, phase), {
      initialProps: { phase: 'p0' },
    });
    advance(10 * MINUTE + BOUNDARY_MARGIN_MS);
    advance(2_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    view.rerender({ phase: 'p1' });
    advance(10_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    // 70 min plus the margin, counted from the start: 10 min + 1 s + 2 s + 10 s are already behind.
    advance(60 * MINUTE - 13_000 + BOUNDARY_MARGIN_MS - 1);
    expect(refresh).toHaveBeenCalledTimes(2);
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('unmount cancels the boundary timer and the retry chain', () => {
    vi.setSystemTime(SEED_MS);
    const view = renderHook(() => useBoundaryRefresh([iso(SEED_MS + 10 * MINUTE)], 'p0'));
    advance(10 * MINUTE + BOUNDARY_MARGIN_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    view.unmount();
    advance(HOUR);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a boundary more than 24 h away is no longer dropped: a page opened days earlier still refreshes', () => {
    expect(BOUNDARY_HORIZON_MS).toBe(DAY);
    vi.setSystemTime(SEED_MS);
    renderHook(() => useBoundaryRefresh([iso(SEED_MS + 3 * DAY)], 'p0'));
    advance(3 * DAY + BOUNDARY_MARGIN_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('no boundary, only passed ones and unparseable ones arm nothing', () => {
    vi.setSystemTime(SEED_MS);
    renderHook(() => useBoundaryRefresh([], 'p0'));
    renderHook(() => useBoundaryRefresh([iso(SEED_MS - HOUR), 'nope'], 'p0'));
    expect(vi.getTimerCount()).toBe(0);
    advance(2 * DAY);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('useBoundaryRefresh with the server seed (D-788, EP-24, EP-25)', () => {
  const BOUNDARY = SEED_MS + 30 * MINUTE;

  it.each([
    ['a day fast', SEED_MS + DAY],
    ['a day slow', SEED_MS - DAY],
    ['in 2099', Date.UTC(2099, 5, 1)],
    ['right', SEED_MS],
  ])(
    'with the device clock %s, one refresh at the server boundary plus the margin',
    (_name, device) => {
      vi.setSystemTime(device);
      renderHook(() => useBoundaryRefresh([iso(BOUNDARY)], 'p0', SEED));
      advance(30 * MINUTE - 1);
      expect(refresh).not.toHaveBeenCalled();
      // The boundary itself and one millisecond before the margin: still nothing (EP-24).
      advance(1 + BOUNDARY_MARGIN_MS - 1);
      expect(refresh).not.toHaveBeenCalled();
      advance(1);
      expect(refresh).toHaveBeenCalledTimes(1);
    },
  );

  it('a seed older than the device clock never fires before the server boundary', () => {
    // The device reads 30 s after the seed; a device-clock schedule would fire 30 s early.
    vi.setSystemTime(SEED_MS + 30_000);
    renderHook(() => useBoundaryRefresh([iso(BOUNDARY)], 'p0', SEED));
    advance(30 * MINUTE + BOUNDARY_MARGIN_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a target three days away refreshes once at the boundary, after two horizon re-arms and none before', () => {
    vi.setSystemTime(SEED_MS + DAY);
    const target = SEED_MS + 3 * DAY;
    renderHook(() => useBoundaryRefresh([iso(target)], 'p0', SEED));
    expect(vi.getTimerCount()).toBe(1);
    advance(DAY);
    expect(refresh).not.toHaveBeenCalled();
    advance(DAY);
    expect(refresh).not.toHaveBeenCalled();
    advance(DAY + BOUNDARY_MARGIN_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('with several boundaries the soonest future one is used and a passed one is ignored', () => {
    vi.setSystemTime(SEED_MS);
    renderHook(() =>
      useBoundaryRefresh(
        [iso(SEED_MS - HOUR), iso(SEED_MS + 2 * HOUR), iso(SEED_MS + 20 * MINUTE)],
        'p0',
        SEED,
      ),
    );
    advance(20 * MINUTE + BOUNDARY_MARGIN_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a changed seed re-evaluates against the new offset', () => {
    vi.setSystemTime(SEED_MS);
    const boundaries = [iso(BOUNDARY)];
    const view = renderHook(({ seed }) => useBoundaryRefresh(boundaries, 'p0', seed), {
      initialProps: { seed: SEED },
    });
    // The server says it is 20 minutes later than the first seed said: 10 minutes remain.
    view.rerender({ seed: iso(SEED_MS + 20 * MINUTE) });
    advance(10 * MINUTE + BOUNDARY_MARGIN_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the retry chain survives the re-render the refresh itself causes, and stays bounded at five', () => {
    vi.setSystemTime(SEED_MS);
    const boundaries = [iso(SEED_MS + 10 * MINUTE), iso(SEED_MS + 70 * MINUTE)];
    const view = renderHook(({ seed }) => useBoundaryRefresh(boundaries, 'p0', seed), {
      initialProps: { seed: SEED },
    });
    let elapsed = 0;
    const step = (ms: number) => {
      advance(ms);
      elapsed += ms;
      // The refresh brings the same phase back with a fresh seed.
      view.rerender({ seed: iso(SEED_MS + elapsed) });
    };
    step(10 * MINUTE + BOUNDARY_MARGIN_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    for (const [index, delay] of BOUNDARY_RETRY_DELAYS_MS.entries()) {
      step(delay);
      expect(refresh).toHaveBeenCalledTimes(index + 2);
    }
    // The chain is over: the last re-render armed the next boundary, nothing else fires before it.
    const untilNext = 70 * MINUTE + BOUNDARY_MARGIN_MS - elapsed;
    advance(untilNext - 1);
    expect(refresh).toHaveBeenCalledTimes(5);
    advance(1);
    expect(refresh).toHaveBeenCalledTimes(6);
  });

  it('a changed phase key clears everything and re-arms', () => {
    vi.setSystemTime(SEED_MS);
    const view = renderHook(({ phase }) => useBoundaryRefresh([iso(BOUNDARY)], phase, SEED), {
      initialProps: { phase: 'sale:closed' },
    });
    view.rerender({ phase: 'sale:open' });
    expect(vi.getTimerCount()).toBe(1);
    advance(30 * MINUTE + BOUNDARY_MARGIN_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('refreshes at most once per boundary beyond the bounded chain (no storm)', () => {
    vi.setSystemTime(SEED_MS);
    renderHook(() => useBoundaryRefresh([iso(BOUNDARY)], 'p0', SEED));
    advance(DAY);
    expect(refresh).toHaveBeenCalledTimes(1 + BOUNDARY_RETRY_DELAYS_MS.length);
  });
});
