import { ENGAGEMENT_BAND_ORDER } from '../contracts/floor';
import type { EngagementBands } from '../fixtures/shared';

/**
 * The floor helpers and the band order live in the contracts since 08.7-06 (one implementation for
 * the API and the web, D-462); every web call site keeps importing them from here.
 */
export {
  type BandGroup,
  ENGAGEMENT_BAND_ORDER,
  isBelowPrivacyFloor,
  mergeBandsBelowFloor,
  PRIVACY_FLOOR,
} from '../contracts/floor';

/**
 * Pure engagement helpers: every percent and total a panel shows is computed from the bands, never
 * typed next to them. No words, no clock (MOD-02); the web tier formats.
 */

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
