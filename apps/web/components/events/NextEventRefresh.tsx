'use client';

import { useBoundaryRefresh } from './useBoundaryRefresh';

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
 * refresh. The timer is cleared on unmount and re-armed when the server's `phase` moves; a refresh
 * that brings the same phase back (a device clock running ahead) is retried (`useBoundaryRefresh`,
 * shared with the detail's `EventActions`). The clock is read ONLY inside the effect, never during
 * render (UI-D-14): every string the card shows was built on the server.
 */
export function NextEventRefresh({ boundaries, phase }: NextEventRefreshProps) {
  useBoundaryRefresh(boundaries, phase);
  return null;
}
