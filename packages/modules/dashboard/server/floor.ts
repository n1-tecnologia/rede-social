import type { FlooredCount } from '../contracts/index';

/**
 * RED stub (08.7-06 Task 1): the server-side privacy floor is not implemented yet. Every function
 * answers an inert value so the RED tests fail on their assertions, not on an import.
 */
export function floorCount(_n: number): FlooredCount {
  return { belowFloor: false, value: -1 };
}

export function floorBands(
  _counts: Readonly<Record<string, number>>,
): { bands: string[]; count: FlooredCount }[] {
  return [];
}

export function sortFloored<T>(rows: readonly T[], _pick: (row: T) => FlooredCount): T[] {
  return [...rows];
}
