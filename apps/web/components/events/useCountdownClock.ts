'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { msToNextMinuteChange } from '@/lib/event-countdown';
import { serverClock } from './serverClock';

/** A tick aims a hair past the minute change, so the recomputed value is on the new side of it. */
export const COUNTDOWN_TICK_MARGIN_MS = 10;
/** A tab hidden for MORE than this asks the server for a new seed when it comes back (UI-D-786). */
export const COUNTDOWN_RESEED_AFTER_HIDDEN_MS = 60_000;
/** A restore and a visibility change often arrive together; one return asks for one refresh. */
const SAME_RETURN_WINDOW_MS = 1_000;

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
 * - **Hidden tab.** The timer is cleared on `visibilitychange` to hidden. When the tab is visible again
 *   the value is recomputed at once, a new timer is armed, and if the tab stayed hidden for MORE than
 *   `COUNTDOWN_RESEED_AFTER_HIDDEN_MS` one `router.refresh()` re-seeds the server instant. A
 *   back-forward restore (`pageshow` with `persisted`) re-seeds the same way; one return asks for one
 *   refresh at most.
 *
 * Nothing here reveals a link or decides a state: at zero the count only says it reached zero, and the
 * boundary refresh asks the server (OPEN-24). The component that draws the count is plan 13.
 */
export function useCountdownClock(
  targetIso: string,
  seedIso: string | null | undefined,
): { remainingMs: number | null } {
  const router = useRouter();
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
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? clock.deviceNow() : null;
    let lastReseedAt = Number.NEGATIVE_INFINITY;

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
      if (left > 0 && document.visibilityState !== 'hidden') {
        timer = window.setTimeout(tick, msToNextMinuteChange(left) + COUNTDOWN_TICK_MARGIN_MS);
      }
    };

    const reseed = () => {
      const at = clock.deviceNow();
      if (at - lastReseedAt < SAME_RETURN_WINDOW_MS) return;
      lastReseedAt = at;
      router.refresh();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clear();
        hiddenAt ??= clock.deviceNow();
        return;
      }
      const hiddenFor = hiddenAt === null ? 0 : clock.deviceNow() - hiddenAt;
      hiddenAt = null;
      tick();
      if (hiddenFor > COUNTDOWN_RESEED_AFTER_HIDDEN_MS) reseed();
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      hiddenAt = null;
      tick();
      reseed();
    };

    tick();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clear();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [targetIso, seedIso, key, router]);

  // A changed target or seed shows the value from the new props at once, with no flash of the old one.
  return { remainingMs: counted.key === key ? counted.remainingMs : fromSeed(targetIso, seedIso) };
}
