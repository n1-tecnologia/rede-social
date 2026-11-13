// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COUNTDOWN_RESEED_AFTER_HIDDEN_MS,
  COUNTDOWN_TICK_MARGIN_MS,
  useCountdownClock,
} from './useCountdownClock';

/**
 * Phase 10.2-11 (OPEN-21, OPEN-24, D-788, EP-25, T-10.2-01, T-10.2-06) - the seeded, single-timeout,
 * hidden-tab-aware remaining-time hook. Fake timers drive the clock; the device clock is moved a day
 * fast, a day slow and to 2099 to prove the count follows the SERVER seed only.
 */

const refresh = vi.fn();
const router = { refresh };
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const SEED = '2026-11-13T12:00:00.000Z';
const SEED_MS = Date.parse(SEED);
/** Thirteen minutes forty seconds after the seed. */
const TARGET_MS = SEED_MS + 13 * 60_000 + 40_000;
const TARGET = new Date(TARGET_MS).toISOString();

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  refresh.mockReset();
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function setDevice(ms: number) {
  vi.setSystemTime(ms);
}

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** happy-dom's `PageTransitionEvent` drops `persisted`, so the flag is set on a plain event. */
function pageshow(persisted: boolean) {
  return Object.assign(new Event('pageshow'), { persisted });
}

function Probe({ target, seed }: { target: string; seed: string | null }) {
  const { remainingMs } = useCountdownClock(target, seed);
  return createElement('span', null, String(remainingMs));
}

