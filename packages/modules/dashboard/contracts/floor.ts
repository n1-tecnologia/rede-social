/**
 * The privacy floor (D-02, D-462), ONE implementation for the API and the web (08.7-06, planning
 * decision 1). Moved here from `ui/metrics.ts`, which re-exports every name, so each web call site
 * keeps its import; the API's `server/floor.ts` builds `floorCount` / `floorBands` on top.
 *
 * Pure and zod-free on purpose: the client-side `ui` entry re-exports this file and pulls nothing
 * else with it (the zod schema of a floored band group lives in `shared.ts`).
 */

/** The six engagement bands (the same literals as `ENGAGEMENT_BANDS` of the zod contract). */
type Band = 'new' | 'superfan' | 'engaged' | 'occasional' | 'at_risk' | 'inactive';

/** Group totals below this read "menos de 5" with no value, so no small group is identified. */
export const PRIVACY_FLOOR = 5;

/** The exclusive bands in evaluation order (also the order a band list is drawn in). */
export const ENGAGEMENT_BAND_ORDER: readonly Band[] = [
  'new',
  'superfan',
  'engaged',
  'occasional',
  'at_risk',
  'inactive',
];

/** Whether a count is small enough to re-identify someone (`count < PRIVACY_FLOOR`). */
export function isBelowPrivacyFloor(count: number): boolean {
  return count < PRIVACY_FLOOR;
}

/** One displayed row of a floored band list: one or more adjacent bands, summed. */
export interface BandGroup {
  bands: Band[];
  count: number;
}

/**
 * The bands as rows where no row is under `floor` (C-1). Hiding a small band is not enough when the
 * exact total sits next to the others: the total minus the shown bands gives it back. So a small band
 * is merged with a neighbour instead — the smallest small group first (lowest index on a tie), into
 * its only neighbour at either end, else into the smaller of its two neighbours (the previous on a
 * tie) — until every row reaches the floor. The rows still sum to the exact total and keep band
 * order. A whole base under the floor ends as one row, which equals the total already shown.
 */
export function mergeBandsBelowFloor(
  bands: { counts: Readonly<Record<Band, number>> },
  floor: number = PRIVACY_FLOOR,
): BandGroup[] {
  const groups: BandGroup[] = ENGAGEMENT_BAND_ORDER.map((band) => ({
    bands: [band],
    count: bands.counts[band],
  }));
  while (groups.length > 1) {
    let smallest = -1;
    let smallestCount = floor;
    groups.forEach((group, index) => {
      if (group.count < smallestCount) {
        smallest = index;
        smallestCount = group.count;
      }
    });
    if (smallest < 0) break;
    const previous = groups[smallest - 1];
    const next = groups[smallest + 1];
    const into =
      next === undefined || (previous !== undefined && previous.count <= next.count)
        ? smallest - 1
        : smallest + 1;
    const [first, second] = into < smallest ? [into, smallest] : [smallest, into];
    const a = groups[first];
    const b = groups[second];
    if (a === undefined || b === undefined) break;
    groups.splice(first, 2, { bands: [...a.bands, ...b.bands], count: a.count + b.count });
  }
  return groups;
}
