import type { EngagementBand, EngagementBands } from '../fixtures/shared';

/**
 * Pure engagement helpers: every percent and total a panel shows is computed from the bands, never
 * typed next to them. No words, no clock (MOD-02); the web tier formats.
 */

/** The exclusive bands in evaluation order (also the order a band list is drawn in). */
export const ENGAGEMENT_BAND_ORDER: readonly EngagementBand[] = [
  'new',
  'superfan',
  'engaged',
  'occasional',
  'at_risk',
  'inactive',
];

/** Every member of the base: the sum of the six bands. */
export function bandTotal(bands: EngagementBands): number {
  return ENGAGEMENT_BAND_ORDER.reduce((sum, band) => sum + bands.counts[band], 0);
}

/** "Interagiu": superfãs + engajados + ocasionais + novos ativados. */
export function interactedCount(bands: EngagementBands): number {
  const { superfan, engaged, occasional } = bands.counts;
  return superfan + engaged + occasional + bands.newActivated;
}

/** `part` as 0–100 of `whole`, unrounded; 0 when `whole` is not positive. */
export function percentOf(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return (part / whole) * 100;
}

/** The picked number of every row, summed (0 for no rows). */
export function sumOf<T>(rows: readonly T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

/** `total / count` rounded to a whole number ("65 por post"); 0 when `count` is not positive. */
export function perItem(total: number, count: number): number {
  return count > 0 ? Math.round(total / count) : 0;
}

/**
 * The row with the highest score, the earliest on a tie; `undefined` for no rows. A highlight must
 * follow the values, never the data's order (261012-oxi C-6).
 */
export function topBy<T>(rows: readonly T[], score: (row: T) => number): T | undefined {
  let best: T | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const value = score(row);
    if (best === undefined || value > bestScore) {
      best = row;
      bestScore = value;
    }
  }
  return best;
}

/** Check-ins as 0–100 of the confirmed RSVPs over a list of events, unrounded (0 for no RSVPs). */
export function attendancePercent(
  rows: readonly { confirmed: number; checkIns: number }[],
): number {
  return percentOf(
    sumOf(rows, (row) => row.checkIns),
    sumOf(rows, (row) => row.confirmed),
  );
}

/** "Engajados" (superfãs + engajados) as 0–100 of the base, unrounded. */
export function engagedPercent(bands: EngagementBands): number {
  return percentOf(bands.counts.superfan + bands.counts.engaged, bandTotal(bands));
}

/** Group totals below this read "menos de 5" with no value (D-02), so no small group is identified. */
export const PRIVACY_FLOOR = 5;

/** Whether a count is small enough to re-identify someone (`count < PRIVACY_FLOOR`). */
export function isBelowPrivacyFloor(count: number): boolean {
  return count < PRIVACY_FLOOR;
}

/** One displayed row of a floored band list: one or more adjacent bands, summed. */
export interface BandGroup {
  bands: EngagementBand[];
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
  bands: EngagementBands,
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
