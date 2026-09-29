// @vitest-environment happy-dom

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `useAssetReadiness` on its own (quick-260929-ka5): the story composer's readiness poll after a
 * video is handed to the provider. What is stubbed is the one server action it calls; what is real
 * is the hook, its timer chain and its stale-answer guards. Fake timers drive the schedule, and
 * every advance goes through `act` + `advanceTimersByTimeAsync` so the awaited answer (a microtask)
 * lands inside the same step as the timer that asked for it.
 */

const { read } = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('@/app/(app)/configuracoes/midia/actions', () => ({
  fetchAssetStatusAction: read,
}));

import {
  READINESS_BACKOFF,
  READINESS_FIRST_DELAY_MS,
  READINESS_MAX_DELAY_MS,
  useAssetReadiness,
} from './useAssetReadiness';

const A = '0b3f0a52-6a0c-4f5e-9c43-6f7c2d0d1a11';
const B = '5d8e2c74-1b9a-4a3e-8f0d-2a6b7c9e4f22';

const pending = { ok: true, status: 'pending', issue: null } as const;
const processing = { ok: true, status: 'processing', issue: null } as const;
const ready = { ok: true, status: 'ready', issue: null } as const;

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  read.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useAssetReadiness — the story composer readiness poll (quick-260929-ka5)', () => {
  it('exports the documented schedule constants', () => {
    expect(READINESS_FIRST_DELAY_MS).toBe(2_000);
    expect(READINESS_BACKOFF).toBe(1.5);
    expect(READINESS_MAX_DELAY_MS).toBe(10_000);
  });

  it('H1: no id is idle and never reads', async () => {
    const { result } = renderHook(() => useAssetReadiness(null));
    expect(result.current).toEqual({ phase: 'idle' });
    await advance(30_000);
    expect(read).not.toHaveBeenCalled();
    expect(result.current).toEqual({ phase: 'idle' });
  });

  it('H2: waits 2 s for the first read, backs off to 3 s, and stops at ready', async () => {
    read.mockResolvedValueOnce(processing).mockResolvedValueOnce(ready);
    const { result } = renderHook(() => useAssetReadiness(A));
    expect(result.current).toEqual({ phase: 'waiting' });

    await advance(1_999);
    expect(read).not.toHaveBeenCalled();
    await advance(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenLastCalledWith(A);
    expect(result.current).toEqual({ phase: 'waiting' });

    await advance(2_999);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ phase: 'ready' });

    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('H3: gaps grow 1.5x from 2 s and are capped at 10 s', async () => {
    const times: number[] = [];
    read.mockImplementation(async () => {
      times.push(Date.now());
      return pending;
    });
    const start = Date.now();
    renderHook(() => useAssetReadiness(A));

    await advance(2_000 + 3_000 + 4_500 + 6_750 + 10_000 + 10_000);
    const gaps = times.map((t, i) => t - (i === 0 ? start : (times[i - 1] ?? start)));
    expect(gaps).toEqual([2_000, 3_000, 4_500, 6_750, 10_000, 10_000]);
  });

  it('H4: failed and rejected are terminal and carry the closed issue', async () => {
    read.mockResolvedValueOnce({ ok: true, status: 'failed', issue: null });
    const failed = renderHook(() => useAssetReadiness(A));
    await advance(2_000);
    expect(failed.result.current).toEqual({ phase: 'failed', issue: null });
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    failed.unmount();

    read.mockReset();
    read.mockResolvedValueOnce({ ok: true, status: 'rejected', issue: 'duration_too_long' });
    const rejected = renderHook(() => useAssetReadiness(B));
    await advance(2_000);
    expect(rejected.result.current).toEqual({ phase: 'failed', issue: 'duration_too_long' });
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('H5: a generic answer or a thrown read keeps waiting on the backoff; notFound is terminal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    read
      .mockResolvedValueOnce({ ok: false, code: 'generic' })
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ ok: false, code: 'notFound' });
    const { result } = renderHook(() => useAssetReadiness(A));

    await advance(2_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ phase: 'waiting' });

    await advance(3_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ phase: 'waiting' });

    await advance(4_499);
    expect(read).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual({ phase: 'failed', issue: null });

    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('H6: an answer landing after unmount schedules nothing and logs nothing', async () => {
    const error = vi.spyOn(console, 'error');
    const inFlight = deferred<typeof processing>();
    read.mockReturnValueOnce(inFlight.promise).mockResolvedValue(processing);
    const { unmount } = renderHook(() => useAssetReadiness(A));

    await advance(2_000);
    expect(read).toHaveBeenCalledTimes(1);
    unmount();

    await act(async () => {
      inFlight.resolve(processing);
    });
    await advance(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("H7: a late answer for the previous id is never read as the current one's", async () => {
    const inFlight = deferred<typeof ready>();
    read.mockReturnValueOnce(inFlight.promise).mockResolvedValue(processing);
    const { result, rerender } = renderHook(({ id }: { id: string }) => useAssetReadiness(id), {
      initialProps: { id: A },
    });

    await advance(2_000);
    expect(read).toHaveBeenCalledWith(A);

    rerender({ id: B });
    await act(async () => {
      inFlight.resolve(ready);
    });
    expect(result.current).toEqual({ phase: 'waiting' });

    await advance(2_000);
    await advance(3_000);
    expect(read.mock.calls.length).toBeGreaterThan(1);
    expect(read.mock.calls.slice(1).every(([id]) => id === B)).toBe(true);
    expect(result.current).toEqual({ phase: 'waiting' });
  });
});
