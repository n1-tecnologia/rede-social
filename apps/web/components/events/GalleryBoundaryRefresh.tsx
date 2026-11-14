'use client';

import { useBoundaryRefresh } from './useBoundaryRefresh';

export interface GalleryBoundaryRefreshProps {
  /** The `Em breve` openings of the cards on the page, ISO strings, in any order. */
  openings: readonly string[];
  /** The server's own instant of this render: the schedule runs on the server clock, never the device's. */
  serverNow: string;
  /**
   * The key of the page's tags (`{id}:{tag}` of every card with one). It is the shared refresh's phase, so
   * the retry chain only lives while the server answers the SAME tags, and a card that turned `Pago`
   * clears the chain and re-arms for the next opening.
   */
  tags: string;
}

/**
 * The gallery's ONE shared refresh of its `Em breve` openings (Phase 10.2, D-788, OPEN-10, UI-D-786, T-10.2-06).
 * It renders NOTHING: it hands every opening of the page to a single `useBoundaryRefresh`, so however many
 * `Em breve` cards the gallery holds there is ONE scheduled `router.refresh()` just after the soonest
 * opening and ONE bounded retry chain, and the cards that opened go back to `Pago` without a reload. A
 * gallery with no such card mounts no timer. The hook only asks the server; it holds no link and decides
 * no state. The same pattern as `TabDotRefresh`, with the seed.
 *
 * An opening further away than the hook's horizon (24 h) is NOT filtered out here: the hook waits in
 * capped steps and re-evaluates the schedule without refreshing, so a tab left open for days still swaps
 * the card at the opening (WR-02). Nothing else re-seeds a continuously visible page.
 */
export function GalleryBoundaryRefresh({ openings, serverNow, tags }: GalleryBoundaryRefreshProps) {
  useBoundaryRefresh(openings, tags, serverNow);
  return null;
}
