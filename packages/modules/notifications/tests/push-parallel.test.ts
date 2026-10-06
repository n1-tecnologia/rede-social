import { describe, expect, it, vi } from 'vitest';
import { mapWithConcurrency } from '../server/push/parallel';

/**
 * quick 261006-fs9: the bounded parallel map the push send job uses. Results keep input order, the
 * in-flight count never passes the (clamped) limit and reaches it when there is enough work, an empty
 * list never calls `fn`, and a rejecting `fn` rejects the call.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function tracked<T, R>(fn: (item: T, index: number) => Promise<R>) {
  const state = { current: 0, max: 0, calls: 0 };
  const wrapped = async (item: T, index: number): Promise<R> => {
    state.calls += 1;
    state.current += 1;
    state.max = Math.max(state.max, state.current);
    try {
      return await fn(item, index);
    } finally {
      state.current -= 1;
    }
  };
  return { wrapped, state };
}

describe('mapWithConcurrency', () => {
  it('keeps input order under randomised per-item delays', async () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const result = await mapWithConcurrency(items, 7, async (item, index) => {
      await sleep(Math.floor(Math.random() * 5));
      return `${item}:${index}`;
    });
    expect(result).toEqual(items.map((i) => `${i}:${i}`));
  });

  it('never exceeds the limit, and reaches it when the items exceed it', async () => {
    const { wrapped, state } = tracked(async (item: number) => {
      await sleep(1 + (item % 3));
      return item * 2;
    });
    const items = Array.from({ length: 50 }, (_, i) => i);
    const result = await mapWithConcurrency(items, 5, wrapped);
    expect(result).toEqual(items.map((i) => i * 2));
    expect(state.calls).toBe(50);
    expect(state.max).toBe(5);
  });

  it('clamps a limit larger than the list to the list length', async () => {
    const { wrapped, state } = tracked(async (item: number) => {
      await sleep(1);
      return item;
    });
    const result = await mapWithConcurrency([1, 2, 3], 100, wrapped);
    expect(result).toEqual([1, 2, 3]);
    expect(state.max).toBe(3);
  });

  it.each([0, -3, 0.4, Number.NaN])('clamps limit %s to one call at a time', async (limit) => {
    const { wrapped, state } = tracked(async (item: number) => {
      await sleep(1);
      return item + 1;
    });
    const result = await mapWithConcurrency([1, 2, 3, 4], limit, wrapped);
    expect(result).toEqual([2, 3, 4, 5]);
    expect(state.max).toBe(1);
  });

  it('floors a fractional limit', async () => {
    const { wrapped, state } = tracked(async (item: number) => {
      await sleep(1);
      return item;
    });
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2.9, wrapped);
    expect(state.max).toBe(2);
  });

  it('returns [] for an empty list without calling fn', async () => {
    const fn = vi.fn(async () => 1);
    await expect(mapWithConcurrency([], 4, fn)).resolves.toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects the call when fn rejects', async () => {
    const boom = new Error('boom');
    await expect(
      mapWithConcurrency([1, 2, 3, 4], 2, async (item) => {
        await sleep(1);
        if (item === 3) throw boom;
        return item;
      }),
    ).rejects.toBe(boom);
  });
});
