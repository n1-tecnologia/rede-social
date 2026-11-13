'use client';

import { useEffect, useState } from 'react';
import { msToNextMinuteChange } from '@/lib/event-countdown';
import { serverClock } from './serverClock';

/** A tick aims a hair past the minute change, so the recomputed value is on the new side of it. */
export const COUNTDOWN_TICK_MARGIN_MS = 10;

/** The remaining time from the props alone, never from a clock: `null` when the seed is missing. */
function fromSeed(targetIso: string, seedIso: string | null | undefined): number | null {
  const target = Date.parse(targetIso);
  const seed = seedIso ? Date.parse(seedIso) : Number.NaN;
  if (!Number.isFinite(target) || !Number.isFinite(seed)) return null;
  return target - seed;
}

interface Counted {
  key: string;
  remainingMs: number | null;
}

/**
 * The remaining time of a countdown (Phase 10.2, OPEN-21, OPEN-24, D-788, D-789, UI-D-786).
 *
 * - **First render from the props.** `target minus seed`, so the server render and the first client
 *   render are the same string and nothing reads a clock during render. No seed (or a target that does
 *   not parse) is `null`: a missing seed draws no count and never falls back to the device clock.
 * - **One timeout per instance, no interval.** After mount an effect builds the server clock
 *   (`serverClock`, the single reader of the device clock) and arms ONE `setTimeout` aimed at the next
 *   minute change (`msToNextMinuteChange` plus a small margin). Every time it fires the whole value is
 *   recomputed from the server clock, never stepped by a fixed amount, and the timer is re-armed. At
 *   zero (or below) nothing is armed.
 *
 * Nothing here reveals a link or decides a state: at zero the count only says it reached zero, and the
 * boundary refresh asks the server (OPEN-24). The component that draws the count is plan 13.
 */
export function useCountdownClock(
  targetIso: string,
  seedIso: string | null | undefined,
): { remainingMs: number | null } {
  const key = `${targetIso}|${seedIso ?? ''}`;
  const [counted, setCounted] = useState<Counted>(() => ({
    key,
    remainingMs: fromSeed(targetIso, seedIso),
  }));

  useEffect(() => {
    const target = Date.parse(targetIso);
    const clock = serverClock(seedIso);
    if (!clock.seeded || !Number.isFinite(target)) return;

    let timer: number | undefined;
    const clear = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    /** Recomputes the whole value from the server clock; arms the next tick only while it can matter. */
    const tick = () => {
      clear();
      const left = target - clock.now();
      setCounted((previous) =>
        previous.key === key && previous.remainingMs === left
          ? previous
          : { key, remainingMs: left },
      );
      if (left > 0) {
        timer = window.setTimeout(tick, msToNextMinuteChange(left) + COUNTDOWN_TICK_MARGIN_MS);
      }
    };

    tick();
    return () => {
      clear();
    };
  }, [targetIso, seedIso, key]);

  // A changed target or seed shows the value from the new props at once, with no flash of the old one.
  return { remainingMs: counted.key === key ? counted.remainingMs : fromSeed(targetIso, seedIso) };
}