describe('useCountdownClock first render (D-788, hydration)', () => {
  it('computes target minus seed from the props alone, with no timer and no effect', () => {
    setDevice(Date.parse('2099-01-01T00:00:00.000Z'));
    const html = renderToString(createElement(Probe, { target: TARGET, seed: SEED }));
    expect(html).toContain(String(TARGET_MS - SEED_MS));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('the first client render equals the server string whatever the device clock says', () => {
    const server = renderToString(createElement(Probe, { target: TARGET, seed: SEED }));
    setDevice(SEED_MS + 86_400_000);
    const first = renderHook(() => useCountdownClock(TARGET, SEED));
    expect(first.result.current.remainingMs).toBe(TARGET_MS - SEED_MS);
    expect(server).toContain(String(first.result.current.remainingMs));
  });

  it('no seed: remainingMs is null, nothing falls back to the device clock and no timer is armed', () => {
    const view = renderHook(() => useCountdownClock(TARGET, null));
    expect(view.result.current.remainingMs).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(view.result.current.remainingMs).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an unparseable target is null too', () => {
    const view = renderHook(() => useCountdownClock('nope', SEED));
    expect(view.result.current.remainingMs).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useCountdownClock ticking (OPEN-21)', () => {
  /** Advances minute by minute and records the displayed minute count after each step. */
  function minutesAfterEachStep(device: number) {
    setDevice(device);
    const view = renderHook(() => useCountdownClock(TARGET, SEED));
    const seen: Array<number | null> = [view.result.current.remainingMs];
    const timers: number[] = [vi.getTimerCount()];
    for (let step = 0; step < 15; step += 1) {
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      seen.push(view.result.current.remainingMs);
      timers.push(vi.getTimerCount());
    }
    return { seen, timers };
  }

  it('follows target minus server now once per minute change, with at most one timer and no interval', () => {
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const windowIntervalSpy = vi.spyOn(window, 'setInterval');
    const { seen, timers } = minutesAfterEachStep(SEED_MS);
    expect(Math.max(...timers)).toBeLessThanOrEqual(1);
    expect(intervalSpy).not.toHaveBeenCalled();
    expect(windowIntervalSpy).not.toHaveBeenCalled();
    // 13 min 40 s: the count starts on 13 minutes, then 12, 11, ...
    expect(Math.floor((seen[0] ?? 0) / 60_000)).toBe(13);
    expect(Math.floor((seen[1] ?? 0) / 60_000)).toBe(12);
    expect(Math.floor((seen[8] ?? 0) / 60_000)).toBe(5);
    // After the target it is zero or below and there is no timer left.
    expect(seen.at(-1)).toBeLessThanOrEqual(0);
    expect(timers.at(-1)).toBe(0);
  });

  it('shows the same values at every step with the device clock a day fast, a day slow and in 2099', () => {
    const real = minutesAfterEachStep(SEED_MS);
    const fast = minutesAfterEachStep(SEED_MS + 86_400_000);
    cleanup();
    const slow = minutesAfterEachStep(SEED_MS - 86_400_000);
    cleanup();
    const far = minutesAfterEachStep(Date.UTC(2099, 5, 1));
    expect(fast.seen).toEqual(real.seen);
    expect(slow.seen).toEqual(real.seen);
    expect(far.seen).toEqual(real.seen);
  });

  it('reaches zero at the server target, never before, even with a seed 30 s older than the device clock', () => {
    // The device clock reads 30 s after the seed: a naive device-clock count would hit zero early.
    setDevice(SEED_MS + 30_000);
    const view = renderHook(() => useCountdownClock(TARGET, SEED));
    expect(view.result.current.remainingMs).toBe(TARGET_MS - SEED_MS);
    // One millisecond before the target (server time): still a positive count, last minute.
    act(() => {
      vi.advanceTimersByTime(TARGET_MS - SEED_MS - 1);
    });
    expect(view.result.current.remainingMs).toBeGreaterThan(0);
    expect(view.result.current.remainingMs).toBeLessThanOrEqual(60_000);
    // The timer aims just past the target: once it fires the count is zero or below.
    act(() => {
      vi.advanceTimersByTime(2 + COUNTDOWN_TICK_MARGIN_MS);
    });
    expect(view.result.current.remainingMs).toBeLessThanOrEqual(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a target 1 ms after the seed is the last minute, then zero, then no timer', () => {
    const target = new Date(SEED_MS + 1).toISOString();
    const view = renderHook(() => useCountdownClock(target, SEED));
    expect(view.result.current.remainingMs).toBe(1);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      vi.advanceTimersByTime(2 + COUNTDOWN_TICK_MARGIN_MS);
    });
    expect(view.result.current.remainingMs).toBeLessThanOrEqual(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a target already past is zero or below and arms nothing', () => {
    const target = new Date(SEED_MS - 5_000).toISOString();
    const view = renderHook(() => useCountdownClock(target, SEED));
    expect(view.result.current.remainingMs).toBe(-5_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a refreshed seed recomputes against the new offset, with no flash of the old value', () => {
    const view = renderHook(({ seed }) => useCountdownClock(TARGET, seed), {
      initialProps: { seed: SEED },
    });
    const later = new Date(SEED_MS + 5 * 60_000).toISOString();
    view.rerender({ seed: later });
    expect(view.result.current.remainingMs).toBe(TARGET_MS - (SEED_MS + 5 * 60_000));
    expect(vi.getTimerCount()).toBe(1);
  });

  it('unmount clears the timer', () => {
    const view = renderHook(() => useCountdownClock(TARGET, SEED));
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('useCountdownClock hidden tab (OPEN-21, A-UI-12)', () => {
  it('clears the timer on hidden and runs no tick while hidden, even ten minutes later', () => {
    const view = renderHook(() => useCountdownClock(TARGET, SEED));
    const before = view.result.current.remainingMs;
    expect(vi.getTimerCount()).toBe(1);
    setVisibility('hidden');
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(view.result.current.remainingMs).toBe(before);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recomputes AT ONCE on visible, before any timer elapses, and arms one new timer', () => {
    const view = renderHook(() => useCountdownClock(TARGET, SEED));
    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    const stale = view.result.current.remainingMs;
    setVisibility('visible');
    expect(view.result.current.remainingMs).toBe((stale ?? 0) - 10 * 60_000);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('asks for exactly one refresh after more than 60 s hidden, and none at exactly 60 s', () => {
    expect(COUNTDOWN_RESEED_AFTER_HIDDEN_MS).toBe(60_000);
    renderHook(() => useCountdownClock(TARGET, SEED));

    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    setVisibility('visible');
    expect(refresh).not.toHaveBeenCalled();

    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a second visible event without a new hide does not refresh again', () => {
    renderHook(() => useCountdownClock(TARGET, SEED));
    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    setVisibility('visible');
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a pageshow with persisted true re-seeds once; with persisted false it does nothing', () => {
    renderHook(() => useCountdownClock(TARGET, SEED));
    act(() => {
      window.dispatchEvent(pageshow(false));
    });
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(pageshow(true));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('a back-forward restore that fires visibilitychange and pageshow asks once', () => {
    renderHook(() => useCountdownClock(TARGET, SEED));
    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    setVisibility('visible');
    act(() => {
      window.dispatchEvent(pageshow(true));
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('mounting while hidden arms no timer; becoming visible later arms one', () => {
    visibility = 'hidden';
    renderHook(() => useCountdownClock(TARGET, SEED));
    expect(vi.getTimerCount()).toBe(0);
    setVisibility('visible');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('unmount removes the listeners, clears the timer and refreshes nothing afterwards', () => {
    const spies = {
      docAdd: vi.spyOn(document, 'addEventListener'),
      docRemove: vi.spyOn(document, 'removeEventListener'),
      winAdd: vi.spyOn(window, 'addEventListener'),
      winRemove: vi.spyOn(window, 'removeEventListener'),
    };
    const net = (add: keyof typeof spies, remove: keyof typeof spies, type: string) =>
      spies[add].mock.calls.filter(([t]) => t === type).length -
      spies[remove].mock.calls.filter(([t]) => t === type).length;
    const added = {
      get: (name: string) =>
        name === 'document:visibilitychange'
          ? net('docAdd', 'docRemove', 'visibilitychange')
          : net('winAdd', 'winRemove', 'pageshow'),
    };

    const view = renderHook(() => useCountdownClock(TARGET, SEED));
    expect(added.get('document:visibilitychange')).toBe(1);
    expect(added.get('window:pageshow')).toBe(1);
    view.unmount();
    expect(added.get('document:visibilitychange')).toBe(0);
    expect(added.get('window:pageshow')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    vi.advanceTimersByTime(5 * 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(pageshow(true));
    expect(refresh).not.toHaveBeenCalled();
  });
});
