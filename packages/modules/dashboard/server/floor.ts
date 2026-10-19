import {
  type FlooredBandGroup,
  type FlooredCount,
  isBelowPrivacyFloor,
  mergeBandsBelowFloor,
} from '../contracts/index';

/**
 * The privacy floor applied by the API (08.7-06, D-462, INSIGHT-14, EP-44..EP-49): every group
 * total of people or orders the admin cannot otherwise list passes through here between the parsed
 * payload and `c.json`, so a group of 1-4 is not in the JSON at all (a flag beside a value would
 * still leak it). Zero is not floored (UI-D-470): 0 identifies no one.
 *
 * Built on the one implementation in `contracts/floor.ts` that the web uses too (planning
 * decision 1). Pure: no clock, no I/O.
 */

/** 0 → the value 0; 1-4 → `{ belowFloor: true }` with no value key; 5 and more → the value. */
export function floorCount(n: number): FlooredCount {
  if (n === 0) return { belowFloor: false, value: 0 };
  if (isBelowPrivacyFloor(n)) return { belowFloor: true };
  return { belowFloor: false, value: n };
}

type BandCounts = Readonly<
  Record<'new' | 'superfan' | 'engaged' | 'occasional' | 'at_risk' | 'inactive', number>
>;

/**
 * A band split as floored groups (EP-45..EP-47): an all-zero split is no group at all; otherwise the
 * bands under the floor are merged with a neighbour (`mergeBandsBelowFloor`), so every group holds 5
 * or more unless the whole base is one group, and each group's count goes through `floorCount`.
 * Shown groups come first by value desc, floored ones after (`sortFloored`).
 */
export function floorBands(counts: BandCounts): FlooredBandGroup[] {
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  if (total === 0) return [];
  const groups = mergeBandsBelowFloor({ counts }).map((group) => ({
    bands: group.bands,
    count: floorCount(group.count),
  }));
  return sortFloored(groups, (group) => group.count);
}

/**
 * EP-47 (UI-D-470): shown rows first by value desc, floored rows after them, each part keeping its
 * input order on ties (a stable sort). Any floored value is below any shown one of 5 or more, so
 * the client's order stays true without the hidden number.
 */
export function sortFloored<T>(rows: readonly T[], pick: (row: T) => FlooredCount): T[] {
  const rank = (row: T) => {
    const floored = pick(row);
    return floored.belowFloor ? -1 : floored.value;
  };
  return [...rows].sort((a, b) => rank(b) - rank(a));
}
