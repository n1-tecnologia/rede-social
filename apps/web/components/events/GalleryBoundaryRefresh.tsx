'use client';

import { useBoundaryRefresh } from './useBoundaryRefresh';

/** An opening further than this from the server's instant is not scheduled by the gallery (UI-D-786). */
export const GALLERY_OPENING_HORIZON_MS = 24 * 60 * 60 * 1_000;

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
 * It renders NOTHING: it hands every opening within the next 24 hours of the seed to a single
 * `useBoundaryRefresh`, so however many `Em breve` cards the gallery holds there is ONE scheduled
 * `router.refresh()` just after the soonest opening and ONE bounded retry chain, and the cards that opened
 * go back to `Pago` without a reload. A gallery with no such card mounts no timer. The hook only asks the
 * server; it holds no link and decides no state. The same pattern as `TabDotRefresh`, with the seed.
 *
 * The 24 h filter is arithmetic over the two props only, never a clock read. A farther opening is picked up
 * by whatever re-seeds the page (a tab coming back after more than a minute, the refresh itself).
 */
export function GalleryBoundaryRefresh({ openings, serverNow, tags }: GalleryBoundaryRefreshProps) {
  const seed = Date.parse(serverNow);
  const near = openings.filter((iso) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) && Number.isFinite(seed) && ms - seed <= GALLERY_OPENING_HORIZON_MS;
  });
  useBoundaryRefresh(near, tags, serverNow);
  return null;
}
