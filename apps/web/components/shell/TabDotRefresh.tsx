'use client';

import { useBoundaryRefresh } from '@/components/events/useBoundaryRefresh';

export interface TabDotRefreshProps {
  /** ISO instants after which a tab's dot may change (`TabDot.until`), computed on the server. */
  boundaries: readonly string[];
}

/**
 * Keeps the shell's tab dots true while the app stays open (2026-10-03). It renders NOTHING: in an
 * effect it schedules ONE `router.refresh()` just after the next of `boundaries` within 24 h, so the
 * layout asks again (`tabDotsFor`) and the Eventos dot goes when the last event ends, with no
 * reload. A refresh that brings the same instants back (a device clock running ahead of the
 * server's) is retried; new instants re-arm it, and with no dot left the layout unmounts it, which
 * clears whatever is pending (`useBoundaryRefresh`, shared with the event detail's
 * `EventActions`).
 */
export function TabDotRefresh({ boundaries }: TabDotRefreshProps) {
  useBoundaryRefresh(boundaries, 'tab-dot');
  return null;
}
