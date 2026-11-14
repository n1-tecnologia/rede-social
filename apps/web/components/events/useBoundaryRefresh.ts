'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { serverClock } from './serverClock';

/** A scheduled refresh lands just AFTER the boundary, so the server's clock is past it too. */
export const BOUNDARY_MARGIN_MS = 1_000;
/**
 * No single wait is longer than a day. A boundary further away is waited for in steps of this size,
 * and the schedule is re-evaluated at the end of each step (a page opened days before the opening
 * still refreshes at the boundary, Phase 10.2 Pitfall 3); only a real boundary refreshes.
 */
export const BOUNDARY_HORIZON_MS = 24 * 60 * 60 * 1_000;
/**
 * The follow-up refreshes after the boundary one, each measured from the previous refresh, for as
 * long as the server keeps drawing the SAME phase (06 review WR-03). The timer runs on the DEVICE
 * clock and the server decides the phase on ITS clock, so a device running ahead lands its refresh
 * before the server's boundary and gets the old phase back. Nothing else would re-arm the timer then
 * (the instants and the phase are unchanged), so the chain retries: about 52 s of clock skew is
 * covered, and a phase change cancels the rest at once. With the server seed of Phase 10.2 the timer
 * runs on the SERVER clock, which removes the skew the chain was written for; the chain stays as a
 * backstop for the seedless callers.
 */
export const BOUNDARY_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;

/**
 * UI-D-203, shared by the detail's action zone (`EventActions`), the shell's tab dots
 * (`TabDotRefresh`, which took over from the Início card's `NextEventRefresh` on 2026-10-03) and, from
 * Phase 10.2, the registration opening: in an effect, ONE `setTimeout` targets the next of
 * `boundaries` and calls `router.refresh()` just after it. If the refreshed page still carries the same
 * `phase`, the chain in `BOUNDARY_RETRY_DELAYS_MS` refreshes again; when `phase` moves, the effect
 * re-runs, which clears whatever is pending and arms the next boundary. Everything is cleared on
 * unmount.
 *
 * **The seed (D-788, D-789).** The optional `serverNowIso` is the server's own instant taken at render.
 * With it the boundaries are scheduled against the server clock (`serverClock`), so a wrong device
 * clock still refreshes at the right instant; without it the offset is zero and the schedule is the
 * device time, as it always was. A new seed re-evaluates the schedule, and a re-render with the SAME
 * `phase` (the refresh itself brings a new seed) carries the retry chain on instead of restarting it.
 *
 * **Far boundaries.** Each wait is capped at `BOUNDARY_HORIZON_MS`; when a capped wait ends and the
 * boundary is still ahead, the schedule is re-evaluated without refreshing.
 *
 * The hook only asks the server (OPEN-24): it holds no link and decides no state. The device clock is
 * read ONLY through `serverClock`, inside the effect, never during render (UI-D-14).
 */
export function useBoundaryRefresh(
  boundaries: readonly string[],
  phase: string,
  serverNowIso?: string | null,
): void {
  const router = useRouter();
  const key = boundaries.join('|');
  /** The refreshes already asked for the current phase and boundaries; survives a seed re-render. */
  const chain = useRef<{ id: string; refreshes: number } | null>(null);

  useEffect(() => {
    const clock = serverClock(serverNowIso);
    const instants = key
      .split('|')
      .map((iso) => Date.parse(iso))
      .filter((ms) => Number.isFinite(ms));
    const id = `${phase}#${key}`;
    let timer: number | undefined;

    const fire = () => {
      const current = chain.current?.id === id ? chain.current : { id, refreshes: 0 };
      chain.current = current;
      router.refresh();
      current.refreshes += 1;
      retry();
    };

    /** The next retry of the chain, measured from the last refresh; false when the chain is over. */
    const retry = () => {
      const delay = BOUNDARY_RETRY_DELAYS_MS[(chain.current?.refreshes ?? 0) - 1];
      if (delay === undefined) return false;
      timer = window.setTimeout(fire, delay);
      return true;
    };

    const arm = () => {
      const now = clock.now();
      const next = instants.reduce<number | null>(
        (soonest, ms) => (ms > now && (soonest === null || ms < soonest) ? ms : soonest),
        null,
      );
      if (next === null) return;
      const wait = next - now;
      timer =
        wait > BOUNDARY_HORIZON_MS
          ? window.setTimeout(arm, BOUNDARY_HORIZON_MS)
          : window.setTimeout(fire, wait + BOUNDARY_MARGIN_MS);
    };

    if (chain.current?.id === id) {
      // Same phase and boundaries: the refresh brought the same phase back with a new seed, so carry
      // the chain on; once it is over, look for the next boundary.
      if (!retry()) {
        chain.current = null;
        arm();
      }
    } else {
      chain.current = null;
      arm();
    }
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [key, phase, serverNowIso, router]);
}
