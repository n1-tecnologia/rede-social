'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** A scheduled refresh lands just AFTER the boundary, so the server's clock is past it too. */
const BOUNDARY_MARGIN_MS = 1_000;
/** Only a boundary within the next day is scheduled; a longer-lived page refreshes on its own. */
const BOUNDARY_HORIZON_MS = 24 * 60 * 60 * 1_000;

export interface NextEventRefreshProps {
  /** ISO instants (`checkinOpensAt`, `startsAt`, `endsAt`) computed on the server. */
  boundaries: readonly string[];
  /** The phase the server drew: the re-arm trigger once a refresh lands (the instants stay put). */
  phase: string;
}

/**
 * UI-D-203 on Início (06-08, D-202): the "Próximo evento" card's boundary refresh. It renders
 * NOTHING. In an effect it schedules ONE `setTimeout` at the next of the card's boundaries within
 * 24 h and calls `router.refresh()` there, so a member standing at the venue with Início open sees
 * "Fazer check-in" (or `Entrar`) appear below the row when the window opens, without pulling to
 * refresh. The timer is cleared on unmount and re-armed when the server's `phase` moves. The clock is
 * read ONLY inside the effect, never during render (UI-D-14): every string the card shows was built
 * on the server.
 */
export function NextEventRefresh({ boundaries, phase }: NextEventRefreshProps) {
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
    const timer = window.setTimeout(() => router.refresh(), next - now + BOUNDARY_MARGIN_MS);
    return () => window.clearTimeout(timer);
  }, [key, phase, router]);

  return null;
}
