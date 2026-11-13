import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serverClock } from './serverClock';

/**
 * Phase 10.2-11 (OPEN-21, D-788) - the one reader of the device clock of the countdown stack. The
 * offset against the server seed is taken ONCE; `now()` is device time plus that offset.
 */

const DEVICE_START = Date.parse('2026-11-13T12:00:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(DEVICE_START);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('serverClock (OPEN-21)', () => {
  it('estimates the server time as device time plus the offset taken at creation', () => {
    const clock = serverClock(new Date(DEVICE_START + 90_000).toISOString());
    expect(clock.seeded).toBe(true);
    expect(clock.offsetMs).toBe(90_000);
    expect(clock.now()).toBe(DEVICE_START + 90_000);
    vi.advanceTimersByTime(5_000);
    expect(clock.now()).toBe(DEVICE_START + 95_000);
    expect(clock.deviceNow()).toBe(DEVICE_START + 5_000);
  });

  it('computes the offset once: a device clock that jumps moves now() and deviceNow() together', () => {
    const clock = serverClock(new Date(DEVICE_START - 30_000).toISOString());
    expect(clock.offsetMs).toBe(-30_000);
    vi.setSystemTime(DEVICE_START + 24 * 3_600_000);
    expect(clock.offsetMs).toBe(-30_000);
    expect(clock.deviceNow()).toBe(DEVICE_START + 24 * 3_600_000);
    expect(clock.now()).toBe(clock.deviceNow() - 30_000);
  });

  it('reports the same server estimate from a device a day fast, a day slow and in 2099', () => {
    const seed = '2026-11-13T12:00:00.000Z';
    const estimates = [
      DEVICE_START + 86_400_000,
      DEVICE_START - 86_400_000,
      Date.UTC(2099, 0, 1),
    ].map((device) => {
      vi.setSystemTime(device);
      const clock = serverClock(seed);
      vi.advanceTimersByTime(60_000);
      return clock.now();
    });
    expect(estimates).toEqual([
      DEVICE_START + 60_000,
      DEVICE_START + 60_000,
      DEVICE_START + 60_000,
    ]);
  });

  it('a missing or unparseable seed is not seeded and has a zero offset', () => {
    for (const seed of [undefined, null, '', 'not a date']) {
      const clock = serverClock(seed);
      expect(clock.seeded).toBe(false);
      expect(clock.offsetMs).toBe(0);
      expect(clock.now()).toBe(clock.deviceNow());
    }
  });
});
