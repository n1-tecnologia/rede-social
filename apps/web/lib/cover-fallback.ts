/**
 * The fallback ladder of a "Topo" (the wide image at the head of a page), 12.3-07 (NOVF-02,
 * UI-D-692, D-696, D-699).
 *
 * The API answers the Topo AS STORED: its own `topCoverAssetId`, or null. It never computes a
 * fallback and the admin's forms never write the card cover into the Topo on the admin's behalf, so a
 * Topo left empty stays null in the database and the page decides what to draw: the Topo, else the
 * card cover, else nothing (the page then draws the brand gradient, D-69). These are pure functions
 * of the entity's two ids, shared by every page that draws the Topo.
 *
 * The Topo key is optional in the input on purpose: an older API answer lacks it (D-696) and reads
 * as "no Topo", never as a broken page.
 */
export interface TopCoverIds {
  /** The entity's card cover: the image of its card in the lists. */
  coverAssetId: string | null;
  /** The entity's own Topo; null or absent when it has none. */
  topCoverAssetId?: string | null | undefined;
}

/** The image to draw at the top: the Topo, else the card cover, else null (the brand gradient). */
function topOrCard(ids: TopCoverIds): string | null {
  return ids.topCoverAssetId ?? ids.coverAssetId;
}

/** A track's page top (and the hero of the member's Trilhas tab): its Topo, else its card cover. */
export function trackTopCover(track: TopCoverIds): string | null {
  return topOrCard(track);
}

/** A course's page top (the member's course banner): its Topo, else its card cover. */
export function courseTopCover(course: TopCoverIds): string | null {
  return topOrCard(course);
}

/**
 * A module's two images, 12.3-08 (NOVF-03, UI-D-692, PU-2, D-696, D-699). Like the Topo above, the API
 * answers each AS STORED (its own `coverAssetId` and `topCoverAssetId`, or null) and the sheet never
 * writes one into the other or the course's cover into either, so the page decides what to draw. Both
 * keys are optional in the input: an older answer lacks them (D-696) and reads as "no image".
 */
export interface ModuleCoverIds {
  /** The module's own card cover; null or absent when it has none. */
  coverAssetId?: string | null | undefined;
  /** The module's own Topo; null or absent when it has none. */
  topCoverAssetId?: string | null | undefined;
}

/**
 * The image of a module's CARD (the course page's "Módulos"): its own card cover, else the course's
 * cover, else null (the card then draws the brand gradient).
 */
export function moduleCardCover(
  module: Pick<ModuleCoverIds, 'coverAssetId'>,
  courseCoverAssetId: string | null,
): string | null {
  return module.coverAssetId ?? courseCoverAssetId;
}

/**
 * The image at the top of a module's PAGE: its own Topo, else its own card cover, else the course's
 * cover, else null (the page then draws the brand gradient).
 */
export function moduleTopCover(
  module: ModuleCoverIds,
  courseCoverAssetId: string | null,
): string | null {
  return module.topCoverAssetId ?? module.coverAssetId ?? courseCoverAssetId;
}
