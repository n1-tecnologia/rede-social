'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** A scheduled refresh lands just AFTER the boundary, so the server's clock is past it too. */
export const BOUNDARY_MARGIN_MS = 1_000;
/** Only a boundary within the next day is scheduled; a longer-lived page refreshes on its own. */
export const BOUNDARY_HORIZON_MS = 24 * 60 * 60 * 1_000;
/**
 * The follow-up refreshes after the boundary one, each measured from the previous refresh, for as
 * long as the server keeps drawing the SAME phase (06 review WR-03). The timer runs on the DEVICE
 * clock and the server decides the phase on ITS clock, so a device running ahead lands its refresh
 * before the server's boundary and gets the old phase back. Nothing else would re-arm the timer then
 * (the instants and the phase are unchanged), so the chain retries: about 52 s of clock skew is
 * covered, and a phase change cancels the rest at once.
 */
export const BOUNDARY_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;

/**
 * UI-D-203, shared by the detail's action zone (`EventActions`) and the shell's tab dots
 * (`TabDotRefresh`, which took over from the Início card's `NextEventRefresh` on 2026-10-03): in
 * an effect, ONE `setTimeout` targets the next of `boundaries` within 24 h
 * and calls `router.refresh()` just after it. If the refreshed page still carries the same `phase`,
 * the chain in `BOUNDARY_RETRY_DELAYS_MS` refreshes again; when `phase` moves, the effect re-runs,
 * which clears whatever is pending and arms the next boundary. Everything is cleared on unmount. The
 * clock is read ONLY inside the effect, never during render (UI-D-14).
 */
export function useBoundaryRefresh(boundaries: readonly string[], phase: string): void {
  const router = useRouter();
  const key = boundaries.join('|');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `phase` is the re-arm trigger, `key` the boundaries
  useEffect(() => {
    const now = Date.now();
    const next = key
      .split('|')
      .map((iso) => Date.parse(iso))
      .filter((ms) => Number.isFinite(ms) && ms > now)
      .reduce<number | null>(
        (soonest, ms) => (soonest === null || ms < soonest ? ms : soonest),
        null,
      );
    if (next === null || next - now > BOUNDARY_HORIZON_MS) return;

    let retry = 0;
    let timer: number;
    const fire = () => {
      router.refresh();
      const delay = BOUNDARY_RETRY_DELAYS_MS[retry];
      retry += 1;
      if (delay !== undefined) timer = window.setTimeout(fire, delay);
    };
    timer = window.setTimeout(fire, next - now + BOUNDARY_MARGIN_MS);
    return () => window.clearTimeout(timer);
  }, [key, phase, router]);
}
